from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
import os
import pandas as pd
import json
import networkx as nx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
	from .simulation import RailwaySimulation, Train, TrainType
except ImportError:
	from simulation import RailwaySimulation, Train, TrainType

# CSV dataframes declared early so seeding can reference them
_df_info: Optional[pd.DataFrame] = None
_df_sched: Optional[pd.DataFrame] = None

def build_delhi_network() -> nx.MultiDiGraph:
    """Build graph from precise OSM-derived JSON with exact station coords and track geometry."""
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "delhi_railway_graph.json")
    G = nx.MultiDiGraph()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # nodes
        for n in data.get("nodes", []):
            nid = str(n.get("id"))
            G.add_node(
                nid,
                type=n.get("type") or n.get("railway_type"),
                lat=n.get("lat"),
                lon=n.get("lon"),
                name=n.get("name"),
                tags=n.get("tags", {}),
            )
        # edges
        for e in data.get("edges", []):
            u = str(e.get("source"))
            v = str(e.get("target"))
            length = float(e.get("length") or 0.0)
            coords = e.get("coordinates") or []
            geometry_wkt = None
            if coords and isinstance(coords, list):
                try:
                    # LINESTRING(lon lat, ...)
                    pts = ", ".join([f"{c['lon']} {c['lat']}" for c in coords if 'lat' in c and 'lon' in c])
                    if pts:
                        geometry_wkt = f"LINESTRING({pts})"
                except Exception:
                    geometry_wkt = None
            G.add_edge(u, v, length=length, max_speed=80, geometry_wkt=geometry_wkt, railway_type=e.get("railway_type"))
        return G
    except Exception:
        # Fallback to simple synthetic corridor if JSON not available
        G = nx.MultiDiGraph()
        coords = {
            "DLI": (28.6670, 77.2270),
            "NDLS": (28.6430, 77.2190),
            "NZM": (28.5880, 77.2510),
            "ANVT": (28.6070, 77.2890),
        }
        order = ["DLI", "NDLS", "NZM", "ANVT"]
        names = {"DLI": "Delhi Junction", "NDLS": "New Delhi", "NZM": "Hazrat Nizamuddin", "ANVT": "Anand Vihar Terminal"}
        for nid in order:
            lat, lon = coords[nid]
            G.add_node(nid, type="station", lat=lat, lon=lon, name=names[nid], tags={"ref": nid})
        lengths = {("DLI", "NDLS"): 3000.0, ("NDLS", "NZM"): 6000.0, ("NZM", "ANVT"): 7000.0}
        for (u, v), L in lengths.items():
            G.add_edge(u, v, length=L, max_speed=80)
            G.add_edge(v, u, length=L, max_speed=80)
        return G


def seed_trains(sim: RailwaySimulation) -> None:
    # Seed trains using dataset schedules that include Delhi corridor
    sim.trains.clear()
    if _df_sched is None:
        _load_csvs()
    dataset_trains = _pick_dataset_trains(limit=10)
    if not dataset_trains:
        # fallback to minimal demo
        dataset_trains = [
            {"id": "DLF1", "route": ["DLI","NDLS","NZM","ANVT"], "direction": "forward"},
            {"id": "DLR1", "route": ["ANVT","NZM","NDLS","DLI"], "direction": "reverse"},
        ]
    speeds = [28.0, 30.0, 32.0, 34.0, 36.0]
    for i, meta in enumerate(dataset_trains):
        rid = str(meta.get("id") or f"TR{i+1}")
        # Build a detailed route over the actual track topology
        detailed = _build_corridor_route(meta.get("direction") or "forward") or meta.get("route") or ["DLI","NDLS","NZM","ANVT"]
        speed = speeds[i % len(speeds)]
        start_min = i  # stagger to avoid overlap at start
        # Ensure route is node ids existing in G
        cleaned = [nid for nid in detailed if nid in G.nodes]
        if len(cleaned) >= 2 and any(G.has_edge(cleaned[j], cleaned[j+1]) for j in range(len(cleaned)-1)):
            sim.add_train(Train(id=rid, type=TrainType.EXPRESS, speed_mps=float(speed), priority=1, route=cleaned, planned_times_min={cleaned[0]: start_min}))


@asynccontextmanager
async def lifespan(app: FastAPI):
	await sim.start()
	try:
		yield
	except Exception:
		raise
	finally:
		await sim.stop()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

G = build_delhi_network()
sim = RailwaySimulation(G, minute_seconds=0.25)


