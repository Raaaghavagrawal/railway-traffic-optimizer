import logging
import threading
import time
import networkx as nx
from flask import Flask, jsonify
from flask_cors import CORS
try:
	from graph_builder import RailwayGraphBuilder
	from simulation import Simulation, create_app
except ImportError:
	RailwayGraphBuilder = None  # type: ignore[assignment]
	Simulation = None  # type: ignore[assignment]
	create_app = None  # type: ignore[assignment]

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
	# Load existing graph to avoid heavy OSM fetch and SciPy deps
	if RailwayGraphBuilder is not None and Simulation is not None and create_app is not None:
		builder = RailwayGraphBuilder()
		G = builder.load_graph('delhi_railway_graph.json')
		logger.info("Graph loaded: %d nodes, %d edges", G.number_of_nodes(), G.number_of_edges())

		# Build a simulation
		sim = Simulation(G)

		# Seed a sample train along shortest path between two stations if possible
		stations = builder.get_station_nodes()
		seeded = False
		if len(stations) >= 2:
			try:
				path = nx.shortest_path(G, stations[0], stations[1], weight='length')
				if len(path) >= 2:
					sim.add_train_on_path('T001', path, initial_speed_mps=12.0)
					logger.info("Seeded demo train T001 on path of %d nodes", len(path))
					seeded = True
			except Exception as e:
				logger.warning("No viable path between first two stations: %s", e)

		# Fallback: seed along first available edge if station path missing
		if not seeded:
			for u, v in G.edges():
				if u != v and G.has_edge(u, v):
					if sim.add_train_on_path('T001', [u, v], initial_speed_mps=10.0):
						logger.info("Seeded fallback train T001 from %s to %s", u, v)
						seeded = True
						break
		if not seeded:
			logger.warning("Could not seed any demo train; graph may be empty")

		# Start simulation loop
		sim.start()

		# Flask app on port 3000
		app = create_app(sim)
		# Enable CORS for all routes
		CORS(app)
	else:
		# Fallback minimal Flask app when optional modules are missing
		app = Flask(__name__)
		CORS(app)

	# --- Simple live position simulator (dummy) ---
	# This uses a background thread, time.sleep and a simple for-loop to move
	# a few trains along predefined GPS polylines. The dashboard can poll
	# /train_positions to get the current lat/lon for each train.

	# Dummy polylines between NDLS, DLI, NZM, ANVT (replace with real traces)
	DUMMY_ROUTES = {
		"TR1": [
			(28.6430, 77.2190), (28.6460, 77.2210), (28.6510, 77.2235), (28.6580, 77.2255), (28.6670, 77.2270)
		],  # NDLS -> DLI
		"TR2": [
			(28.6670, 77.2270), (28.6550, 77.2400), (28.6420, 77.2550), (28.6250, 77.2720), (28.6070, 77.2890)
		],  # DLI -> ANVT
		"TR3": [
			(28.6430, 77.2190), (28.6350, 77.2240), (28.6200, 77.2350), (28.6020, 77.2440), (28.5880, 77.2510)
		],  # NDLS -> NZM
		"TR4": [
			(28.5880, 77.2510), (28.5960, 77.2600), (28.6030, 77.2700), (28.6060, 77.2800), (28.6070, 77.2890)
		],  # NZM -> ANVT
	}

	_positions_lock = threading.Lock()
	_train_positions = {tid: {"lat": pts[0][0], "lon": pts[0][1], "idx": 0} for tid, pts in DUMMY_ROUTES.items()}

	def _advance_positions_loop():
		# Simple loop that advances each train to the next point every 2 seconds
		while True:
			with _positions_lock:
				for tid, pts in DUMMY_ROUTES.items():
					state = _train_positions[tid]
					next_idx = (state["idx"] + 1) % len(pts)
					lat, lon = pts[next_idx]
					state.update({"lat": lat, "lon": lon, "idx": next_idx})
			time.sleep(2.0)

	# start background thread
	threading.Thread(target=_advance_positions_loop, name="positions-loop", daemon=True).start()

	# Additional endpoints expected by frontend (only if sim available)
	if 'sim' in locals():
		@app.get('/graph')
		def get_graph():
			try:
				g = sim.graph
				nodes = []
				for nid, data in g.nodes(data=True):
					nodes.append({
						'id': nid,
						'type': data.get('type'),
						'lat': data.get('lat'),
						'lon': data.get('lon'),
						'name': data.get('name')
					})
				edges = []
				for u, v, data in g.edges(data=True):
					edges.append({
						'source': u,
						'target': v,
						'length': data.get('length'),
						'max_speed': data.get('max_speed'),
						'geometry_wkt': data.get('geometry_wkt'),
						'direction': data.get('direction'),
					})
				return jsonify({'success': True, 'nodes': nodes, 'edges': edges})
			except Exception as e:
				return jsonify({'success': False, 'error': str(e)}), 500

		@app.get('/stations')
		def get_stations():
			try:
				stations = []
				for node_id, data in sim.graph.nodes(data=True):
					if data.get('type') == 'station':
						stations.append({
							'id': node_id,
							'name': data.get('name', node_id),
							'lat': data.get('lat', 0),
							'lon': data.get('lon', 0),
							'railway_type': data.get('railway_type', 'station'),
							'tags': data.get('tags', {})
						})
				return jsonify({'success': True, 'data': stations, 'count': len(stations)})
			except Exception as e:
				return jsonify({'success': False, 'error': str(e)}), 500

		@app.get('/signals')
		def get_signals():
			try:
				# derive simple signal states from sim
				signal_states = sim.get_signal_states()
				signals = []
				for node_id, data in sim.graph.nodes(data=True):
					if data.get('type') == 'signal':
						signals.append({
							'id': node_id,
							'lat': data.get('lat', 0),
							'lon': data.get('lon', 0),
							'state': signal_states.get(node_id, 'red'),
							'signal_type': data.get('signal_type', 'unknown'),
							'railway_type': data.get('railway_type', 'signal'),
							'tags': data.get('tags', {})
						})
				return jsonify({'success': True, 'data': signals, 'count': len(signals)})
			except Exception as e:
				return jsonify({'success': False, 'error': str(e)}), 500

		@app.get('/trains')
		def get_trains():
			try:
				rows = []
				with sim.lock:
					for t in sim.trains.values():
						u, v = t.edge
						rows.append({
							'train_id': t.train_id,
							'current_node': u,
							'target_node': v,
							'state': t.status.value,
							'speed_mps': round(t.speed_mps, 2),
							'max_speed_mps': round(t.max_speed_mps, 2),
							'delay_s': 0
						})
				return jsonify({'success': True, 'data': rows, 'count': len(rows)})
			except Exception as e:
				return jsonify({'success': False, 'error': str(e)}), 500

	# Live positions endpoint for dashboard polling
	# Additionally support a simple sequence that reveals 1..4 trains per second
	_seq_points = [
		{"train_id": "TR1", "lat": 28.646, "lon": 77.221},
		{"train_id": "TR2", "lat": 28.655, "lon": 77.24},
		{"train_id": "TR3", "lat": 28.635, "lon": 77.224},
		{"train_id": "TR4", "lat": 28.596, "lon": 77.26},
	]
	_seq_lock = threading.Lock()
	_seq_count = {"i": 1}

	def _advance_sequence_loop():
		while True:
			with _seq_lock:
				_seq_count["i"] = 1 if _seq_count["i"] >= 4 else _seq_count["i"] + 1
			time.sleep(1.0)

	threading.Thread(target=_advance_sequence_loop, name="sequence-loop", daemon=True).start()

	@app.get('/train_positions')
	def get_train_positions():
		try:
			with _seq_lock:
				c = int(_seq_count["i"])
			rows = _seq_points[:c]
			return jsonify({"success": True, "data": rows, "count": c})
		except Exception as e:
			return jsonify({'success': False, 'error': str(e)}), 500
	logger.info("Starting API on http://localhost:3000 ...")
	app.run(host='127.0.0.1', port=3000, debug=False, use_reloader=False)


if __name__ == '__main__':
	main()
