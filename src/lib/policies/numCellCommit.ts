/**
 * What a number cell commits when it loses focus — or that it commits nothing.
 *
 * THE CELL USED TO COMMIT ON EVERY BLUR, AND PARSE WHAT IT HAD DISPLAYED. An
 * integer cell renders `1500` as `1,500`, and `parseFloat("1,500".replace(",", "."))`
 * is `1.5`; a derived value renders as `≈ 5,950` and came back as `5.95`. So
 * clicking into a cell and out again, without typing, turned a capacity of
 * 1 500 into 1.5 and froze a derived fallback as a master value — and "Save
 * changes" wrote both. Measured in the browser against the item-master columns,
 * which this cell is the only editor for since the item-master editor was
 * retired.
 *
 * Two rules. Text the user did not change is not an edit. And a comma is read
 * by what the column displays: in an integer cell it can only be the thousands
 * separator this cell drew, so it is dropped; in a decimal cell (which never
 * draws one) it is a decimal comma a person typed. Text that is not a number
 * commits nothing, and the cell goes back to what it showed.
 */
export function numCellCommit(
  typed: string,
  shown: string,
  integer: boolean,
): { commit: false } | { commit: true; value: number | undefined } {
  if (typed.trim() === shown.trim()) return { commit: false };
  const raw = typed.replace("≈", "").trim();
  if (raw === "") return { commit: true, value: undefined };
  const normalized = integer ? raw.replace(/,/g, "") : raw.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? { commit: true, value: n } : { commit: false };
}
