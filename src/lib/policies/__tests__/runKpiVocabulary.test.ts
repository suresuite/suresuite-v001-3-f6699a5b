/**
 * §4 D113 — the results table shows what the run carries, and every measure the
 * engine always emits has a name. WP 6.3.
 *
 * ── WHAT THE DEFECT WAS, AND WHY IT SURVIVED A PHASE ──────────────────────
 *
 * `KpiStatTable` mapped over `KPI_DISPLAY` and looked each key up on the replication
 * rows. `KPI_DISPLAY` is the LEGACY engine's KPI shape; the canonical engine's
 * `_kpi_row` emits a different set. **The intersection was two names.** Eleven of
 * thirteen rows could never appear — including `cost_of_resilience` and all ten cost
 * components — and NOTHING WRONG WAS EVER DISPLAYED, because a row with no data is
 * dropped rather than shown as zero. Measure loss, not a wrong number, and neither
 * file was wrong read alone. That is why a gate is the fix and reading either file
 * more carefully is not.
 *
 * The engine's emitted set is DERIVED here, not restated: `deriveRunKpis` parses
 * `scsim/scsim/kpi/compute.py` and `COST_COMPONENTS`, and is the same derivation the
 * manual renders. A test with its own copy of the list would pass while the engine
 * moved, which is the defect one level up.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveRunKpis } from "../../../../scripts/data-contract/chains.mjs";
import { KPI_BY_KEY, KPI_DISPLAY, kpiDisplay } from "@/lib/sim/kpiDisplay";

const ROOT = join(__dirname, "..", "..", "..", "..");
// The table's rows are built in `kpiRows.ts` since audit WP 2 (F-31) moved them
// out of the component so the "not measured" row could be tested; the D113
// shape this suite pins lives there now, and `KpiStatTable` must still use it.
const TABLE = readFileSync(join(ROOT, "src", "lib", "sim", "kpiRows.ts"), "utf8");
const COMPONENT = readFileSync(join(ROOT, "src", "components", "sim", "KpiStatTable.tsx"), "utf8");
const facts = deriveRunKpis(ROOT) as {
  emitted: Array<{ key: string; always: boolean }>;
  display: Array<{ key: string; label: string; emitted: boolean }>;
};

describe("§4 D113 · the run's measures reach the table", () => {
  it("the component builds its rows with the tested function", () => {
    expect(COMPONENT).toMatch(/buildKpiRows\(reps\)/);
  });

  it("the derivation still finds the engine's KPI row", () => {
    expect(facts.emitted.length).toBeGreaterThanOrEqual(15);
    expect(facts.emitted.map((e) => e.key)).toContain("cost_of_resilience");
    expect(facts.emitted.filter((e) => e.key.startsWith("cost_"))).toHaveLength(11);
  });

  it("every measure the engine ALWAYS emits has a label, not a raw key", () => {
    // The gate. An unnamed key still renders — `kpiDisplay` falls back to the key
    // itself — so this is about a reader seeing `fg_ss_holding` in a cost
    // breakdown, not about a measure going missing. That distinction is why the
    // fallback exists and why this test is not allowed to accept it.
    const unnamed = facts.emitted
      .filter((e) => e.always)
      .map((e) => e.key)
      .filter((k) => !KPI_BY_KEY[k]);
    expect(unnamed, `engine keys with no label: ${unnamed.join(", ")}`).toEqual([]);
  });

  it("the disruption-only measures are named too", () => {
    // Present only on a run that had an event, which is exactly when a reader is
    // looking hardest.
    for (const k of ["ttr_weeks", "tts_weeks", "pre_disruption_fill_rate"]) {
      expect(KPI_BY_KEY[k], `${k} has no label`).toBeTruthy();
    }
  });

  it("the table is driven by the RUN's keys, not by the catalog", () => {
    // The whole fix in one assertion: the keys come off the replication rows.
    expect(TABLE).toMatch(/new Set\(done\.flatMap\(\(r\) => Object\.keys\(r\.kpis \?\? \{\}\)\)\)/);
    expect(TABLE).not.toMatch(/KPI_DISPLAY\.map/);
  });

  it("the order is deterministic: catalog first, then alphabetical", () => {
    // Two runs of the same shape must produce the same table, and an unnamed
    // measure must not jump around between renders.
    expect(TABLE).toMatch(/KPI_ORDER\.get\(a\)/);
    expect(TABLE).toMatch(/a\.localeCompare\(b\)/);
  });

  it("`resilience_index` is NOT promised, because no run produces it", () => {
    // Not a naming problem. scsim's resilience_index() is called only by the stress
    // library the product never calls (D111), and the legacy one has no caller at
    // all. A label in this catalog would promise a measure nothing computes.
    expect(KPI_BY_KEY.resilience_index).toBeUndefined();
    expect(facts.emitted.map((e) => e.key)).not.toContain("resilience_index");
    const src = readFileSync(join(ROOT, "src", "lib", "sim", "kpiDisplay.ts"), "utf8");
    expect(src).toMatch(/NO RUN PRODUCES IT/);
  });

  it("the two legacy aliases are kept, and say they are aliases", () => {
    // `utilization`/`capacity_utilization` and `ttr_days`/`ttr_weeks` are one
    // quantity under two names — D21's shape. Both engines are live (the legacy one
    // is frozen, not retired), so retiring a name a stored row carries would lose
    // the row.
    expect(kpiDisplay("utilization").label).toMatch(/legacy/);
    expect(kpiDisplay("ttr_days").label).toMatch(/legacy/);
    expect(KPI_BY_KEY.capacity_utilization).toBeTruthy();
    expect(KPI_BY_KEY.ttr_weeks).toBeTruthy();
  });

  it("an unnamed key falls back visibly rather than disappearing", () => {
    const d = kpiDisplay("some_new_measure");
    expect(d.label).toBe("some_new_measure");
    expect(d.higherIsBetter).toBeNull();
  });

  it("the catalog has no duplicate keys", () => {
    expect(new Set(KPI_DISPLAY.map((k) => k.key)).size).toBe(KPI_DISPLAY.length);
  });
});

describe("§4 D113 · the utilization heatmap is gone", () => {
  it("the component is removed and nothing mounts it", () => {
    // It read a per-node series no engine writes, so it was empty on every run
    // forever under a caption that read as something a different run could fix.
    const dash = readFileSync(join(ROOT, "src", "components", "sim", "ResultsDashboard.tsx"), "utf8");
    expect(dash).not.toMatch(/<UtilizationHeatmap/);
    expect(dash).toMatch(/WAS HERE AND IS REMOVED — §4 D113/);
    expect(() =>
      readFileSync(join(ROOT, "src", "components", "sim", "UtilizationHeatmap.tsx"), "utf8"),
    ).toThrow();
  });

  it("the manual says it was removed, rather than falling silent", () => {
    // A reader who remembers the panel and finds no explanation is worse off than
    // one who is told. The derivation reports the removal; the page renders it.
    const page = readFileSync(
      join(ROOT, "src", "components", "docs", "bodies", "ReadingYourResults.tsx"), "utf8",
    );
    expect(page).toMatch(/SERIES\.heatmapRemoved \?/);
    expect(page).toMatch(/Utilization heatmap — removed/);
    expect(page).toMatch(/capacity_utilization/);
  });
});
