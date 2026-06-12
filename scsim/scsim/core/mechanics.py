"""Pure production mechanics shared by PH-50 and planning policies.

Eq. 8 (MTO): Q_p = min(plan_p, O_p-already-in-plan, min_m I_m / r_{p,m}),
executed greedily in a FIXED product order (declaration order) so the
baseline allocation of shared materials is deterministic and documented.
P-P.9 exists precisely to replace this naive allocation with the rolling LP.

Quantities are continuous (fluid approximation over weekly buckets); the
manuscript's integer floor is documented as a deviation in
docs/architecture.md#deviations.
"""
from __future__ import annotations

import numpy as np

from scsim.core.context import CompiledModel


def greedy_feasible(
    model: CompiledModel,
    plan: np.ndarray,
    available: np.ndarray,
    order: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Execute ``plan`` against ``available`` material, first-come-first-served.

    Returns (Q, remaining_material). Does not mutate inputs.
    """
    avail = available.copy()
    Q = np.zeros(model.n_prods)
    indptr, indices, data = model.bom.indptr, model.bom.indices, model.bom.data
    sequence = order if order is not None else np.arange(model.n_prods)
    for j in sequence:
        want = plan[j]
        if want <= 0:
            continue
        lo, hi = indptr[j], indptr[j + 1]
        mats, rates = indices[lo:hi], data[lo:hi]
        if len(mats):
            limit = (avail[mats] / rates).min()
            q = min(want, max(0.0, limit))
            if q > 0:
                avail[mats] -= rates * q
        else:  # defensive: Network validation guarantees a BoM per product
            q = want
        Q[j] = q
    return Q, avail
