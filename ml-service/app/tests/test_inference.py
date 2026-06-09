import os
import sys
import numpy as np

# Add the parent directory to sys.path to import inference
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from inference import MLPredictor


def test_missing_numeric_fields_default_to_zero():
    predictor = MLPredictor()
    # Node with no numeric fields provided
    nodes = [{"id": "node1"}]
    feature_matrix = predictor.preprocess_data(nodes)
    # Expect all features to be zeros
    assert feature_matrix.shape == (1, 6)
    assert np.all(feature_matrix[0] == 0)


def test_non_numeric_strings_coerced_to_zero():
    predictor = MLPredictor()
    # Node with non-numeric strings for numeric fields
    nodes = [{
        "id": "node1",
        "latitude": "north",
        "longitude": "west",
        "capacity": "large",
        "current_utilization": "full",
        "risk_factor": "high",
        "connectivity_score": "strong"
    }]
    feature_matrix = predictor.preprocess_data(nodes)
    # All non-numeric fields should be coerced to zero without raising errors
    assert feature_matrix.shape == (1, 6)
    assert np.all(feature_matrix[0] == 0)
