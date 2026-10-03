// The Plant stage's FG policy types and the levels each reads — the FG
// counterpart of the material POLICY_PARAMS (policyGridUi), so the two
// inventory cells are laid out the same way.

/**
 * FG policy → the levels it reads (engine `Product.fg_*`, core/planning.py),
 * in display order — the Plant stage's "FG replenishment" cell, laid out like
 * the material one above. base-stock fills to S (empty = one week of projected
 * demand); min-max fills to S only below s (both required); days of cover
 * fills to D/7 × the projected weekly demand (D required).
 */
export const FG_POLICY_PARAMS: Record<string, Array<{ field: string; symbol: string }>> = {
  base_stock: [{ field: "fg_base_stock", symbol: "S" }],
  min_max: [
    { field: "fg_reorder_point", symbol: "s" },
    { field: "fg_base_stock", symbol: "S" },
  ],
  days_of_cover: [{ field: "fg_cover_days", symbol: "D" }],
};

/** The FG policy types, labelled like the material Policy type dropdown. */
export const FG_POLICY_TYPE_LABELS: Record<string, string> = {
  base_stock: "Base stock (S)",
  min_max: "Min-max (s, S)",
  days_of_cover: "Days of cover (D)",
};
