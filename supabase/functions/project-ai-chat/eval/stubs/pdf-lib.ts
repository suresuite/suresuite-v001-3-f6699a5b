// Offline stub for https://esm.sh/pdf-lib@1.17.1 (report-render/writers.ts).
// The deterministic tier never lays out real PDFs — rb-06 pins the PDF MODEL
// (blocks incl. the "AI-drafted commentary" heading) and rb-07 injects fake
// writers — so this stub only keeps the module graph offline and shouts if
// it is ever executed.

// deno-lint-ignore-file no-explicit-any

const unavailable = (): never => {
  throw new Error("pdf-lib stub: pdf-lib is not loaded in the deterministic tier — inject a test writer");
};

export class PDFDocument {
  static create(): Promise<PDFDocument> {
    return unavailable();
  }
  embedFont(_font: any): Promise<any> {
    return unavailable();
  }
  addPage(_size?: any): any {
    return unavailable();
  }
  save(): Promise<Uint8Array> {
    return unavailable();
  }
}

export const StandardFonts: any = {
  Helvetica: "Helvetica",
  HelveticaBold: "Helvetica-Bold",
};

export type PDFFont = any;
export type PDFPage = any;
