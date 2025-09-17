import logging
import networkx as nx
from flask import jsonify
from flask_cors import CORS
from graph_builder import RailwayGraphBuilder
from simulation import Simulation, create_app

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
	# Load existing graph to avoid heavy OSM fetch and SciPy deps
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

	# Additional endpoints expected by frontend
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
	logger.info("Starting API on http://localhost:3000 ...")
	app.run(host='127.0.0.1', port=3000, debug=False, use_reloader=False)


if __name__ == '__main__':
	main()
