"""
Test script for Railway Network Simulator
Tests individual components and integration
"""

import time
import logging
from data_loader import RailwayDataLoader
from graph_builder import RailwayGraphBuilder
from simulation import RailwaySimulation

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_data_loading():
    """Test data loading"""
    print("=== Testing Data Loading ===")
    
    loader = RailwayDataLoader()
    
    # Test with a smaller area to avoid timeout
    try:
        railway_data = loader.load_railway_data(28.6448, 77.2167, radius_km=1.0)  # New Delhi, 1km radius
        
        print(f"✅ Data loaded successfully:")
        print(f"  - Tracks: {len(railway_data['tracks'])}")
        print(f"  - Stations: {len(railway_data['stations'])}")
        print(f"  - Signals: {len(railway_data['signals'])}")
        print(f"  - Junctions: {len(railway_data['junctions'])}")
        
        return railway_data
        
    except Exception as e:
        print(f"❌ Data loading failed: {e}")
        return None

def test_graph_building(railway_data):
    """Test graph building"""
    print("\n=== Testing Graph Building ===")
    
    if not railway_data:
        print("❌ No data to build graph from")
        return None
    
    try:
        builder = RailwayGraphBuilder()
        graph = builder.build_graph(railway_data)
        
        print(f"✅ Graph built successfully:")
        print(f"  - Nodes: {graph.number_of_nodes()}")
        print(f"  - Edges: {graph.number_of_edges()}")
        print(f"  - Stations: {len(builder.get_station_nodes())}")
        print(f"  - Signals: {len(builder.get_signal_nodes())}")
        print(f"  - Junctions: {len(builder.get_junction_nodes())}")
        
        return builder, graph
        
    except Exception as e:
        print(f"❌ Graph building failed: {e}")
        return None, None

def test_simulation(builder, graph):
    """Test simulation"""
    print("\n=== Testing Simulation ===")
    
    if not graph:
        print("❌ No graph to simulate")
        return None
    
    try:
        simulation = RailwaySimulation(graph)
        
        # Add some trains
        stations = builder.get_station_nodes()
        if len(stations) >= 2:
            simulation.add_train("T001", stations[0], stations[1], max_speed=30.0, color=(255, 0, 0))
            simulation.add_train("T002", stations[1], stations[0], max_speed=25.0, color=(0, 255, 0))
            print(f"✅ Added {len(simulation.trains)} trains")
        else:
            print("⚠️  Not enough stations to add trains")
        
        # Start simulation
        simulation.start_simulation()
        print("✅ Simulation started")
        
        # Run for a few seconds
        print("Running simulation for 5 seconds...")
        for i in range(50):  # 5 seconds at 0.1s intervals
            time.sleep(0.1)
            
            if i % 10 == 0:  # Print every second
                positions = simulation.get_train_positions()
                stats = simulation.get_simulation_stats()
                print(f"  Time: {stats['simulation_time']:.1f}s, "
                      f"Running trains: {stats['running_trains']}")
        
        simulation.stop_simulation()
        print("✅ Simulation stopped")
        
        return simulation
        
    except Exception as e:
        print(f"❌ Simulation failed: {e}")
        return None

def test_api(simulation):
    """Test API server"""
    print("\n=== Testing API Server ===")
    
    if not simulation:
        print("❌ No simulation to serve via API")
        return None
    
    try:
        from api import RailwayAPI
        
        api = RailwayAPI(simulation, host='127.0.0.1', port=5000)
        api.start()
        
        print("✅ API server started on http://127.0.0.1:5000")
        print("  - Health: http://127.0.0.1:5000/health")
        print("  - Telemetry: http://127.0.0.1:5000/telemetry")
        print("  - Stations: http://127.0.0.1:5000/stations")
        
        # Keep running for a bit
        print("API server running for 10 seconds...")
        time.sleep(10)
        
        api.stop()
        print("✅ API server stopped")
        
        return api
        
    except Exception as e:
        print(f"❌ API server failed: {e}")
        return None

def main():
    """Run all tests"""
    print("🚂 Railway Network Simulator - System Test")
    print("=" * 50)
    
    # Test data loading
    railway_data = test_data_loading()
    
    # Test graph building
    builder, graph = test_graph_building(railway_data)
    
    # Test simulation
    simulation = test_simulation(builder, graph)
    
    # Test API
    api = test_api(simulation)
    
    print("\n" + "=" * 50)
    print("🎉 System test completed!")
    
    if all([railway_data, graph, simulation]):
        print("✅ All core components working!")
    else:
        print("⚠️  Some components had issues")

if __name__ == "__main__":
    main()