def _csv_path(filename: str) -> str:
    # CSVs are in project root; backend file is in backend/ directory
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, os.pardir))
    return os.path.join(root, filename)


def _load_csvs() -> None:
    global _df_info, _df_sched
    try:
        info_path = _csv_path("train_info.csv")
        sched_path = _csv_path("train_schedule.csv")
        if os.path.exists(info_path):
            _df_info = pd.read_csv(info_path)
        else:
            _df_info = None
        if os.path.exists(sched_path):
            _df_sched = pd.read_csv(sched_path)
        else:
            _df_sched = None
    except Exception:
        _df_info = None
        _df_sched = None


_load_csvs()
# Initial seeding after CSVs are available
try:
    seed_trains(sim)
except Exception:
    # fallback will seed minimal demo if dataset not ready
    pass

# Map primary station codes to node ids from the JSON graph (exact coords)
_PRIMARY_CODES = ["DLI", "NDLS", "NZM", "ANVT"]
_PRIMARY_MAP: Dict[str, str] = {}


def _build_primary_map() -> None:
    global _PRIMARY_MAP
    out: Dict[str, str] = {}
    # First pass: by exact ref tag
    for nid, data in G.nodes(data=True):
        tags = data.get("tags") or {}
        ref = tags.get("ref") or tags.get("REF")
        if isinstance(ref, str) and ref in _PRIMARY_CODES:
            out[ref] = nid
    # Fallback by name contains
    if len(out) < 4:
        for nid, data in G.nodes(data=True):
            name = (data.get("name") or "").lower()
            if "delhi junction" in name:
                out.setdefault("DLI", nid)
            if name == "new delhi" or "new delhi metro" in name:
                out.setdefault("NDLS", nid)
            if "nizamuddin" in name:
                out.setdefault("NZM", nid)
            if "anand vihar" in name:
                out.setdefault("ANVT", nid)
    # Final fallback: pick nearest station node to known IR station coordinates
    if len(out) < 4:
        from math import radians, sin, cos, atan2, sqrt
        def haversine(lat1, lon1, lat2, lon2):
            R = 6371000.0
            dlat = radians(lat2 - lat1)
            dlon = radians(lon2 - lon1)
            la1 = radians(lat1)
            la2 = radians(lat2)
            h = sin(dlat/2)**2 + cos(la1)*cos(la2)*sin(dlon/2)**2
            return 2*R*atan2(sqrt(h), sqrt(1-h))
        targets = {
            "DLI": (28.660932, 77.2276494),
            "NDLS": (28.6434826, 77.2227421),
            "NZM": (28.5880, 77.2510),
            "ANVT": (28.6070, 77.2890),
        }
        for code, (tlat, tlon) in targets.items():
            if code in out:
                continue
            best_id = None
            best_d = 1e18
            for nid, data in G.nodes(data=True):
                if (data.get("type") or "").startswith("station") and data.get("lat") is not None and data.get("lon") is not None:
                    d = haversine(float(data["lat"]), float(data["lon"]), tlat, tlon)
                    if d < best_d:
                        best_d = d
                        best_id = nid
            if best_id is not None:
                out.setdefault(code, best_id)
    _PRIMARY_MAP = out


_build_primary_map()


def _concat_paths(paths: List[List[str]]) -> List[str]:
    route: List[str] = []
    for seg in paths:
        if not seg:
            continue
        if not route:
            route.extend(seg)
        else:
            # avoid duplicating the junction node
            route.extend(seg[1:])
    return route


def _build_corridor_route(direction: str) -> Optional[List[str]]:
    if len(_PRIMARY_MAP) < 2:
        return None
    try:
        order_codes = ["DLI", "NDLS", "NZM", "ANVT"] if direction != "reverse" else ["ANVT", "NZM", "NDLS", "DLI"]
        node_seq = [_PRIMARY_MAP[c] for c in order_codes if c in _PRIMARY_MAP]
        if len(node_seq) < 2:
            return None
        # Compute shortest paths along the detailed track network
        segs: List[List[str]] = []
        for i in range(len(node_seq) - 1):
            u = node_seq[i]
            v = node_seq[i + 1]
            # if path fails, skip segment
            try:
                segs.append(nx.shortest_path(G, u, v, weight=lambda a, b, k, d: d.get("length", 1.0)))
            except Exception:
                continue
        return _concat_paths(segs)
    except Exception:
        return None

# Delhi corridor station codes used in dataset schedule matching
_DELHI_CODES = ["DLI", "NDLS", "NZM", "ANVT"]
_CORRIDOR_TRAIN_NOS: Optional[set[str]] = None


