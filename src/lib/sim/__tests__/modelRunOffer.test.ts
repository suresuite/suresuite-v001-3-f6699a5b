/**
 * PLAN.md §23 WP 13.3 — a run of a Validated Model replays the model's own two
 * versions, so a moved live project is a CHOICE (replay, or current data as
 * exploratory), not a block; only what a replay cannot hold still blocks.
 */
import { describe, expect, it } from "vitest";
import { modelRunOffer } from "../labModel";

const active = { status: "active" as const, dataset_version_id: "dv1" };

describe("modelRunOffer", () => {
  it("an unchanged project runs the model faithfully", () => {
    expect(modelRunOffer(active, { state: "validated" })).toEqual({ kind: "faithful" });
  });

  it("moved data offers the replay and the exploratory run, never a block", () => {
    const o = modelRunOffer(active, { state: "stale", drift: ["data"] });
    expect(o.kind).toBe("moved");
    expect(o.kind === "moved" && o.replayable).toBe(true);
  });

  it("a model that names no dataset version cannot be replayed on moved data", () => {
    const o = modelRunOffer({ status: "active" as const, dataset_version_id: null }, { state: "stale", drift: ["data"] });
    expect(o).toMatchObject({ kind: "moved", replayable: false });
  });

  it("a changed scenario world or engine still blocks — a replay cannot hold those", () => {
    expect(modelRunOffer(active, { state: "stale", drift: ["data", "scenario"] }).kind).toBe("blocked");
    expect(modelRunOffer(active, { state: "stale", drift: ["engine"] }).kind).toBe("blocked");
  });

  it("a model no longer in force is blocked", () => {
    expect(modelRunOffer({ ...active, status: "superseded" as const }, { state: "validated" }).kind).toBe("blocked");
  });
});
