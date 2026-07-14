// Offline stub for https://esm.sh/xlsx@0.18.5 (report-render/writers.ts).
// The deterministic tier never serializes real workbooks — rb-06/rb-07 pin
// the workbook MODEL (cell values) and inject fake writers — so this stub
// only keeps the module graph offline and shouts if it is ever executed.

// deno-lint-ignore-file no-explicit-any

const unavailable = (): never => {
  throw new Error("xlsx stub: SheetJS is not loaded in the deterministic tier — inject a test writer");
};

export const utils: any = {
  book_new: unavailable,
  aoa_to_sheet: unavailable,
  book_append_sheet: unavailable,
};

export function write(_book: any, _opts: any): ArrayBuffer {
  return unavailable();
}