def _infer_direction_from_schedule(train_no: str) -> Optional[str]:
    if _df_sched is None:
        return None
    try:
        df = _df_sched
        sub = df[df["Train_No"].astype(str) == str(train_no)]
        if sub.empty:
            return None
        codes = sub["Station_Code"].astype(str).tolist()
        # Preserve only the Delhi corridor stations in their schedule order
        corridor_visits = [c for c in codes if c in _DELHI_CODES]
        if len(corridor_visits) < 2:
            return None
        index_map = {code: i for i, code in enumerate(_DELHI_CODES)}
        first_idx = index_map.get(corridor_visits[0], -1)
        last_idx = index_map.get(corridor_visits[-1], -1)
        if first_idx < 0 or last_idx < 0 or first_idx == last_idx:
            return None
        return "forward" if first_idx < last_idx else "reverse"
    except Exception:
        return None


def _pick_dataset_trains(limit: int = 10) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if _df_sched is None:
        return out
    try:
        df = _df_sched
        # Candidate trains: those that traverse within the Delhi corridor (>=2 corridor visits)
        mask = df["Station_Code"].astype(str).isin(_DELHI_CODES)
        candidates = df.loc[mask, ["Train_No"]].drop_duplicates()
        allowed: set[str] = set()
        for tno in candidates["Train_No"].astype(str).tolist():
            sub = df[df["Train_No"].astype(str) == str(tno)]
            codes = sub["Station_Code"].astype(str).tolist()
            corridor_visits = [c for c in codes if c in _DELHI_CODES]
            if len(corridor_visits) >= 2:
                allowed.add(str(tno))
        global _CORRIDOR_TRAIN_NOS
        _CORRIDOR_TRAIN_NOS = allowed
        # Build list with inferred direction
        cand_list = [
            {"Train_No": tno} for tno in allowed
        ]
        for row in cand_list[: limit * 3]:
            tno = str(row["Train_No"])
            direction = _infer_direction_from_schedule(tno)
            if not direction:
                continue
            route = ["DLI", "NDLS", "NZM", "ANVT"] if direction == "forward" else ["ANVT", "NZM", "NDLS", "DLI"]
            out.append({"id": tno, "route": route, "direction": direction})
            if len(out) >= limit:
                break
        return out
    except Exception:
        return out


class InjectDelayIn(BaseModel):
	train_id: str
	delay_min: int


@app.get("/network")
async def get_network() -> Dict[str, Any]:
	nodes: List[Dict[str, Any]] = []
	for nid, data in G.nodes(data=True):
		nodes.append({"id": nid, "type": data.get("type"), "lat": data.get("lat"), "lon": data.get("lon"), "name": data.get("name")})
	edges: List[Dict[str, Any]] = []
	for u, v, data in G.edges(data=True):
		edges.append({"source": u, "target": v, "length": data.get("length"), "max_speed": data.get("max_speed"), "geometry_wkt": data.get("geometry_wkt")})
	return {"nodes": nodes, "edges": edges}


@app.get("/stations")
async def get_stations() -> Dict[str, Any]:
    nodes: List[Dict[str, Any]] = []
    for nid, data in G.nodes(data=True):
        if data.get("type") == "station":
            nodes.append({"id": nid, "lat": data.get("lat"), "lon": data.get("lon"), "name": data.get("name")})
    return {"stations": nodes}


@app.get("/trains")
async def get_trains() -> Dict[str, Any]:
	return sim.state_snapshot()


def _parse_wkt_linestring(wkt: Optional[str]) -> List[List[float]]:
    if not wkt or not isinstance(wkt, str) or not wkt.startswith("LINESTRING"):
        return []
    try:
        inside = wkt[wkt.index("(") + 1 : wkt.rindex(")")]
        pts = []
        for part in inside.split(","):
            part = part.strip()
            if not part:
                continue
            lon_str, lat_str = part.split()
            pts.append([float(lat_str), float(lon_str)])
        return pts
    except Exception:
        return []


def _edge_polyline(u: str, v: str) -> List[List[float]]:
    if not G.has_edge(u, v):
        return []
    data = G[u][v][0]
    pts = _parse_wkt_linestring(data.get("geometry_wkt"))
    if pts:
        return pts
    a = G.nodes.get(u) or {}
    b = G.nodes.get(v) or {}
    if a.get("lat") is not None and a.get("lon") is not None and b.get("lat") is not None and b.get("lon") is not None:
        return [[a["lat"], a["lon"]], [b["lat"], b["lon"]]]
    return []


