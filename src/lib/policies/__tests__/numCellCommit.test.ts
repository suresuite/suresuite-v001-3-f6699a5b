/**
 * A number cell commits what the user TYPED, never what it displayed.
 *
 * Found by testing the item-master retirement in a browser: clicking into an
 * integer cell showing `1,500` and out again saved 1.5, and a derived `≈ 5,950`
 * was frozen as a master value of 5.95. The grid is the only editor for the
 * item-master economics, so a lossy round trip there corrupts engine inputs.
 */
import { describe, expect, it } from "vitest";
import { numCellCommit } from "../numCellCommit";

describe("numCellCommit", () => {
  it("focus and blur with no typing commits nothing", () => {
    expect(numCellCommit("1,500", "1,500", true)).toEqual({ commit: false });
    expect(numCellCommit("≈ 5,950", "≈ 5,950", true)).toEqual({ commit: false });
    expect(numCellCommit("0.13", "0.13", false)).toEqual({ commit: false });
    expect(numCellCommit("", "", true)).toEqual({ commit: false });
  });

  it("an integer cell reads a comma as the thousands separator it draws", () => {
    expect(numCellCommit("2,500", "1,500", true)).toEqual({ commit: true, value: 2500 });
    expect(numCellCommit("1,234,567", "", true)).toEqual({ commit: true, value: 1234567 });
  });

  it("a decimal cell reads a typed comma as a decimal comma", () => {
    expect(numCellCommit("0,35", "0.20", false)).toEqual({ commit: true, value: 0.35 });
  });

  it("clearing the cell commits empty, and junk commits nothing", () => {
    expect(numCellCommit("", "1,500", true)).toEqual({ commit: true, value: undefined });
    expect(numCellCommit("abc", "1,500", true)).toEqual({ commit: false });
    expect(numCellCommit("12abc", "", false)).toEqual({ commit: false });
  });

  it("editing a derived value commits the number typed, not the ≈ marker", () => {
    expect(numCellCommit("≈ 6,000", "≈ 5,950", true)).toEqual({ commit: true, value: 6000 });
  });
});
