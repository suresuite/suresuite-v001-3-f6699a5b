import type { FulfillmentStrategy, PolicyFamily } from "./schemas";

/**
 * Returns which fields are *disabled* (greyed out) for a given strategy + family.
 * The field will still be persisted, but the UI surfaces why it's not actively in play.
 */
export function gatedFields(
  strategy: FulfillmentStrategy,
  family: PolicyFamily,
): Record<string, string> {
  switch (strategy) {
    case "make_to_order":
      if (family === "inventory") {
        return {
          order_up_to: "MTO: no finished-goods stock — produced on order",
          max_stock: "MTO: not used",
          min_stock: "MTO: not used",
        };
      }
      if (family === "production") {
        return { lot_policy: "MTO forces lot-for-lot — override only if intentional" };
      }
      return {};
    case "engineer_to_order":
      if (family === "inventory") {
        return {
          type: "ETO: per-project, no standing inventory policy",
          order_up_to: "ETO: not used",
          reorder_point: "ETO: not used",
          safety_stock_days: "ETO: not used",
        };
      }
      return {};
    case "assemble_to_order":
    case "configure_to_order":
      if (family === "inventory") {
        return {
          order_up_to: "ATO/CTO: stock components, not finished goods",
        };
      }
      return {};
    case "make_to_stock":
    default:
      return {};
  }
}

/** Soft warnings for incoherent strategy + preset combos. */
export function strategyWarning(
  strategy: FulfillmentStrategy,
  presetSlug: string,
): string | null {
  if (strategy === "make_to_order" && presetSlug === "service_first") {
    return "Service-first preset assumes high FG stock; MTO has none. Expect longer customer lead times.";
  }
  if (strategy === "engineer_to_order" && presetSlug === "lean_jit") {
    return "Lean/JIT is a flow concept; ETO is project-style. Consider the Make-to-Order preset instead.";
  }
  if (strategy === "make_to_stock" && presetSlug === "make_to_order") {
    return "You picked MTS strategy but the MTO preset. Switch strategy first.";
  }
  return null;
}