def _locate_train_latlon(train_id: str) -> Optional[Dict[str, Any]]:
    t = sim.trains.get(train_id)
    if not t:
        return None
    if not t.current_edge:
        # if not started, place at first node
        if t.route:
            n0 = t.route[0]
            ndata = G.nodes.get(n0) or {}
            if ndata.get("lat") is not None and ndata.get("lon") is not None:
                return {"lat": ndata["lat"], "lon": ndata["lon"], "status": t.status}
        return None
    u, v = t.current_edge
    poly = _edge_polyline(u, v)
    if len(poly) < 2:
        return None
    # compute fraction along edge
    length = sim._edge_length(u, v)
    frac = 0.0 if length <= 0 else max(0.0, min(1.0, (t.position or 0.0) / length))
    # project along polyline by distance fraction
    # approximate distance using haversine via leaflet-like computation
    def segdist(a, b):
        from math import radians, sin, cos, atan2, sqrt
        R = 6371000.0
        dlat = radians(b[0] - a[0])
        dlon = radians(b[1] - a[1])
        la1 = radians(a[0])
        la2 = radians(b[0])
        h = sin(dlat/2)**2 + cos(la1)*cos(la2)*sin(dlon/2)**2
        return 2*R*atan2(sqrt(h), sqrt(1-h))
    total = 0.0
    for i in range(1, len(poly)):
        total += segdist(poly[i-1], poly[i])
    target = frac * total
    acc = 0.0
    for i in range(1, len(poly)):
        a = poly[i-1]; b = poly[i]
        d = segdist(a, b)
        if acc + d >= target:
            f = 0.0 if d <= 0 else (target - acc) / d
            lat = a[0] + (b[0] - a[0]) * f
            lon = a[1] + (b[1] - a[1]) * f
            return {"lat": lat, "lon": lon, "status": t.status}
        acc += d
    last = poly[-1]
    return {"lat": last[0], "lon": last[1], "status": t.status}


@app.get("/train/{train_id}/position")
async def get_train_position(train_id: str) -> Dict[str, Any]:
    p = _locate_train_latlon(train_id)
    if not p:
        return {"success": False, "error": "train not found or not positioned"}
    return {"success": True, "position": p}


@app.get("/train/search")
async def search_trains(q: str) -> Dict[str, Any]:
    if not _df_info is not None:
        _load_csvs()
    if _df_info is None:
        return {"trains": []}
    ql = q.strip().lower()
    df = _df_info
    # Match on Train_No or Train_Name contains
    try:
        # Base name/number match
        mask = (
            df["Train_No"].astype(str).str.contains(ql, case=False, na=False)
            | df["Train_Name"].astype(str).str.lower().str.contains(ql, na=False)
        )
        # If corridor set is available, restrict to those trains only
        global _CORRIDOR_TRAIN_NOS
        if _CORRIDOR_TRAIN_NOS is not None and len(_CORRIDOR_TRAIN_NOS) > 0:
            mask = mask & df["Train_No"].astype(str).isin(list(_CORRIDOR_TRAIN_NOS))
        cols = ["Train_No", "Train_Name", "Source_Station_Name", "Destination_Station_Name", "days"]
        rows = df.loc[mask, cols].head(20).to_dict(orient="records")  # type: ignore[arg-type]
        return {"trains": rows}
    except Exception:
        return {"trains": []}


@app.get("/train/{train_no}/route")
async def get_train_route(train_no: str) -> Dict[str, Any]:
    if not _df_sched is not None:
        _load_csvs()
    if _df_sched is None:
        return {"stations": []}
    df = _df_sched
    try:
        sub = df[df["Train_No"].astype(str) == str(train_no)]
        cols = ["Station_Code", "Station_Name", "Arrival_time", "Departure_Time", "Distance"]
        rows = sub[cols].to_dict(orient="records")  # type: ignore[arg-type]
        return {"stations": rows}
    except Exception:
        return {"stations": []}


@app.post("/delay")
async def post_delay(body: InjectDelayIn) -> Dict[str, Any]:
	t = sim.trains.get(body.train_id)
	if not t:
		return {"success": False, "error": "train not found"}
	t.delay_min += max(0, int(body.delay_min))
	return {"success": True}


@app.post("/reset")
async def post_reset() -> Dict[str, Any]:
	sim.reset()
	return {"success": True}


