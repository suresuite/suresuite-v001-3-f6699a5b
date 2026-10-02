/**
 * PLAN.md §23 WP 13.4 — leaving /policies with unsaved drafts asks first.
 *
 * An unsaved edit is a draft in the page and reaches no policy version and no
 * run; the grid used to drop drafts silently on a stage switch or navigation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { holdNavigator, unsavedDraftsRequest } from "@/hooks/useUnsavedDraftsGuard";

const ROOT = join(__dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the navigator hold", () => {
  const nav = () => {
    const calls: string[] = [];
    return { calls, push: (to: unknown) => calls.push(`push ${to}`), replace: (to: unknown) => calls.push(`replace ${to}`) };
  };

  it("navigates only after the person says leave", async () => {
    const n = nav();
    const undo = holdNavigator(n, async () => false);
    n.push("/lab");
    await Promise.resolve();
    expect(n.calls).toEqual([]);
    undo();
    n.push("/lab");
    expect(n.calls).toEqual(["push /lab"]);
  });

  it("an answered yes navigates, push and replace alike", async () => {
    const n = nav();
    holdNavigator(n, async () => true);
    n.push("/a");
    n.replace("/b");
    await new Promise((r) => setTimeout(r, 0));
    expect(n.calls).toEqual(["push /a", "replace /b"]);
  });

  it("the question says what is lost", () => {
    expect(unsavedDraftsRequest(3).message).toMatch(/3 line\(s\).*reach no policy version and no run/);
  });
});

describe("the page wires it", () => {
  it("/policies guards a stage switch, a tab switch and navigation while the grid holds drafts", () => {
    const page = read("src/pages/ProjectPolicies.tsx");
    expect(page).toMatch(/useUnsavedDraftsGuard\(draftLines\)/);
    expect(page).toMatch(/onStageChange=\{\(s\) => void switchStage\(s\)\}/);
    expect(page).toMatch(/void switchTab\(/);
    expect(page).toMatch(/onDraftsChange=\{setDraftLines\}/);
    const grid = read("src/components/policies/StagePolicyTable.tsx");
    expect(grid).toMatch(/onDraftsChange\?\.\(dirtyKeys\.length\)/);
    const hook = read("src/hooks/useUnsavedDraftsGuard.ts");
    expect(hook).toMatch(/addEventListener\("beforeunload"/);
  });
});
