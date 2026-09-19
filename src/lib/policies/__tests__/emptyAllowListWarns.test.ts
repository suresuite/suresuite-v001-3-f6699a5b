/**
 * An empty AI allow-list means EVERYTHING, and the screen says so — §4 D34.
 *
 * ── THE INVERSION ──────────────────────────────────────────────────────────
 *
 * `capabilities_for_user()` sets `all_allowed` true when
 * `user_ai_permissions.allowed_model_ids` is empty OR the user has no row. That is
 * deliberate: it preserves the behaviour every user had before the column existed.
 * But it inverts how an allow-list reads, and the consequence is the worst kind —
 * an administrator unchecking the last model to REVOKE access GRANTS all of it.
 *
 * What existed before WP 6.2 was partial and predates the plan: the section badge
 * read "No restriction" and the generated reference page stated the rule in full.
 * Neither is at the point of the ACTION, which is where §5 T2 puts a substitution.
 * A badge that appears after the save describes a state the administrator did not
 * intend and has no reason to re-read.
 *
 * ── WHAT IS ASSERTED, AND WHY IT IS A SOURCE SCAN ──────────────────────────
 *
 * The screen is an admin page with a Supabase client, a router and a mobile
 * branch. Driving it would need all three mocked, and the resulting test would
 * assert that a mock was called. The claims that matter here are structural — the
 * write is intercepted, the copy states the inversion, the copy names the real
 * revoke path — and each is checkable at the source, which is also where a future
 * edit would break them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(__dirname, "..", "..", "..", "pages", "admin", "AdminUserAccess.tsx"),
  "utf8",
);

/** The file with its comments stripped: what the administrator can actually see
 *  and what the code actually does, never the explanation of either. */
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("§4 D34 · clearing the allow-list warns before it grants", () => {
  it("the comment strip left something to read", () => {
    // Every rule below reads `code`; if the strip ate the file they all pass
    // vacuously, which is the failure mode §4 D57 is about.
    expect(code.length).toBeGreaterThan(2000);
    expect(code).toMatch(/toggleModel/);
  });

  it("the uncheck that would empty the list does NOT save", () => {
    // `saveModels({ allowed_ids: [] })` must not be reachable from the toggle.
    // The guard is the transition into empty, and it returns rather than writing.
    expect(code).toMatch(/next\.length === 0 && data\.models\.allowed_ids\.length > 0/);
    const toggle = code.slice(code.indexOf("const toggleModel"), code.indexOf("const confirmClearAll"));
    expect(
      toggle,
      "the toggle must arm the confirmation and return, not save and then warn — " +
        "a warning after the write leaves every model allowed until somebody notices",
    ).toMatch(/setPendingClearAll\(true\);\s*return;/);
  });

  it("only the dangerous DIRECTION is intercepted", () => {
    // Checking the first box on an already-empty list RESTRICTS, and confirming
    // that would train an administrator to click through the dialog that matters.
    // The guard therefore reads the PREVIOUS length, not just the next one.
    expect(code).toMatch(/data\.models\.allowed_ids\.length > 0/);
  });

  it("the warning states the inversion in the words that invert", () => {
    expect(code).toMatch(/empty allow-list means EVERY model is allowed/i);
    expect(code).toMatch(/not none/i);
  });

  it("the warning names the control that actually revokes", () => {
    // A warning that says "this does not do what you meant" and stops there is a
    // warning an administrator clicks past. The real revoke is the `ai_chat`
    // FEATURE capability, one section above on the same screen.
    expect(code).toMatch(/AI chat/);
    expect(code).toMatch(/Features/);
  });

  it("the badge no longer reads as a neutral absence", () => {
    // "No restriction" describes an empty list as the absence of a rule. It is a
    // rule — "every model" — and the chip has to say which, because it is the only
    // thing on screen once the toast has gone.
    expect(code).not.toMatch(/'No restriction'/);
    expect(code).toMatch(/Empty list = ALL allowed/);
  });

  it("the toast says the EFFECT, not that a write happened", () => {
    // "AI models updated" is true of a save that granted every model and of one
    // that restricted to a single model, which makes it useless at exactly the
    // moment this defect is about.
    expect(code).not.toMatch(/toast\.success\('AI models updated'\)/);
    expect(code).toMatch(/EVERY model is now allowed/);
    expect(code).toMatch(/model\(s\) allowed/);
  });

  it("confirming is a separate, named action", () => {
    // The administrator who means it has a way through — otherwise the fix is a
    // feature removal dressed as a warning.
    expect(code).toMatch(/const confirmClearAll/);
    expect(code).toMatch(/saveModels\(\{ allowed_ids: \[\] \}\)/);
  });
});