@app.post("/reload_csv")
async def post_reload_csv() -> Dict[str, Any]:
    _load_csvs()
    return {"success": True, "info_loaded": _df_info is not None, "schedule_loaded": _df_sched is not None}


@app.post("/simulate/train")
async def post_simulate_train(
    direction: Optional[str] = None,
    train_no: Optional[str] = None,
    speed_mps: Optional[float] = None,
) -> Dict[str, Any]:
    # Restrict to Delhi corridor only; accept params via query or JSON-form-urldecoded
    dir_val = (direction or "forward").lower()
    detailed = _build_corridor_route(dir_val)
    route = detailed if detailed and len(detailed) >= 2 else (["DLI", "NDLS", "NZM", "ANVT"] if dir_val != "reverse" else ["ANVT", "NZM", "NDLS", "DLI"])
    # Reset and seed a single train for clear visualization
    sim.trains.clear()
    spd = speed_mps if isinstance(speed_mps, (int, float)) and (speed_mps or 0) > 0 else 35.0
    tid = f"TR{str(train_no) if train_no else 'DEMO'}"
    sim.add_train(Train(id=tid, type=TrainType.EXPRESS, speed_mps=float(spd), priority=1, route=route, planned_times_min={route[0]: 0}))
    sim.reset()
    return {"success": True, "train_id": tid, "route": route}


@app.post("/simulate/reseed")
async def post_simulate_reseed() -> Dict[str, Any]:
    # Create 8-10 trains from dataset that traverse the Delhi corridor
    seed_trains(sim)
    sim.reset()
    return {"success": True, "num_trains": len(sim.trains)}


@app.post("/simulate/by_train_no")
async def post_simulate_by_train_no(train_no: str) -> Dict[str, Any]:
    # Ensure corridor set is available
    if _df_sched is None:
        _load_csvs()
    if _CORRIDOR_TRAIN_NOS is None or len(_CORRIDOR_TRAIN_NOS) == 0:
        # populate via picker (it caches allowed set)
        _ = _pick_dataset_trains(limit=10)
    if _CORRIDOR_TRAIN_NOS is None or str(train_no) not in _CORRIDOR_TRAIN_NOS:
        return {"success": False, "error": "train does not traverse the Delhi corridor (DLI/NDLS/NZM/ANVT)"}
    direction = _infer_direction_from_schedule(str(train_no)) or "forward"
    detailed = _build_corridor_route(direction)
    route = detailed if detailed and len(detailed) >= 2 else (["DLI", "NDLS", "NZM", "ANVT"] if direction != "reverse" else ["ANVT", "NZM", "NDLS", "DLI"])
    # Reset to simulate only this selected train on corridor
    sim.trains.clear()
    sim.add_train(Train(id=str(train_no), type=TrainType.EXPRESS, speed_mps=32.0, priority=1, route=route, planned_times_min={route[0]: 0}))
    sim.reset()
    return {"success": True, "train_id": str(train_no), "route": route, "direction": direction}


@app.get("/train/{train_no}/corridor_check")
async def get_train_corridor_check(train_no: str) -> Dict[str, Any]:
    if _df_sched is None:
        _load_csvs()
    if _df_sched is None:
        return {"success": False, "error": "schedule not loaded"}
    try:
        df = _df_sched
        sub = df[df["Train_No"].astype(str) == str(train_no)]
        codes = sub["Station_Code"].astype(str).tolist()
        visits = [c for c in codes if c in _DELHI_CODES]
        qualifies = len(visits) >= 2
        direction = _infer_direction_from_schedule(str(train_no)) if qualifies else None
        return {
            "success": True,
            "qualifies": qualifies,
            "visits": visits,
            "direction": direction,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/optimize")
async def post_optimize(body: Dict[str, Any] | None = None) -> Dict[str, Any]:
	# trigger an immediate decisions computation based on current conflicts
	# Reuse internal optimizer from simulation
	try:
		conflicts = sim._find_conflicts()  # type: ignore[attr-defined]
		decisions = sim._optimizer.decide(conflicts, sim.trains)  # type: ignore[attr-defined]
		return {"success": True, "decisions": decisions}
	except Exception as e:
		return {"success": False, "error": str(e)}


@app.websocket("/updates")
async def ws_updates(ws: WebSocket) -> None:
	await ws.accept()
	try:
		queue = await sim.updates()
		while True:
			msg = await queue.get()
			await ws.send_json(msg)
	except WebSocketDisconnect:
		return


if __name__ == "__main__":
	import uvicorn
	uvicorn.run(app, host="0.0.0.0", port=8000)
