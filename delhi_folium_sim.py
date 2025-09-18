from __future__ import annotations

import math
import os
import random
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import folium


# ------------------------------------------------------------
# Utilities
# ------------------------------------------------------------

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    la1 = math.radians(lat1)
    la2 = math.radians(lat2)
    h = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def polyline_length_m(coords: List[Tuple[float, float]]) -> float:
    if len(coords) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        total += haversine_m(a[0], a[1], b[0], b[1])
    return total


def interpolate_on_polyline(coords: List[Tuple[float, float]], target_m: float) -> Tuple[float, float]:
    if not coords:
        raise ValueError("no coordinates")
    if len(coords) == 1:
        return coords[0]
    acc = 0.0
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        d = haversine_m(a[0], a[1], b[0], b[1])
        if acc + d >= target_m:
            f = 0.0 if d <= 0 else (target_m - acc) / d
            lat = a[0] + (b[0] - a[0]) * f
            lon = a[1] + (b[1] - a[1]) * f
            return (lat, lon)
        acc += d
    return coords[-1]


# ------------------------------------------------------------
# Core data structures
# ------------------------------------------------------------


@dataclass
class Route:
    name: str
    coordinates: List[Tuple[float, float]]  # (lat, lon)
    length_m: float = field(init=False)

    def __post_init__(self) -> None:
        self.length_m = polyline_length_m(self.coordinates)

    def segment_index_at_distance(self, s_m: float) -> int:
        if s_m <= 0:
            return 0
        acc = 0.0
        for i in range(1, len(self.coordinates)):
            a = self.coordinates[i - 1]
            b = self.coordinates[i]
            d = haversine_m(a[0], a[1], b[0], b[1])
            if acc + d >= s_m:
                return i - 1
            acc += d
        return max(0, len(self.coordinates) - 2)


@dataclass
class Train:
    train_id: str
    route: Route
    color: str
    # schedule: start time and end time within the global window (seconds)
    start_s: float
    end_s: float
    nominal_speed_mps: float
    # dynamic state
    cur_s: float = 0.0  # distance progressed along route
    speed_mps: float = 0.0
    delayed_s: float = 0.0
    finished: bool = False

    def reset(self) -> None:
        self.cur_s = 0.0
        self.speed_mps = 0.0
        self.delayed_s = 0.0
        self.finished = False

    def desired_speed_at_time(self, t_s: float) -> float:
        # target to finish at end_s; if behind schedule, increase up to 1.5x nominal
        duration = max(1.0, self.end_s - self.start_s)
        target_progress = (t_s - self.start_s) / duration
        target_progress = max(0.0, min(1.0, target_progress))
        target_s = target_progress * self.route.length_m
        lag_m = max(0.0, target_s - self.cur_s)
        boost = 1.0 + min(0.5, lag_m / max(1.0, self.route.length_m) * 2.0)
        return min(self.nominal_speed_mps * boost, self.nominal_speed_mps * 1.75)


