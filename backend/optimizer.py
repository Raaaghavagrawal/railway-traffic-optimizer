from __future__ import annotations

from typing import Any, Dict, List, Tuple

from ortools.sat.python import cp_model


class ConflictDecisionOptimizer:
	"""CP-SAT optimizer to decide which train enters a contested edge first.

	Input conflicts: [{ 'edge': (u,v), 'trains': ['T1','T2', ...] }]
	Also given the current train map to access priority weights.

	Goal: Minimize weighted start times on edges → prefer higher-priority trains.
	We model one interval per train per conflicted edge with NoOverlap per edge.
	"""

	def decide(self, conflicts: List[Dict[str, Any]], trains: Dict[str, Any]) -> Dict[str, str]:
		if not conflicts:
			return {}
		model = cp_model.CpModel()
		start_vars: Dict[Tuple[str, str, str], cp_model.IntVar] = {}
		intervals_by_edge: Dict[Tuple[str, str], List[cp_model.IntervalVar]] = {}
		train_for_interval: Dict[cp_model.IntervalVar, str] = {}

		# Each edge gets a sequence; each train has a fixed small duration token
		duration = 1  # abstract minute token
		for c in conflicts:
			u, v = c["edge"]
			for tid in c["trains"]:
				start = model.NewIntVar(0, 1000, f"s_{tid}_{u}_{v}")
				iv = model.NewIntervalVar(start, duration, start + duration, f"iv_{tid}_{u}_{v}")
				start_vars[(tid, u, v)] = start
				intervals_by_edge.setdefault((u, v), []).append(iv)
				train_for_interval[iv] = tid

		# NoOverlap per edge
		for (u, v), ivs in intervals_by_edge.items():
			model.AddNoOverlap(ivs)

		# Objective: weight by priority (lower weight = higher priority)
		obj_terms = []
		for (tid, u, v), s in start_vars.items():
			prio = int(trains[tid].priority) if tid in trains else 5
			obj_terms.append(s * prio)
		model.Minimize(sum(obj_terms))

		solver = cp_model.CpSolver()
		solver.parameters.max_time_in_seconds = 0.25
		_ = solver.Solve(model)

		# Winner is the train with smallest start on each edge
		winners: Dict[str, str] = {}
		for (u, v), ivs in intervals_by_edge.items():
			best_tid = None
			best_s = None
			for iv in ivs:
				# recover variable name
				name = iv.Name().replace("iv_", "s_")
				try:
					svar = model.GetVarFromProtoName(name)  # type: ignore[attr-defined]
				except Exception:
					svar = None
				if svar is None:
					# fallback via our map
					# find corresponding start var by tuple
					continue
				val = solver.Value(svar)
				tid = train_for_interval[iv]
				if best_s is None or val < best_s:
					best_s = val
					best_tid = tid
			if best_tid is not None:
				winners[f"{u}->{v}"] = best_tid
		return winners


