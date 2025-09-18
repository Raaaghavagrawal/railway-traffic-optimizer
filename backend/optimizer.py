from __future__ import annotations
from typing import List, Dict, Any, TYPE_CHECKING
from pydantic import BaseModel
from ortools.sat.python import cp_model
import math

if TYPE_CHECKING:
    from simulation import RailwaySimulation, Train
    import networkx as nx

# Constants for time conversion and max values in CP-SAT
# CP-SAT works best with integers. We'll use milliseconds or a similar fine-grained time unit.
TIME_UNIT_MS = 1000 # 1 second = 1000 ms
MAX_TIME_HORIZON_MS = 24 * 60 * 60 * TIME_UNIT_MS # 24 hours in milliseconds
MAX_DELAY_MIN = 60 * 24 # Max delay to allow, 24 hours

class CPDecision(BaseModel):
    train_id: str
    action_type: str # e.g., "delay", "speed_adjust", "re_route"
    value: Any # e.g., delay amount in min, new speed in mps, new route segment
    # Add optional fields for more specific actions if needed

class RailwayCPOptimizer:
    def __init__(self, simulation: RailwaySimulation, graph: nx.MultiDiGraph):
        self.simulation = simulation
        self.graph = graph

    def _get_edge_travel_time_ms(self, u: str, v: str, speed_mps: float) -> int:
        """Calculates travel time for an edge given a speed, in milliseconds."""
        length_m = self.simulation._edge_length(u, v)
        if speed_mps <= 0 or length_m <= 0:
            return 0
        return int((length_m / speed_mps) * TIME_UNIT_MS)

    def decide(self, current_time_min: float, trains: Dict[str, Train]) -> List[CPDecision]:
        """
        Builds and solves a CP-SAT model to suggest optimal train movements.
        """
        model = cp_model.CpModel()

        # --- 1. Define Variables ---
        train_vars: Dict[str, Dict[str, Any]] = {}

        # For each train and each node in its remaining route:
        # Create an IntervalVar for when the train occupies the edge leaving that node
        # Create IntVar for arrival time at node, departure time from node
        for train_id, train in trains.items():
            if not train.route or len(train.route) < 2:
                continue # Skip trains without a valid route

            train_vars[train_id] = {
                "arrival_times": {},
                "departure_times": {},
                "interval_vars": {}, # For track occupation
                "max_speed_override": model.NewIntVar(
                    int(train.speed_mps * 0.8), # Allow slight reduction
                    int(train.max_speed),
                    f"{train_id}_speed_override"
                ) # This variable could allow the solver to adjust speed
            }

            # Start time of the simulation in milliseconds
            current_time_ms = int(current_time_min * 60 * TIME_UNIT_MS)

            # Ensure starting conditions for the train that's currently in motion
            # (or at its first scheduled node if not yet started)
            start_node_idx = train.current_route_idx
            start_node_id = train.route[start_node_idx]

            # If train is currently on an edge (u, v)
            if train.current_edge:
                u, v = train.current_edge
                # If the train is midway on an edge, we need to estimate remaining time.
                # This makes the model more complex. For simplicity, we can assume
                # a train starts fresh from its *current* or *next* major node.
                # For a more robust model, you'd track exact position and time remaining on current edge.
                # For this example, let's simplify: if on an edge, assume it departs `u` at `current_time_ms`
                # or from the node it's *about to arrive at* if `position_on_edge` is very high.
                # A better approach for online control is to only optimize for future segments.
                pass # This is where "online" re-scheduling gets tricky.
                # For now, let's treat `current_time_ms` as the effective departure from the *last completed* node.
            
            # Simplified approach: If a train is past its initial node, its departure from that node
            # is fixed to its actual departure time.
            # Only optimize for future decisions.

            for i in range(start_node_idx, len(train.route)):
                node_id = train.route[i]
                
                # Arrival time at current node
                # Min value is current sim time if it's the current node, or a bit later
                min_arr = int(train.actual_arrival_times_ms.get(node_id, current_time_ms) or current_time_ms)
                if node_id == start_node_id:
                     # For the starting node, its arrival time is effectively now (or its actual historical arrival)
                     # For simplicity, if train is already past this node, fix this time.
                    if train.current_route_idx > i:
                        min_arr = int(train.actual_arrival_times_ms.get(node_id, current_time_ms) or current_time_ms)
                        max_arr = min_arr
                    else:
                        max_arr = MAX_TIME_HORIZON_MS
                else:
                    max_arr = MAX_TIME_HORIZON_MS

                train_vars[train_id]["arrival_times"][node_id] = model.NewIntVar(
                    min_arr, max_arr, f"{train_id}_arrival_{node_id}"
                )

                # Departure time from current node (if not the last node)
                if i < len(train.route) - 1:
                    min_dep = int(train.actual_departure_times_ms.get(node_id, current_time_ms) or current_time_ms)
                    if node_id == start_node_id:
                        if train.current_route_idx > i: # Train has already departed this node
                            min_dep = int(train.actual_departure_times_ms.get(node_id, current_time_ms) or current_time_ms)
                            max_dep = min_dep
                        else:
                            # Train is at this node or hasn't reached it yet, can depart from current time
                            max_dep = MAX_TIME_HORIZON_MS
                    else:
                        max_dep = MAX_TIME_HORIZON_MS

                    train_vars[train_id]["departure_times"][node_id] = model.NewIntVar(
                        min_dep, max_dep, f"{train_id}_departure_{node_id}"
                    )

                    # Interval variable for occupying the edge (node_id -> next_node_id)
                    next_node_id = train.route[i+1]
                    # The duration of this interval will be derived from speed_override variable
                    # We'll link departure, arrival and duration later.
                    train_vars[train_id]["interval_vars"][(node_id, next_node_id)] = model.NewIntervalVar(
                        train_vars[train_id]["departure_times"][node_id],
                        MAX_TIME_HORIZON_MS, # Dummy end for now, will be constrained by arrival at next node
                        MAX_TIME_HORIZON_MS, # Dummy duration for now
                        f"{train_id}_edge_{node_id}_{next_node_id}_interval"
                    )


        # --- 2. Add Constraints ---

        # Enforce arrival/departure logic
        for train_id, tvars in train_vars.items():
            train = trains[train_id]
            for i in range(len(train.route)):
                u_node = train.route[i]

                # Arrival time must be less than or equal to departure time
                if u_node in tvars["arrival_times"] and u_node in tvars["departure_times"]:
                    model.Add(tvars["arrival_times"][u_node] <= tvars["departure_times"][u_node])

                # Travel time for each segment
                if i < len(train.route) - 1:
                    v_node = train.route[i+1]
                    depart_u = tvars["departure_times"][u_node]
                    arrive_v = tvars["arrival_times"][v_node]

                    # Travel time calculation: Duration = Length / Speed
                    # Since speed is a variable, duration will also be a variable
                    # This requires more complex modeling for non-linear speed->time.
                    # A common simplification is to use discrete speed levels or calculate duration for fixed max speed
                    # and allow delays.

                    # Option 1 (Simpler): Assume train travels at its max_speed_override
                    # This creates a duration variable and links it.
                    duration_var = model.NewIntVar(0, MAX_TIME_HORIZON_MS, f"{train_id}_duration_{u_node}_{v_node}")
                    
                    # Need to model: duration_var = length / speed_mps_variable
                    # This is non-linear. CP-SAT can do some piecewise linear.
                    # Simplest is to assume a fixed speed for now, or use max_speed for duration
                    # and let delays account for not reaching max speed.
                    
                    # For a practical example, let's assume `max_speed_override` determines duration.
                    # We need to compute travel_time_ms = length_m / speed_mps
                    # Since CP-SAT is integer, we'll need to multiply by TIME_UNIT_MS.
                    length_m_edge = self.simulation._edge_length(u_node, v_node)
                    
                    if length_m_edge > 0:
                        # Introduce a temporary variable for 1/speed_mps to make it a product
                        # This is still non-linear. A common trick is to discretize speeds or inverse speeds.
                        # For now, let's fix a speed for time calculation, and allow solver to add delays.
                        # Or, only allow solver to *reduce* speed if needed, not increase beyond max.
                        
                        # Let's simplify and make duration a function of the chosen `max_speed_override`
                        # This is a bit tricky with direct CP-SAT variables.
                        # A more common approach is to pre-calculate min/max duration for segments.
                        
                        # Simpler approach: Assume constant speed, then allow delays
                        fixed_speed_mps = int(train.speed_mps) # use current train speed as base
                        min_travel_time_ms = self._get_edge_travel_time_ms(u_node, v_node, fixed_speed_mps)
                        
                        # Add constraint: arrive_v = depart_u + duration_var
                        # Duration must be at least min_travel_time_ms (at max speed)
                        # Max duration could be much higher due to delays.
                        model.Add(arrive_v == depart_u + duration_var)
                        model.Add(duration_var >= min_travel_time_ms)
                        
                        # Link the interval variable duration.
                        interval_edge = tvars["interval_vars"][(u_node, v_node)]
                        model.Add(interval_edge.StartExpr() == depart_u)
                        model.Add(interval_edge.EndExpr() == arrive_v)
                        model.Add(interval_edge.DurationExpr() == duration_var) # Link duration

                    else: # Zero length edge, immediate transition
                        model.Add(arrive_v == depart_u)

        # Non-overlapping resources (critical for collision avoidance)
        # This is where CP-SAT shines. For each track segment, only one train can be on it at a time.
        # Group interval variables by track segments (edges).
        edge_intervals: Dict[tuple[str, str], List[cp_model.IntervalVar]] = {}
        for train_id, tvars in train_vars.items():
            for (u, v), interval_var in tvars["interval_vars"].items():
                # Note: For bidirectional tracks, you might need to handle (u,v) and (v,u) sharing a resource
                # or model separate resources for each direction.
                # Here, we assume a directed edge (u,v) is a unique resource.
                if (u,v) not in edge_intervals:
                    edge_intervals[(u,v)] = []
                edge_intervals[(u,v)].append(interval_var)

        for edge, intervals in edge_intervals.items():
            if len(intervals) > 1:
                model.AddNoOverlap(intervals) # No two trains can occupy the same edge at the same time!

        # Objective Function
        # We want to minimize total delay. Delay is actual_arrival_time - planned_arrival_time.
        # You need to calculate planned_arrival_time based on ideal schedule for each train.
        # This means, for each train's route, you need to have a `planned_times_ms`
        total_delay_ms = model.NewIntVar(0, MAX_TIME_HORIZON_MS * len(trains) * 2, "total_delay_ms")
        delays_per_train = []

        for train_id, train in trains.items():
            if not train.route:
                continue
            
            # The last station in the route is often the most critical for delay calculation
            final_node = train.route[-1]
            if final_node in train_vars[train_id]["arrival_times"]:
                arrival_at_final_node_ms = train_vars[train_id]["arrival_times"][final_node]
                
                # We need planned_arrival_times_ms for comparison
                # If your `train.planned_times_min` has this, convert it.
                # Let's assume `train.planned_times_min` contains entries for *all* nodes in the route
                # or can be derived. For now, let's use a simplified "ideal" end time.
                
                # A better way: Calculate ideal duration for whole route, then add to start time.
                # For this example, let's assume a "target time" for the final node
                # based on current time + ideal travel for remaining route.
                
                # To make this robust, each train object should carry its ideal planned arrival time
                # for its final destination *in milliseconds* relative to some epoch or its own start.
                
                # Placeholder for planned final arrival (need to make this more precise from your train data)
                # Let's assume a train has a `target_end_time_ms` attribute
                target_end_time_ms = (current_time_min * 60 * TIME_UNIT_MS) + (len(train.route) * 10 * 60 * TIME_UNIT_MS) # Crude estimate

                # Or, even better, if you have a `train.planned_arrival_times_ms` dict
                planned_final_arrival = train.planned_times_min.get(final_node)
                if planned_final_arrival is not None:
                     target_end_time_ms = int(planned_final_arrival * 60 * TIME_UNIT_MS)

                delay_expr = model.NewIntVar(0, MAX_DELAY_MIN * 60 * TIME_UNIT_MS, f"{train_id}_delay")
                # delay = max(0, arrival_at_final_node - target_end_time_ms)
                model.AddMaxEquality(delay_expr, [
                    0, arrival_at_final_node_ms - target_end_time_ms
                ])
                delays_per_train.append(delay_expr)
        
        if delays_per_train:
            model.Add(total_delay_ms == sum(delays_per_train))
            model.Minimize(total_delay_ms)
        else:
            # If no delays can be calculated, optimize for earliest finish time of all trains
            # (which implicitly minimizes delays)
            max_finish_time = model.NewIntVar(0, MAX_TIME_HORIZON_MS, "max_finish_time")
            train_finish_times = []
            for train_id, train in trains.items():
                if train.route and train.route[-1] in train_vars[train_id]["arrival_times"]:
                    train_finish_times.append(train_vars[train_id]["arrival_times"][train.route[-1]])
            if train_finish_times:
                model.AddMaxEquality(max_finish_time, train_finish_times)
                model.Minimize(max_finish_time)
            # If no objective is added, CP-SAT will just search for any feasible solution


        # --- 3. Solve the Model ---
        solver = cp_model.CpSolver()
        status = solver.Solve(model)

        suggestions: List[CPDecision] = []

        if status == cp_model.OPTIMAL or status == cp_model.FEASIBLE:
            print(f"CP-SAT Solution found. Status: {solver.StatusName(status)}")
            print(f"Total delay minimized: {solver.ObjectiveValue() / (60 * TIME_UNIT_MS):.2f} minutes")

            for train_id, train in trains.items():
                tvars = train_vars.get(train_id)
                if not tvars:
                    continue

                # Suggested new speeds (if you implement speed as a decision variable)
                # if "max_speed_override" in tvars:
                #     new_speed = solver.Value(tvars["max_speed_override"])
                #     if new_speed != train.speed_mps:
                #         suggestions.append(CPDecision(
                #             train_id=train_id,
                #             action_type="speed_adjust",
                #             value=new_speed
                #         ))

                # Extract suggested delays at stations / before segments
                # Compare solver's departure times with current actual/planned departure times
                for i in range(len(train.route) - 1): # For each segment (u,v)
                    u_node = train.route[i]
                    v_node = train.route[i+1]
                    
                    if u_node in tvars["departure_times"]:
                        solver_departure_ms = solver.Value(tvars["departure_times"][u_node])
                        
                        # Get the current actual/planned departure time for comparison
                        # If the train has already departed, don't suggest a delay for this past event.
                        # Only consider future delays.
                        current_actual_departure_ms = train.actual_departure_times_ms.get(u_node, None)
                        
                        if current_actual_departure_ms is None and u_node == train.route[train.current_route_idx] and not train.current_edge:
                            # Train is waiting at this node (current_route_idx), and has no actual departure yet
                            current_actual_departure_ms = int(current_time_min * 60 * TIME_UNIT_MS) # Assume it could depart now
                        elif current_actual_departure_ms is None: # Not current node, and no actual dep time
                            # Use planned for future nodes
                            current_actual_departure_ms = int(train.planned_times_min.get(u_node, current_time_min) * 60 * TIME_UNIT_MS) # Fallback to current time is risky
                        
                        # Filter for future nodes and actual delays
                        if current_actual_departure_ms is not None and solver_departure_ms > current_actual_departure_ms:
                            suggested_delay_ms = solver_departure_ms - current_actual_departure_ms
                            suggested_delay_min = math.ceil(suggested_delay_ms / (60 * TIME_UNIT_MS))
                            if suggested_delay_min > 0:
                                suggestions.append(CPDecision(
                                    train_id=train_id,
                                    action_type="delay",
                                    value=int(suggested_delay_min), # Use integer minutes
                                    node_id=u_node # Add node_id to specify where delay happens
                                ))
                                
        elif status == cp_model.INFEASIBLE:
            print("CP-SAT Solver could not find a feasible solution (infeasible).")
            # You might want to log more details or suggest relaxing constraints
            # e.g., allow longer delays, temporarily higher speeds, etc.
        else:
            print(f"CP-SAT Solver status: {solver.StatusName(status)}")

        return suggestions