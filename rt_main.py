import asyncio
from typing import Any, Dict, List
from contextlib import asynccontextmanager

import networkx as nx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from rt_simulation import AsyncSimulation, Train, TrainPriority, Event, EventType


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start async simulation on startup
    await sim.start()
    try:
        yield
    finally:
        # Stop on shutdown
        await sim.stop()

app = FastAPI(lifespan=lifespan)
app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)

# Build a tiny demo network: 2 stations, 1 junction, 1 track each way
G = nx.MultiDiGraph()
# nodes with lat/lon
G.add_node("S1", type="station", lat=28.6448, lon=77.2167, name="Station A")
G.add_node("J1", type="junction", lat=28.6460, lon=77.2200, name="Junction")
G.add_node("S2", type="station", lat=28.6472, lon=77.2230, name="Station B")
# edges with length (meters) and optional max_speed (km/h)
G.add_edge("S1", "J1", length=3000.0, max_speed=60)
G.add_edge("J1", "S2", length=2500.0, max_speed=60)
G.add_edge("S2", "J1", length=2500.0, max_speed=60)
G.add_edge("J1", "S1", length=3000.0, max_speed=60)

sim = AsyncSimulation(G, tick_seconds=0.5)

# Seed trains
sim.add_train(Train(train_id="EXP1", priority=TrainPriority.EXPRESS, max_speed_mps=35.0, path_nodes=["S1", "J1", "S2"], speed_mps=20.0))
sim.add_train(Train(train_id="FRG1", priority=TrainPriority.FREIGHT, max_speed_mps=20.0, path_nodes=["S2", "J1", "S1"], speed_mps=12.0))


class EventIn(BaseModel):
	type: EventType
	train_id: str
	payload: Dict[str, Any] = {}


# (startup/shutdown handled by FastAPI lifespan)


@app.get("/network")
async def get_network() -> Dict[str, Any]:
	nodes = []
	for nid, data in G.nodes(data=True):
		nodes.append({"id": nid, "type": data.get("type"), "lat": data.get("lat"), "lon": data.get("lon"), "name": data.get("name")})
	edges = []
	for u, v, data in G.edges(data=True):
		edges.append({"source": u, "target": v, "length": data.get("length"), "max_speed": data.get("max_speed")})
	return {"nodes": nodes, "edges": edges}


@app.get("/trains")
async def get_trains() -> Dict[str, Any]:
	return sim.telemetry_state()


@app.post("/event")
async def post_event(evt: EventIn) -> Dict[str, Any]:
	ok = sim.inject_event(Event(type=evt.type, train_id=evt.train_id, payload=evt.payload))
	return {"success": ok}


@app.post("/optimize")
async def post_optimize(body: Dict[str, Any] | None = None) -> Dict[str, Any]:
	"""Run a quick CP-SAT precedence optimize and return the suggested plan."""
	try:
		headway_s = float((body or {}).get("headway_s", 60.0))
	except Exception:
		headway_s = 60.0
	plan = sim._optimizer.build_and_solve(sim.graph, list(sim.trains.values()), sim.tick_seconds, horizon_s=headway_s*10)
	return {"success": True, "plan": plan}


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


# --- OSM API v0.6 integration helpers ---
import requests
import xml.etree.ElementTree as ET


def _parse_osm_map_xml(xml_text: str) -> Dict[str, Any]:
	root = ET.fromstring(xml_text)
	node_by_id: Dict[str, Dict[str, Any]] = {}
	for n in root.findall('node'):
		nid = n.get('id')
		lat = n.get('lat')
		lon = n.get('lon')
		tags: Dict[str, str] = {}
		for t in n.findall('tag'):
			tags[t.get('k') or ''] = t.get('v') or ''
		node_by_id[nid] = {'id': nid, 'lat': float(lat) if lat else None, 'lon': float(lon) if lon else None, 'tags': tags}
	nodes: List[Dict[str, Any]] = []
	for nid, data in node_by_id.items():
		rtag = data['tags'].get('railway')
		if rtag in ('station','halt','signal'):
			nodes.append({'id': nid, 'type': 'station' if rtag in ('station','halt') else 'signal', 'lat': data['lat'], 'lon': data['lon'], 'name': data['tags'].get('name')})
	edges: List[Dict[str, Any]] = []
	for w in root.findall('way'):
		tags: Dict[str, str] = {}
		for t in w.findall('tag'):
			tags[t.get('k') or ''] = t.get('v') or ''
		if tags.get('railway') != 'rail':
			continue
		nds = [nd.get('ref') for nd in w.findall('nd') if nd.get('ref') in node_by_id]
		if len(nds) < 2:
			continue
		for i in range(len(nds)-1):
			u = nds[i]; v = nds[i+1]
			if node_by_id.get(u) and node_by_id.get(v):
				edges.append({'source': u, 'target': v, 'length': None, 'max_speed': tags.get('maxspeed')})
	present = {n['id'] for n in nodes}
	for e in edges:
		for nid in (e['source'], e['target']):
			if nid not in present:
				nd = node_by_id.get(nid)
				if nd and nd.get('lat') is not None and nd.get('lon') is not None:
					nodes.append({'id': nid, 'type': 'track_endpoint', 'lat': nd['lat'], 'lon': nd['lon'], 'name': None})
					present.add(nid)
	return {'nodes': nodes, 'edges': edges}


@app.get('/network_osm')
async def network_osm(bbox: str = '') -> Dict[str, Any]:
	"""Fetch live OSM data via API v0.6 map endpoint and adapt it.
	bbox format: min_lon,min_lat,max_lon,max_lat. See OSM API doc https://wiki.openstreetmap.org/wiki/API_v0.6
	"""
	try:
		if not bbox:
			bbox = '77.21,28.64,77.23,28.65'
		url = f'https://api.openstreetmap.org/api/0.6/map?bbox={bbox}'
		r = requests.get(url, timeout=60)
		r.raise_for_status()
		data = _parse_osm_map_xml(r.text)
		return {'success': True, **data}
	except Exception as e:
		return {'success': False, 'error': str(e)}
