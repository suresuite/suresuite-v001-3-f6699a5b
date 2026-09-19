/**
 * The role-aware directed focus walk — Phase 8 / WP 8.3, EXTRACTED and generalised.
 *
 * WHERE IT CAME FROM. `ProductLevelNetwork`'s double-click handler is the best idea
 * on that page: focusing a node walks the supply chain BY ROLE, in the correct
 * direction for that role. A supplier expands forward to its materials, their
 * products, their customers; a customer expands backward. It is not a k-hop
 * neighbourhood — it is the path a supply-chain reader would trace by hand.
 *
 * WHAT CHANGED, and it is the point of the whole phase: the original hardcoded the
 * four groups A/B/C/D, which `buildGroupClassification` derived from the LANE that
 * produced each row, last-write-wins. This version reads `echelon` — one value,
 * authored once by `classify_node_echelon` (WP 8.1) — so the walk works for
 * `subassembly`, which the four-group version could not express at all, and for
 * `plant`, which it had no place for.
 *
 * THE WALK IS NOT A FIXED FOUR STEPS ANY MORE. A BOM can nest sub-assemblies to
 * any depth, so the upstream and downstream legs follow edges as long as the next
 * node's echelon is further from the focus in the chain's own order. That is the
 * generalisation the four-group version could not have: it had exactly four sets.
 */
import { ECHELON_ORDER, type Echelon } from './types';

export interface FocusNode {
  id: string;
  echelon: Echelon | null;
}

export interface FocusEdge {
  source: string;
  target: string;
}

/**
 * The ids of the induced subgraph around `focusId`: the node itself, everything
 * upstream of it along decreasing echelon order, and everything downstream along
 * increasing order.
 *
 * Returns just the focus when its echelon is unknown — deliberately. A walk needs
 * a direction, "unknown" gives none, and guessing one would render a path the data
 * does not support (T1). The page shows the node and says the role is unknown.
 */
export function focusSubgraphIds(
  nodes: readonly FocusNode[],
  edges: readonly FocusEdge[],
  focusId: string,
): Set<string> {
  const included = new Set<string>([focusId]);

  const focus = nodes.find((n) => n.id === focusId);
  if (!focus || !focus.echelon || focus.echelon === 'unknown') return included;

  const rankOf = new Map<string, number>();
  for (const n of nodes) {
    if (n.echelon && n.echelon !== 'unknown') rankOf.set(n.id, ECHELON_ORDER[n.echelon]);
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
  }

  /**
   * Follow edges while the echelon keeps moving the same way. `strictly` is what
   * makes this role-aware rather than a flood fill: a step that does not advance
   * along the chain is not part of the path, so a material's sibling materials are
   * not dragged in.
   */
  const walk = (direction: 'up' | 'down') => {
    const adjacency = direction === 'down' ? outgoing : incoming;
    const queue: string[] = [focusId];
    const seen = new Set<string>([focusId]);
    while (queue.length > 0) {
      const id = queue.shift()!;
      const here = rankOf.get(id);
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        const there = rankOf.get(next);
        // An unranked neighbour is NOT followed: it would extend the path through a
        // node whose role we do not know, which is the same substitution the
        // classifiers were making.
        if (here === undefined || there === undefined) continue;
        const advances = direction === 'down' ? there > here : there < here;
        if (!advances) continue;
        seen.add(next);
        included.add(next);
        queue.push(next);
      }
    }
  };

  walk('down');
  walk('up');
  return included;
}
