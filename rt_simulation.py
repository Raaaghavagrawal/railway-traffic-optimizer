from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import networkx as nx
from ortools.sat.python import cp_model


class TrainPriority(str, Enum):
	EXPRESS = "express"
	PASSENGER = "passenger"
	FREIGHT = "freight"


def now_ms() -> int:
	return int(time.time() * 1000)


@dataclass
class TrackSegment:
	segment_id: str
	source: str
	target: str
	length_m: float
	max_speed_mps: float = 30.0


@dataclass
class Train:
	train_id: str
	priority: TrainPriority
	max_speed_mps: float
	path_nodes: List[str]
	planned_departure_s: float = 0.0
	planned_arrival_s: float = 0.0
	# dynamic
	position_edge: Tuple[str, str] | None = None
	position_m: float = 0.0
	speed_mps: float = 0.0
	status: str = "stopped"  # running|stopped|delayed|held
	last_update_ms: int = field(default_factory=now_ms)


class EventType(str, Enum):
	DELAY = "delay"
	BREAKDOWN = "breakdown"
	REROUTE = "reroute"
	HOLD = "hold"
	SPEED = "speed"


@dataclass
class Event:
	type: EventType
	train_id: str
	payload: Dict[str, Any]
	timestamp_ms: int = field(default_factory=now_ms)


class Optimizer:
	"""Simple CP-SAT precedence optimizer over segment occupancy windows.
	This models each edge traversal as an interval; adds no-overlap per edge.
	"""

	def build_and_solve(self, graph: nx.MultiDiGraph, trains: List[Train], tick_s: float, horizon_s: float = 3600.0) -> Dict[str, Any]:
		model = cp_model.CpModel()
		assignments: Dict[Tuple[str, str, str], Tuple[cp_model.IntVar, cp_model.IntervalVar]] = {}

		# scale seconds to integer milliseconds for CP-SAT
		scale = 1000
		def seconds_to_int(s: float) -> int:
			return int(round(s * scale))

		# Build traversal intervals for each train's current edge only (rolling horizon)
		for t in trains:
			if not t.position_edge:
				# if no edge yet and path has at least two nodes, set first edge as current
				if len(t.path_nodes) >= 2 and graph.has_edge(t.path_nodes[0], t.path_nodes[1]):
					u, v = t.path_nodes[0], t.path_nodes[1]
					length = float(graph[u][v][0].get("length", 0.0))
					vmax = graph[u][v][0].get("max_speed")
					max_speed_mps = t.max_speed_mps if vmax is None else min(t.max_speed_mps, float(vmax) / 3.6)
					dur_s = length / max(0.1, max_speed_mps)
					start = model.NewIntVar(0, seconds_to_int(horizon_s), f"start_{t.train_id}_{u}_{v}")
					dur = seconds_to_int(dur_s)
					iv = model.NewIntervalVar(start, dur, start + dur, f"int_{t.train_id}_{u}_{v}")
					assignments[(t.train_id, u, v)] = (start, iv)
					# basic priority hint (express prefer earlier start)
					if t.priority == TrainPriority.EXPRESS:
						model.Add(start <= seconds_to_int(t.planned_departure_s + 120))
				continue
			# has current edge
			u, v = t.position_edge
			length = float(graph[u][v][0].get("length", 0.0))
			vmax = graph[u][v][0].get("max_speed")
			max_speed_mps = t.max_speed_mps if vmax is None else min(t.max_speed_mps, float(vmax) / 3.6)
			remaining = max(0.1, length - t.position_m)
			dur_s = remaining / max(0.1, max_speed_mps)
			start = model.NewIntVar(0, seconds_to_int(horizon_s), f"start_{t.train_id}_{u}_{v}")
			dur = seconds_to_int(dur_s)
			iv = model.NewIntervalVar(start, dur, start + dur, f"int_{t.train_id}_{u}_{v}")
			assignments[(t.train_id, u, v)] = (start, iv)

		# No overlap per edge
		edge_to_intervals: Dict[Tuple[str, str], List[cp_model.IntervalVar]] = {}
		for (tid, u, v), (_s, iv) in assignments.items():
			edge_to_intervals.setdefault((u, v), []).append(iv)
		for (u, v), ivs in edge_to_intervals.items():
			model.AddNoOverlap(ivs)

		# Objective: minimize sum of starts (earlier traversal) and soft priority
		obj_terms: List[cp_model.LinearExpr] = []
		for (tid, u, v), (s, _iv) in assignments.items():
			prio = next((1 if t.priority == TrainPriority.EXPRESS else 5 if t.priority == TrainPriority.PASSENGER else 10) for t in trains if t.train_id == tid)
			obj_terms.append(s * prio)
		model.Minimize(sum(obj_terms))

		solver = cp_model.CpSolver()
		solver.parameters.max_time_in_seconds = 1.0
		_ = solver.Solve(model)

		plan: Dict[str, Any] = {"assignments": [], "status": solver.StatusName()}
		for (tid, u, v), (s, iv) in assignments.items():
			if solver.Value(s) is not None:
				plan["assignments"].append({
					"train_id": tid,
					"edge": {"u": u, "v": v},
					"start_ms": solver.Value(s),
					"duration_ms": solver.Value(iv.SizeExpr())
				})
		return plan


