"""Load the notebook library the way a notebook does: as cells executed into one
namespace (the client cell, then the generated KPI vocabulary)."""
import json
import os
import sys
from pathlib import Path

import matplotlib
import pytest

matplotlib.use("Agg")

ROOT = Path(__file__).resolve().parents[2]
COMMON = ROOT / "notebooks" / "src" / "common"
DEMO = ROOT / "notebooks" / "demo" / "example_project.json"

# The repo root's `scsim/` folder would shadow nothing we import here, but keep
# the tools directory importable for the recorder's key function.
sys.path.insert(0, str(ROOT / "notebooks" / "tools"))
os.environ.setdefault("MPLBACKEND", "Agg")


@pytest.fixture(scope="session")
def lib():
    ns: dict = {"__name__": "suresuite_notebook_lib"}
    exec(compile((COMMON / "client.py").read_text(), "client.py", "exec"), ns)
    exec(compile((COMMON / "kpi_display.py").read_text(), "kpi_display.py", "exec"), ns)
    return ns


@pytest.fixture(scope="session")
def demo_data():
    return json.loads(DEMO.read_text())


@pytest.fixture()
def demo(lib, demo_data):
    return lib["connect"]("https://example.invalid/v1", None, demo_data)
