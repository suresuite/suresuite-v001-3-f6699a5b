# SCSIM — supply chain simulation library and stress-test framework.
# Copyright (c) 2023-2026 Phu Nguyen. All rights reserved until the open-access
# release; see scsim/NOTICE.md for licensing, funding and citation.
# Developed in part within the ACCURATE project (Horizon Europe, GA 101138269).

"""Closed vocabularies for the Part III variable dictionary and Part IV catalog.

These enums are the canonical spelling used by the Pydantic models, the
JSON-Schema/registry export, and the generated documentation. Frontend Zod
schemas are code-generated from the same values — do not fork the strings.
"""
from __future__ import annotations

from enum import Enum


class Stage(str, Enum):
    SUPPLIER = "supplier"
    TRANSPORT = "transport"
    PLANT = "plant"
    CUSTOMER = "customer"
    CROSS = "cross"


class StrategyClass(str, Enum):
    BUILT_IN = "built_in"
    STRATEGIC = "strategic"
    ANTICIPATION = "anticipation"
    IMPROVISATION = "improvisation"
    META = "meta"


class ConstraintTag(str, Enum):
    MATERIAL_AVAILABILITY = "material_availability"
    PRODUCTION_CAPACITY = "production_capacity"
    TRANSPORT_CAPACITY = "transport_capacity"
    RESPONSE_TIME = "response_time"
    DEMAND_SIDE = "demand_side"
    ALLOCATION_EFFICIENCY = "allocation_efficiency"


class PolicyStatus(str, Enum):
    IMPLEMENTED = "implemented"  # ✅ validated manuscript core, runnable
    PLANNED = "planned"          # 🧩 governed extension, registry/docs only


class FulfillmentMode(str, Enum):
    MTO = "mto"  # ✅ manuscript core
    MTS = "mts"  # 🧩 M7
    ATO = "ato"  # reserved


class DemandModel(str, Enum):
    DETERMINISTIC = "deterministic"
    TRIANGULAR = "triangular"  # ✅ manuscript
    POISSON = "poisson"
    NEGBIN = "negbin"
    BOOTSTRAP = "bootstrap"
    # WP 14.1 (ADR 0002, decision 8): N(μ, σ = CV·μ), negative draws set to 0
    # and counted. LAST on purpose: `demand_groups` iterate this enum in order,
    # so a value appended here leaves every existing draw sequence untouched.
    NORMAL = "normal"


class LeadTimeDist(str, Enum):
    DETERMINISTIC = "deterministic"
    LOGNORMAL = "lognormal"
    GAMMA = "gamma"
    EMPIRICAL = "empirical"
    # PLAN.md §26 WP 16.1 (P-S.6 widened): the demand-style shapes. Drawn from
    # their own world stream, keyed per lane (`seeds.lane_leadtime_rng`), so the
    # lognormal/gamma draws above keep their stream and stay bit-identical.
    NORMAL = "normal"          # mean + CV, raised to 1 week and counted
    TRIANGULAR = "triangular"  # min, mode, max — planning lead time = the mean
    UNIFORM = "uniform"        # min, max — planning lead time = the mean


#: The shapes defined by their BOUNDS rather than by the link's mean + CV.
BOUNDED_LEAD_TIME_DISTS = frozenset({LeadTimeDist.TRIANGULAR, LeadTimeDist.UNIFORM})
#: The shapes drawn from standard uniforms on the per-lane stream (inverse CDF).
SHAPED_LEAD_TIME_DISTS = frozenset({LeadTimeDist.NORMAL, LeadTimeDist.TRIANGULAR,
                                    LeadTimeDist.UNIFORM})


class WarmupMethod(str, Enum):
    CONWAY = "conway"
    MSER5 = "mser5"
    MANUAL = "manual"
    MOST_CONSERVATIVE = "most_conservative"  # runs both, takes the later week


class RunMode(str, Enum):
    FULL = "full"
    FAST_SCAN = "fast_scan"  # 10×6 seeds, kpi_only traces, wide-CI badge


class ReplicationStopping(str, Enum):
    FIXED = "fixed"
    SEQUENTIAL_CI = "sequential_ci"


class TargetType(str, Enum):
    NODE_SUPPLIER = "node:supplier"  # ✅
    NODE_PLANT = "node:plant"        # ✅ (throttles/halts the plant's production)
    EDGE_LANE = "edge:lane"          # 🧩 (behavior-neutral: resolves to its supplier)


class EffectType(str, Enum):
    LEAD_TIME_EXTENSION = "lead_time_extension"  # ✅ Eqs. 11–12
    CAPACITY_REDUCTION = "capacity_reduction"


class OverflowRule(str, Enum):
    QUEUE = "queue"    # units delayed, never destroyed (conservation invariant)
    REJECT = "reject"  # logs lost_inbound_units


class RampProfile(str, Enum):
    STEP = "step"
    RAMP_LINEAR = "ramp_linear"


class SupplierProfile(str, Enum):
    SINGLE_SOURCED = "single_sourced"  # rho_s = 0
    LOW_MULTI = "low_multi"            # rho_s < threshold (default 50%)
    HIGH_MULTI = "high_multi"          # rho_s >= threshold


class TransportMode(str, Enum):
    DEFAULT = "default"
    SEA = "sea"
    AIR = "air"
    ROAD = "road"
    RAIL = "rail"


class FgPolicy(str, Enum):
    BASE_STOCK = "base_stock"
    MIN_MAX = "min_max"
    DAYS_OF_COVER = "days_of_cover"  # WP 14.4 (ADR 0002 decision 3)


class ForecastModel(str, Enum):
    NAIVE = "naive"
    MA = "ma"
    EXP_SMOOTHING = "exp_smoothing"
    PERFECT = "perfect"


class TraceVerbosity(str, Enum):
    KPI_ONLY = "kpi_only"
    WEEKLY = "weekly"
    FULL_DEBUG = "full_debug"
