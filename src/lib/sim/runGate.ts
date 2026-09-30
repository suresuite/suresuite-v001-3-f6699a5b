/**
 * The run gate as ONE state (WP 9.4 slice 2, closes §4 D147).
 *
 * The rail's readout, stage 3's sub-label, the Run button and the reason beside
 * it used to be four separate derivations. Two of them re-derived a summary from
 * the block/warn COUNTS, so a reason carried by neither count — an account that
 * may open the Lab but not run it — read "clear — run allowed" on the rail and
 * "0 warnings — ack required" on stage 3 while the button was, correctly,
 * disabled. Every surface now reads the same `kind`, so a new reason cannot fall
 * through to "clear": there is no branch left for it to fall through.
 */

export type RunGateKind = "capability" | "baseline" | "blocked" | "ack_required" | "clear";

export interface RunGateInput {
  /** the account holds `simulation_lab` on this project (D219: the project role decides) */
  permitted: boolean;
  /** why it does not, in words — the project role's refusal (D219); a generic line when absent */
  refusal?: string | null;
  /** the selected scenario is the validated baseline, which Run & Validate owns */
  isBaseline?: boolean;
  blocks: number;
  warns: number;
  acknowledged: boolean;
  /** policy settings changed since the saved version, or none is saved */
  needsSave: boolean;
  /** a run of this scenario is queued or running */
  running?: boolean;
}

export type GateTone = "off" | "block" | "warn" | "clear";

export interface RunGateState {
  kind: RunGateKind;
  canRun: boolean;
  /** why the button will not fire; null when it will */
  reason: string | null;
  /** the Run button's own label */
  button: string;
  /** stage 3's sub-label on the rail */
  stageSub: string;
  /** the rail's right-hand readout */
  readout: { tone: GateTone; value: string };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function runGateState(g: RunGateInput): RunGateState {
  const button = g.needsSave ? "Save version & run" : "Run";
  if (!g.permitted) {
    return {
      kind: "capability",
      canRun: false,
      reason: g.refusal ?? "Running simulations isn't enabled for your account.",
      button,
      stageSub: "not permitted",
      readout: { tone: "off", value: "not permitted" },
    };
  }
  if (g.isBaseline) {
    return {
      kind: "baseline",
      canRun: false,
      reason: "The validated baseline runs in Policies › Run & Validate.",
      button,
      stageSub: "runs in Policies",
      readout: { tone: "off", value: "baseline" },
    };
  }
  if (g.blocks > 0) {
    const n = plural(g.blocks, "blocking finding", "blocking findings");
    return {
      kind: "blocked",
      canRun: false,
      reason: `Fix ${n} to run.`,
      button,
      stageSub: `${g.blocks} blocking`,
      readout: { tone: "block", value: `${g.blocks} blocking` },
    };
  }
  const warnText = plural(g.warns, "warning", "warnings");
  if (g.warns > 0 && !g.acknowledged) {
    return {
      kind: "ack_required",
      canRun: false,
      reason: `Acknowledge ${warnText} to run with engine defaults.`,
      button,
      stageSub: `ack ${warnText}`,
      readout: { tone: "warn", value: warnText },
    };
  }
  return {
    kind: "clear",
    canRun: true,
    reason: null,
    button,
    stageSub: g.running ? "running" : "ready",
    readout: g.warns > 0 ? { tone: "clear", value: `${warnText} ack'd` } : { tone: "clear", value: "clear" },
  };
}