class AsyncSimulation:
	"""Async simulation loop with periodic optimization and broadcast queue."""

	def __init__(self, graph: nx.MultiDiGraph, tick_seconds: float = 0.5):
		self.graph = graph
		self.trains: Dict[str, Train] = {}
		self.tick_seconds = tick_seconds
		self._running = False
		self._task: Optional[asyncio.Task] = None
		self._updates: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
		self._optimizer = Optimizer()

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
		last_opt = time.time()
		while self._running:
			self._tick(self.tick_seconds)
			# optimize every 2s
			if time.time() - last_opt > 2.0:
				plan = self._optimizer.build_and_solve(self.graph, list(self.trains.values()), self.tick_seconds)
				await self._updates.put({"type": "plan", "data": plan})
				last_opt = time.time()
			# broadcast state
			await self._updates.put({"type": "state", "data": self.telemetry_state()})
			await asyncio.sleep(self.tick_seconds)

	def _edge_length(self, u: str, v: str) -> float:
		if self.graph.has_edge(u, v):
			return float(self.graph[u][v][0].get("length", 0.0))
		return 0.0

	def _advance_train(self, t: Train, dt: float) -> None:
		if not t.position_edge:
			# initialize
			if len(t.path_nodes) >= 2 and self.graph.has_edge(t.path_nodes[0], t.path_nodes[1]):
				t.position_edge = (t.path_nodes[0], t.path_nodes[1])
				t.position_m = 0.0
				t.status = "running"
			else:
				t.status = "stopped"
				return
		u, v = t.position_edge
		length = self._edge_length(u, v)
		if length <= 0:
			t.status = "stopped"
			return
		vmax = self.graph[u][v][0].get("max_speed")
		max_speed = t.max_speed_mps if vmax is None else min(t.max_speed_mps, float(vmax) / 3.6)
		t.speed_mps = min(max_speed, max(0.0, t.speed_mps or max_speed))
		t.position_m = min(length, t.position_m + t.speed_mps * dt)
		if t.position_m >= length - 1e-3:
			# advance to next edge
			if t.path_nodes and t.path_nodes.index(u) + 2 < len(t.path_nodes):
				i = t.path_nodes.index(u) + 1
				new_u = t.path_nodes[i]
				new_v = t.path_nodes[i + 1]
				if self.graph.has_edge(new_u, new_v):
					t.position_edge = (new_u, new_v)
					t.position_m = 0.0
					t.status = "running"
					return
			t.status = "stopped"

	def _tick(self, dt: float) -> None:
		for t in self.trains.values():
			self._advance_train(t, dt)

	def telemetry_state(self) -> Dict[str, Any]:
		out: List[Dict[str, Any]] = []
		for t in self.trains.values():
			u, v = t.position_edge if t.position_edge else (None, None)
			length = self._edge_length(u, v) if u and v else 0.0
			progress = 0.0 if length <= 0 else max(0.0, min(1.0, (t.position_m or 0.0) / length))
			out.append({
				"train_id": t.train_id,
				"priority": t.priority,
				"edge": {"u": u, "v": v} if u and v else None,
				"position_m": round(t.position_m, 2),
				"edge_length_m": round(length, 2),
				"speed_mps": round(t.speed_mps, 2),
				"status": t.status,
				"progress": round(progress, 4),
			})
		return {"trains": out}

	# Public API
	def add_train(self, train: Train) -> bool:
		self.trains[train.train_id] = train
		return True

	def inject_event(self, evt: Event) -> bool:
		t = self.trains.get(evt.train_id)
		if not t:
			return False
		if evt.type == EventType.HOLD:
			t.status = "held"
			t.speed_mps = 0.0
			return True
		if evt.type == EventType.SPEED:
			sp = float(evt.payload.get("speed_mps", t.max_speed_mps))
			t.max_speed_mps = max(0.0, sp)
			return True
		if evt.type == EventType.REROUTE:
			path = evt.payload.get("path") or []
			if isinstance(path, list) and len(path) >= 2:
				t.path_nodes = path
				t.position_edge = (path[0], path[1]) if len(path) >= 2 else None
				t.position_m = 0.0
				t.status = "running"
				return True
		if evt.type == EventType.DELAY:
			delay_s = float(evt.payload.get("delay_s", 0))
			t.planned_departure_s += delay_s
			return True
		if evt.type == EventType.BREAKDOWN:
			t.status = "delayed"
			t.speed_mps = 0.0
			return True
		return False

	async def updates(self) -> "asyncio.Queue[Dict[str, Any]]":
		return self._updates