class Simulator:
    def __init__(self, routes: Dict[str, Route], trains: List[Train], window_minutes: float = 30.0, tick_s: float = 2.0):
        self.routes = routes
        self.trains = trains
        self.window_s = window_minutes * 60.0
        self.tick_s = tick_s
        self.time_s = 0.0
        # precompute route segment cumulative lengths for occupancy checks
        self._route_segments: Dict[str, List[Tuple[float, float]]] = {}
        for r in routes.values():
            self._route_segments[r.name] = self._compute_segment_cum_lengths(r.coordinates)

    @staticmethod
    def _compute_segment_cum_lengths(coords: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        # returns list of (start_m, end_m) for each segment index i=0..n-2
        out: List[Tuple[float, float]] = []
        acc = 0.0
        for i in range(1, len(coords)):
            a = coords[i - 1]
            b = coords[i]
            d = haversine_m(a[0], a[1], b[0], b[1])
            out.append((acc, acc + d))
            acc += d
        return out

    def _active_trains(self) -> List[Train]:
        return [t for t in self.trains if (t.start_s <= self.time_s <= t.end_s) and not t.finished]

    def _advance_train(self, t: Train) -> None:
        if self.time_s < t.start_s:
            t.speed_mps = 0.0
            return
        if t.finished:
            t.speed_mps = 0.0
            return
        desired = t.desired_speed_at_time(self.time_s)
        t.speed_mps = desired
        t.cur_s = min(t.route.length_m, t.cur_s + t.speed_mps * self.tick_s)
        if t.cur_s >= t.route.length_m - 1e-3 or self.time_s >= t.end_s:
            t.finished = True

    def _segment_index(self, t: Train) -> int:
        return t.route.segment_index_at_distance(t.cur_s)

    def _detect_conflicts(self) -> List[Tuple[Train, Train]]:
        # conflict if two trains on same route and same segment, progressing in any direction
        conflicts: List[Tuple[Train, Train]] = []
        for i in range(len(self.trains)):
            a = self.trains[i]
            if a.finished or not (a.start_s <= self.time_s <= a.end_s):
                continue
            for j in range(i + 1, len(self.trains)):
                b = self.trains[j]
                if b.finished or not (b.start_s <= self.time_s <= b.end_s):
                    continue
                if a.route.name != b.route.name:
                    continue
                if self._segment_index(a) == self._segment_index(b):
                    conflicts.append((a, b))
        return conflicts

    def _resolve_conflicts(self, conflicts: List[Tuple[Train, Train]]) -> None:
        # slow down the later-started or lower-speed train in the conflicting pair
        for a, b in conflicts:
            # choose victim: train that started later or currently has lower nominal speed
            victim = b if b.start_s >= a.start_s else a
            # reduce speed this tick
            victim.speed_mps *= 0.6
            # don't let it go negative or zero
            victim.speed_mps = max(1.0, victim.speed_mps)
            # back off progress slightly to avoid overlap illusion
            victim.cur_s = max(0.0, victim.cur_s - victim.speed_mps * 0.25)

    def step(self) -> Dict[str, Dict[str, float]]:
        # advance active trains
        for t in self._active_trains():
            self._advance_train(t)
        # detect conflicts and adjust
        conflicts = self._detect_conflicts()
        if conflicts:
            self._resolve_conflicts(conflicts)
        # build telemetry
        positions: Dict[str, Dict[str, float]] = {}
        for t in self.trains:
            if not (t.start_s <= self.time_s <= t.end_s) and not t.finished:
                continue
            lat, lon = interpolate_on_polyline(t.route.coordinates, t.cur_s)
            positions[t.train_id] = {
                "lat": lat,
                "lon": lon,
                "progress": 0.0 if t.route.length_m <= 0 else min(1.0, t.cur_s / t.route.length_m),
                "speed_mps": t.speed_mps,
                "finished": 1.0 if t.finished else 0.0,
            }
        # advance time
        self.time_s += self.tick_s
        return positions


# ------------------------------------------------------------
# Folium visualization
# ------------------------------------------------------------


class FoliumRenderer:
    def __init__(self, center_lat: float, center_lon: float, zoom_start: int = 12) -> None:
        self.center_lat = center_lat
        self.center_lon = center_lon
        self.zoom_start = zoom_start

    @staticmethod
    def _color_for(name: str) -> str:
        colors = [
            "red", "blue", "green", "purple", "orange", "darkred", "lightred",
            "beige", "darkblue", "darkgreen", "cadetblue", "darkpurple", "white",
            "pink", "lightblue", "lightgreen", "gray", "black", "lightgray",
        ]
        idx = (sum(ord(c) for c in name) % len(colors))
        return colors[idx]

    def render_frame(self, routes: Dict[str, Route], trains: List[Train], positions: Dict[str, Dict[str, float]], out_html: str) -> None:
        m = folium.Map(location=[self.center_lat, self.center_lon], zoom_start=self.zoom_start, control_scale=True, tiles="OpenStreetMap")
        # draw polylines for each route
        for rname, route in routes.items():
            folium.PolyLine(route.coordinates, color=self._color_for(rname), weight=4, opacity=0.8, tooltip=f"Route {rname}").add_to(m)
        # draw train markers
        for t in trains:
            pos = positions.get(t.train_id)
            if not pos:
                continue
            popup = folium.Popup(html=f"<b>{t.train_id}</b><br>speed={pos['speed_mps']:.1f} m/s<br>progress={pos['progress']*100:.1f}%", max_width=250)
            folium.CircleMarker(
                location=(pos["lat"], pos["lon"]),
                radius=6,
                color=t.color,
                fill=True,
                fill_color=t.color,
                fill_opacity=0.95,
                popup=popup,
            ).add_to(m)
        m.save(out_html)


# ------------------------------------------------------------
# Demo wiring with dummy Delhi coordinates
# ------------------------------------------------------------


def build_dummy_routes() -> Dict[str, Route]:
    # Dummy polylines roughly around central Delhi (replace with real traced tracks)
    # NDLS -> DLI
    r1 = Route(
        name="NDLS_DLI",
        coordinates=[
            (28.6430, 77.2190),
            (28.6500, 77.2220),
            (28.6570, 77.2250),
            (28.6670, 77.2270),
        ],
    )
    # DLI -> ANVT
    r2 = Route(
        name="DLI_ANVT",
        coordinates=[
            (28.6670, 77.2270),
            (28.6500, 77.2450),
            (28.6300, 77.2650),
            (28.6070, 77.2890),
        ],
    )
    # NDLS -> NZM
    r3 = Route(
        name="NDLS_NZM",
        coordinates=[
            (28.6430, 77.2190),
            (28.6300, 77.2260),
            (28.6100, 77.2400),
            (28.5880, 77.2510),
        ],
    )
    # NZM -> ANVT
    r4 = Route(
        name="NZM_ANVT",
        coordinates=[
            (28.5880, 77.2510),
            (28.6000, 77.2650),
            (28.6100, 77.2770),
            (28.6070, 77.2890),
        ],
    )
    # Reverse directions (simple reuse reversed coords)
    r1r = Route("DLI_NDLS", list(reversed(r1.coordinates)))
    r2r = Route("ANVT_DLI", list(reversed(r2.coordinates)))
    r3r = Route("NZM_NDLS", list(reversed(r3.coordinates)))
    r4r = Route("ANVT_NZM", list(reversed(r4.coordinates)))
    routes = {r.name: r for r in [r1, r2, r3, r4, r1r, r2r, r3r, r4r]}
    return routes


def build_trains(routes: Dict[str, Route]) -> List[Train]:
    colors = ["red", "blue", "green", "purple", "orange", "pink", "black", "cadetblue"]
    # 8 trains across routes in 30 minutes, staggered starts
    window_s = 30 * 60
    trains: List[Train] = []
    choices = ["NDLS_DLI", "DLI_ANVT", "NDLS_NZM", "NZM_ANVT", "DLI_NDLS", "ANVT_DLI", "NZM_NDLS", "ANVT_NZM"]
    for i in range(8):
        rname = choices[i % len(choices)]
        r = routes[rname]
        start = i * (window_s / 16.0)  # spread out
        nominal = random.uniform(18.0, 30.0)  # m/s ~ 65-108 km/h
        # choose end time so nominal speed would approximately finish exactly at end
        nominal_duration = max(1.0, r.length_m / nominal)
        end = start + nominal_duration + random.uniform(-120, 180)  # some early/late variation
        end = min(window_s, max(start + 300, end))  # ensure >=5 minutes run and within window
        trains.append(Train(
            train_id=f"TR{i+1}",
            route=r,
            color=colors[i % len(colors)],
            start_s=start,
            end_s=end,
            nominal_speed_mps=nominal,
        ))
    return trains


def run_simulation(output_dir: str = "folium_frames", minutes: float = 30.0, tick_s: float = 2.0, realtime: bool = False) -> None:
    routes = build_dummy_routes()
    trains = build_trains(routes)
    # center near New Delhi
    center = (28.6400, 77.2300)
    renderer = FoliumRenderer(center_lat=center[0], center_lon=center[1], zoom_start=12)
    sim = Simulator(routes, trains, window_minutes=minutes, tick_s=tick_s)

    os.makedirs(output_dir, exist_ok=True)
    total_steps = int((minutes * 60.0) / tick_s)
    for step in range(total_steps + 1):
        positions = sim.step()
        out_file = os.path.join(output_dir, f"frame_{step:05d}.html")
        renderer.render_frame(routes, trains, positions, out_file)
        if realtime:
            time.sleep(tick_s)

    print(f"Generated {total_steps + 1} frames in '{output_dir}'. Open the latest HTML to view.")


if __name__ == "__main__":
    # Example run: accelerated (no real-time sleep) to write frames quickly
    run_simulation(output_dir="folium_frames", minutes=0.5, tick_s=2.0, realtime=False)


