"""Demand distribution behaviors — focus on the triangularAV (Average &
Variability) form and that the refactor leaves the existing triangular numbers
unchanged."""
from __future__ import annotations

import numpy as np
import pytest

from scsim import Product, triangular_av
from scsim.entities.enums import DemandModel


def test_triangular_av_symmetric_triple():
    # triangularAV(avg, v) = triangular(avg·(1−v), avg, avg·(1+v))
    assert triangular_av(100.0, 0.30) == (70.0, 100.0, 130.0)
    assert triangular_av(50.0, 0.0) == (50.0, 50.0, 50.0)


def test_triangular_av_floors_lower_bound_at_zero():
    # v > 1 would push the left bound negative; demand cannot be negative.
    a, b, c = triangular_av(100.0, 1.5)
    assert a == 0.0 and b == 100.0 and c == 250.0


def test_with_triangular_av_matches_triangular_params():
    p = Product.with_triangular_av(
        average=100.0, variability=0.30,
        id="p", unit_price=1.0, production_capacity=10.0,
    )
    assert p.demand_model == DemandModel.TRIANGULAR
    # Explicit bounds were set, so triangular_params reproduces the AV triple
    # regardless of the global floor factor.
    assert p.triangular_params(global_floor_factor=0.99) == (70.0, 100.0, 130.0)


def test_default_triangular_is_av_form_via_floor_factor():
    # With min/max left at defaults, triangular IS triangularAV(demand_mode, ν).
    p = Product(id="p", unit_price=1.0, demand_mode=100.0, production_capacity=10.0)
    assert p.triangular_params(global_floor_factor=0.30) == triangular_av(100.0, 0.30)


def test_triangular_av_sampling_mean_and_bounds():
    a, b, c = triangular_av(100.0, 0.30)
    rng = np.random.default_rng(0)
    draws = rng.triangular(a, b, c, size=20_000)
    assert (draws >= a).all() and (draws <= c).all()
    assert b - 1.0 <= draws.mean() <= b + 1.0  # symmetric ⇒ mean ≈ average


@pytest.mark.parametrize("variability", [0.0, 0.1, 0.25, 0.5, 1.0])
def test_triangular_av_average_is_the_mode(variability):
    a, b, c = triangular_av(80.0, variability)
    assert b == 80.0 and a <= b <= c
