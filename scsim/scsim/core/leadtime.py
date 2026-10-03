# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Lead-time shapes — one implementation for every lead time the engine draws.

PLAN.md §25 WP 15.1 (P-S.6 widened). A lead time is a planning value (the
link's ``lead_time_weeks``, whole weeks) plus an optional SHAPE:

* deterministic — exactly the planning value;
* lognormal, gamma — mean = the planning value, spread = CV (audit F-24's
  standardised variates on the world ``leadtime`` stream, unchanged);
* normal — ``mean · (1 + cv · z)``, raised to 1 week and counted;
* triangular (min, mode, max), uniform (min, max) — the distribution IS its
  bounds, and the planning value is their mean (§25.2 rule 3).

The shapes added by WP 15.1 are drawn as standard uniforms ``u`` per
(lane, week) before any policy acts, and turned into a lead time by the inverse
CDF at use. A shipment whose lead time a policy changed (expediting) scales the
draw by its own mean over the link's planning value, so the shape keeps its
relative spread. Production lead times (P-P.13, WP 15.4) use the same functions.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
from scipy.special import ndtri

from scsim.entities.enums import SHAPED_LEAD_TIME_DISTS, LeadTimeDist

# u in (0, 1): ndtri(0) = −∞, ndtri(1) = +∞.
_U_EPS = 1e-12


def is_stochastic(dist: LeadTimeDist, cv: float, lo: Optional[float],
                  hi: Optional[float]) -> bool:
    """Whether a lead time with this shape is drawn at all. A CV shape with a
    zero CV, or a bounded shape with min = max, is a fixed number."""
    if dist in (LeadTimeDist.LOGNORMAL, LeadTimeDist.GAMMA, LeadTimeDist.NORMAL):
        return cv > 0
    if dist in (LeadTimeDist.TRIANGULAR, LeadTimeDist.UNIFORM):
        return lo is not None and hi is not None and hi > lo
    return False


def draws_uniforms(dist: LeadTimeDist) -> bool:
    """The shapes whose variates are standard uniforms on the per-lane stream."""
    return dist in SHAPED_LEAD_TIME_DISTS


def from_variate(dist: LeadTimeDist, mean: float, cv: float, v: float,
                 lo: Optional[float] = None, mode: Optional[float] = None,
                 hi: Optional[float] = None, nominal: Optional[float] = None,
                 rounded: bool = True) -> float:
    """A lead time with the link's shape and the shipment's ``mean``, from the
    variate pre-drawn for this (link, week).

    Lognormal: ``exp(μ + σ·z)`` with ``σ² = ln(1+cv²)`` and ``μ = ln(mean) − σ²/2``,
    so ``E = mean``. Gamma: ``(mean/shape)·g`` with ``g ~ Γ(shape, 1)`` and
    ``shape = 1/cv²``. Normal: ``mean·(1 + cv·Φ⁻¹(u))``. Triangular / uniform: the
    closed-form inverse CDF on [lo, hi], scaled by ``mean / nominal`` (the
    shipment's mean over the link's planning value — 1 unless a policy changed
    this shipment's lead time).
    """
    if dist == LeadTimeDist.LOGNORMAL:
        sigma2 = np.log1p(cv * cv)
        mu = np.log(max(mean, 1e-9)) - sigma2 / 2.0
        x = float(np.exp(mu + np.sqrt(sigma2) * v))
    elif dist == LeadTimeDist.GAMMA:
        x = float(v * mean * cv * cv)  # (mean / shape) · g, shape = 1/cv²
    elif dist == LeadTimeDist.NORMAL:
        u = min(max(v, _U_EPS), 1.0 - _U_EPS)
        x = float(mean * (1.0 + cv * float(ndtri(u))))
    elif dist in (LeadTimeDist.TRIANGULAR, LeadTimeDist.UNIFORM) and lo is not None and hi is not None:
        a, b = float(lo), float(hi)
        u = min(max(v, 0.0), 1.0)
        if b <= a:
            x = a
        elif dist == LeadTimeDist.UNIFORM:
            x = a + u * (b - a)
        else:
            c = float(mode if mode is not None else (a + b) / 2.0)
            fc = (c - a) / (b - a)
            if u < fc:
                x = a + np.sqrt(u * (b - a) * (c - a))
            else:
                x = b - np.sqrt((1.0 - u) * (b - a) * (b - c))
            x = float(x)
        if nominal and nominal > 0 and mean != nominal:
            x = x * float(mean) / float(nominal)
    else:
        x = float(mean)
    return int(round(x)) if rounded else x
