"""
Test script for RailwayDataLoader
"""

import json
from data_loader import RailwayDataLoader

def test_howrah_station():
    """Test loading data for Howrah station area"""
    print("Testing RailwayDataLoader with Howrah Station...")
    
    # Howrah Station coordinates
    HOWRAH_LAT = 22.5851
    HOWRAH_LON = 88.3468
    
    loader = RailwayDataLoader()
    
    try:
        # Load data with smaller radius for testing
        railway_data = loader.load_railway_data(HOWRAH_LAT, HOWRAH_LON, radius_km=2.0)
        
        print(f"Successfully loaded data:")
        print(f"- Tracks: {len(railway_data['tracks'])}")
        print(f"- Stations: {len(railway_data['stations'])}")
        print(f"- Signals: {len(railway_data['signals'])}")
        print(f"- Junctions: {len(railway_data['junctions'])}")
        
        # Save to file
        loader.save_to_json(railway_data, "test_howrah_data.json")
        print("Data saved to test_howrah_data.json")
        
        # Show sample data
        if railway_data['stations']:
            print(f"\nSample station: {railway_data['stations'][0]}")
        
        return True
        
    except Exception as e:
        print(f"Error: {e}")
        return False

def test_delhi_station():
    """Test loading data for New Delhi station area"""
    print("\nTesting RailwayDataLoader with New Delhi Station...")
    
    # New Delhi Station coordinates
    DELHI_LAT = 28.6448
    DELHI_LON = 77.2167
    
    loader = RailwayDataLoader()
    
    try:
        # Load data with smaller radius for testing
        railway_data = loader.load_railway_data(DELHI_LAT, DELHI_LON, radius_km=2.0)
        
        print(f"Successfully loaded data:")
        print(f"- Tracks: {len(railway_data['tracks'])}")
        print(f"- Stations: {len(railway_data['stations'])}")
        print(f"- Signals: {len(railway_data['signals'])}")
        print(f"- Junctions: {len(railway_data['junctions'])}")
        
        # Save to file
        loader.save_to_json(railway_data, "test_delhi_data.json")
        print("Data saved to test_delhi_data.json")
        
        return True
        
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    print("=== Railway Data Loader Test ===\n")
    
    # Test with Howrah
    success1 = test_howrah_station()
    
    # Test with Delhi
    success2 = test_delhi_station()
    
    if success1 or success2:
        print("\n✅ At least one test passed!")
    else:
        print("\n❌ All tests failed!")
