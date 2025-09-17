# Railway Network Simulator for SIH

A real-time railway network simulator that uses OpenStreetMap/OpenRailwayMap data to simulate train movements and visualize railway infrastructure.

## Features

- **OSM Data Integration**: Fetches railway tracks, stations, and signals from OpenStreetMap
- **Real-time Simulation**: Simulates train movements with configurable speed and timing
- **Interactive Visualization**: Pygame-based visualization of tracks, stations, and trains
- **REST API**: Flask-based telemetry API for train positions and status
- **Graph-based Network**: Uses NetworkX for efficient pathfinding and network analysis

## Project Structure

```
niyantrakone/
├── data_loader.py          # OSM data fetching and parsing
├── graph_builder.py         # NetworkX graph construction
├── simulation.py           # Real-time train simulation engine
├── visualizer.py           # Pygame visualization
├── api.py                  # Flask REST API server
├── test_data_loader.py     # Test script for data loading
├── requirements.txt        # Python dependencies
└── README.md              # This file
```

## Installation

1. Install Python 3.8 or higher
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

### 1. Load Railway Data

```python
from data_loader import RailwayDataLoader

# Initialize loader
loader = RailwayDataLoader()

# Load data for Howrah Station area (5km radius)
railway_data = loader.load_railway_data(22.5851, 88.3468, radius_km=5.0)

# Save to JSON
loader.save_to_json(railway_data, "howrah_railway_data.json")
```

### 2. Test Data Loading

```bash
python test_data_loader.py
```

This will test the data loader with both Howrah Station (Kolkata) and New Delhi Station areas.

## Data Format

The data loader outputs JSON with the following structure:

```json
{
  "tracks": [
    {
      "id": "way_id",
      "type": "way",
      "railway_type": "rail",
      "coordinates": [{"lat": 22.5851, "lon": 88.3468}, ...],
      "tags": {...},
      "length": 1234.5
    }
  ],
  "stations": [
    {
      "id": "node_id",
      "type": "node",
      "railway_type": "station",
      "lat": 22.5851,
      "lon": 88.3468,
      "tags": {...},
      "name": "Howrah Junction"
    }
  ],
  "signals": [...],
  "junctions": [...],
  "metadata": {
    "total_elements": 150,
    "bbox": {"south": 22.5, "west": 88.3, "north": 22.6, "east": 88.4}
  }
}
```

## API Endpoints

- `GET /telemetry` - Returns current train positions and status
- `GET /network` - Returns railway network information
- `GET /stations` - Returns list of stations

## Development Status

- [x] Data loader module (`data_loader.py`)
- [ ] Graph builder module (`graph_builder.py`)
- [ ] Simulation engine (`simulation.py`)
- [ ] Visualization module (`visualizer.py`)
- [ ] REST API server (`api.py`)

## Contributing

This project is developed for SIH (Smart India Hackathon). Please follow the existing code structure and add appropriate tests for new features.

## License

This project is developed for educational and competition purposes.
