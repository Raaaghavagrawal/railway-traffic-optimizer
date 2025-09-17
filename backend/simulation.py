from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import networkx as nx


class TrainType(str, Enum):
	EXPRESS = "express"
	FREIGHT = "freight"
	LOCAL = "local"


@dataclass
class TrackSegment:
	segment_id: str
	source: str
	target: str
	length_m: float
	max_speed_mps: float = 30.0


@dataclass
class Train:
	id: str
	type: TrainType
	speed_mps: float
	priority: int
	position: float = 0.0  # meters along current segment
	route: List[str] = field(default_factory=list)  # node ids
	current_edge: Tuple[str, str] | None = None
	delay_min: int = 0
	planned_times_min: Dict[str, int] = field(default_factory=dict)  # node -> minute
	status: str = "stopped"  # running|stopped|held|delayed


class RailwaySimulation:
	"""Minute-stepped railway simulation over a simple directed graph.

	- Each step advances trains along their current edge according to `speed_mps` and edge max speed
	- Detects conflicts when multiple trains request the same next edge
	- Calls an optimizer to decide precedence; non-winners are held one step (incurring 1 minute delay)
	- Emits compact state for streaming
	"""

	def __init__(self, graph: nx.MultiDiGraph, minute_seconds: float = 0.25):
		self.graph = graph
		self.trains: Dict[str, Train] = {}
		self.minute_seconds = minute_seconds  # wall time per simulated minute
		self._running = False
		self._task: Optional[asyncio.Task] = None
		self._updates: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
		# Lazy import to avoid hard dependency loop
		try:
			from .optimizer import ConflictDecisionOptimizer  # type: ignore
		except ImportError:
			from optimizer import ConflictDecisionOptimizer  # type: ignore
		self._optimizer = ConflictDecisionOptimizer()

	def add_train(self, train: Train) -> None:
		self.trains[train.id] = train

	def reset(self) -> None:
		for t in self.trains.values():
			t.position = 0.0
			t.current_edge = None
			t.delay_min = 0
			t.status = "stopped"

	async def start(self) -> None:
		if self._running:
			return
		self._running = True
		self._task = asyncio.create_task(self._loop())

	async def stop(self) -> None:
		self._running = False
		if self._task:
			await asyncio.wait([self._task])

	async def _loop(self) -> None:
		last_tick = time.time()
		while self._running:
			self._step_one_minute()
			await self._updates.put({"type": "state", "data": self.state_snapshot()})
			# throttle to minute_seconds
			elapsed = time.time() - last_tick
			sleep_for = max(0.0, self.minute_seconds - elapsed)
			await asyncio.sleep(sleep_for)
			last_tick = time.time()

	def _edge_length(self, u: str, v: str) -> float:
		if not u or not v:
			return 0.0
		if self.graph.has_edge(u, v):
			return float(self.graph[u][v][0].get("length", 0.0))
		return 0.0

	def _advance_train_position(self, t: Train) -> None:
		# Initialize onto first edge if needed
		if not t.current_edge:
			if len(t.route) >= 2 and self.graph.has_edge(t.route[0], t.route[1]):
				t.current_edge = (t.route[0], t.route[1])
				t.position = 0.0
				t.status = "running"
			else:
				t.status = "stopped"
				return
		u, v = t.current_edge
		length = self._edge_length(u, v)
		if length <= 0.0:
			t.status = "stopped"
			return
		vmax_kmh = self.graph[u][v][0].get("max_speed")
		vmax_mps = t.speed_mps if vmax_kmh is None else min(t.speed_mps, float(vmax_kmh) / 3.6)
		# One simulated minute of progress
		progress_m = max(0.0, vmax_mps) * 60.0
		t.position = min(length, t.position + progress_m)
		if t.position >= length - 1e-3:
			# advance to next edge
			idx = t.route.index(u) if u in t.route else -1
			if idx >= 0 and idx + 2 < len(t.route):
				next_u = t.route[idx + 1]
				next_v = t.route[idx + 2]
				if self.graph.has_edge(next_u, next_v):
					t.current_edge = (next_u, next_v)
					t.position = 0.0
					t.status = "running"
					return
			t.status = "stopped"

	def _find_conflicts(self) -> List[Dict[str, Any]]:
		"""Return conflicts where multiple trains want the same next edge.
		Conflict item: { 'edge': (u,v), 'trains': [ids...] }
		"""
		edge_to_trains: Dict[Tuple[str, str], List[str]] = {}
		for t in self.trains.values():
			if not t.current_edge:
				# infer first planned edge
				if len(t.route) >= 2 and self.graph.has_edge(t.route[0], t.route[1]):
					edge = (t.route[0], t.route[1])
					edge_to_trains.setdefault(edge, []).append(t.id)
				continue
			u, v = t.current_edge
			length = self._edge_length(u, v)
			if t.position >= length - 1e-3:
				# intends to move to next edge
				idx = t.route.index(u) if u in t.route else -1
				if idx >= 0 and idx + 2 < len(t.route):
					next_edge = (t.route[idx + 1], t.route[idx + 2])
					if self.graph.has_edge(*next_edge):
						edge_to_trains.setdefault(next_edge, []).append(t.id)
		return [{"edge": e, "trains": tids} for e, tids in edge_to_trains.items() if len(tids) > 1]

	def _apply_decisions(self, decisions: Dict[str, str]) -> None:
		"""Apply optimizer decisions: hold non-winners for one minute (increase delay)."""
		for key, winner in decisions.items():
			_ = key  # key encodes edge; not needed for application
			# all trains in that conflict except winner are delayed
			edge_u, edge_v = key.split("->", 1)
			for t in self.trains.values():
				if not t.current_edge:
					continue
				u, v = t.current_edge
				length = self._edge_length(u, v)
				# only trains at end of edge trying to enter the contested segment
				if t.position >= length - 1e-3:
					idx = t.route.index(u) if u in t.route else -1
					if idx >= 0 and idx + 2 < len(t.route):
						nu = t.route[idx + 1]
						nv = t.route[idx + 2]
						if f"{nu}->{nv}" == key and t.id != winner:
							# hold back for one minute
							t.delay_min += 1
							t.status = "held"
							# do not advance to next edge this step (handled by position check)

	def _step_one_minute(self) -> None:
		# 1) Determine conflicts about to happen
		conflicts = self._find_conflicts()
		decisions: Dict[str, str] = {}
		if conflicts:
			decisions = self._optimizer.decide(conflicts, self.trains)
			# broadcast decisions
			asyncio.create_task(self._updates.put({"type": "decisions", "data": decisions}))
			self._apply_decisions(decisions)
		# 2) Advance all trains by one simulated minute
		for t in self.trains.values():
			prev_status = t.status
			self._advance_train_position(t)
			if prev_status == "held" and t.status == "running":
				# clear held indicator after movement resumes
				pass

	def state_snapshot(self) -> Dict[str, Any]:
		rows: List[Dict[str, Any]] = []
		for t in self.trains.values():
			u, v = t.current_edge if t.current_edge else (None, None)
			length = self._edge_length(u, v) if u and v else 0.0
			progress = 0.0 if length <= 0 else max(0.0, min(1.0, (t.position or 0.0) / length))
			rows.append({
				"id": t.id,
				"type": t.type,
				"priority": t.priority,
				"edge": {"u": u, "v": v} if u and v else None,
				"position_m": round(t.position, 2),
				"edge_length_m": round(length, 2),
				"speed_mps": round(t.speed_mps, 2),
				"status": t.status,
				"progress": round(progress, 4),
				"delay_min": t.delay_min,
			})
		return {"trains": rows}

	async def updates(self) -> "asyncio.Queue[Dict[str, Any]]":
		return self._updates


