import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_H } from "@/components/sim/DisruptionFields";

// Design review (WP 9.4): every field, switch, chip and button in the
// disruption pop-ups is ONE height, 44px on a phone and 36px from `md`, and it
// comes from `FIELD_H`. Measured in Chromium across the three pop-ups when this
// landed; this keeps a stray `h-8` or a bare `<Button>` (40px) from returning.
const ROOT = join(__dirname, "..", "..", "..", "..");
const FILES = [
  "src/components/sim/DisruptionFields.tsx",
  "src/components/sim/DisruptionScheduleEditor.tsx",
  "src/components/network/NetworkDisruptionDialog.tsx",
  "src/components/sim/NewScenarioDialog.tsx",
];

describe("one control height in the disruption pop-ups", () => {
  it("is 44px on a phone and 36px from md", () => {
    expect(FIELD_H).toBe("h-11 md:h-9");
  });

  for (const f of FILES) {
    const src = readFileSync(join(ROOT, f), "utf8");
    it(`${f} sets no other control height`, () => {
      expect(src).not.toMatch(/\b(?:md:)?h-(?:6|7|8|10)\b/);
      expect(src).not.toMatch(/md:min-h-0/);
      expect(src).not.toMatch(/size="sm"/);
    });
    it(`${f} gives every <Button> the field height`, () => {
      // Each <Button …> up to its closing tag: an `=>` in a handler would end
      // a `[^>]*` match early, so the slice runs to `</Button>`.
      const buttons = src.split("<Button").slice(1).map((b) => b.slice(0, b.indexOf("</Button>")));
      expect(buttons.length).toBeGreaterThanOrEqual(f.includes("Fields") ? 0 : 1);
      for (const b of buttons) {
        expect(b, b).toMatch(/FIELD_H|h-11 w-11[^"]*md:h-9/);
      }
    });
  }
});
