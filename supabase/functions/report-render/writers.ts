// First-party deterministic document writers — §10 Q24: XLSX via SheetJS
// (the repo's existing spreadsheet dependency) and PDF via pdf-lib
// (Deno-native). LLMs never touch this path — the models arrive fully
// resolved from render.ts, and these writers only serialize them.
//
// This module is the ONLY place the binary libraries are imported; render.ts
// stays dependency-injected so the deterministic eval tier never loads them
// (eval/deno.json maps both URLs to local stubs as defense in depth).

import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import type { Cell, PdfBlock, RenderWriters, WorkbookSheet } from "./render.ts";

// ── XLSX ─────────────────────────────────────────────────────────────────────

function writeXlsx(sheets: WorkbookSheet[]): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheet.aoa), sheet.name);
  }
  const buf = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(buf);
}

// ── PDF ──────────────────────────────────────────────────────────────────────

// A4 portrait.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const USABLE_W = PAGE_W - 2 * MARGIN;

/** The standard-font (WinAnsi) encoder rejects characters outside Latin-1;
 * map the common typography this platform emits, replace the rest. */
function winAnsiSafe(text: string): string {
  return text
    .replace(/[—–]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/·|•/g, "*")
    .replace(/Δ/g, "Delta")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/→/g, "->")
    .replace(/[^\x00-\xFF]/g, "?")
    .replace(/[\r\t]/g, " ");
}

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // A single over-wide token hard-breaks.
    let chunk = word;
    while (font.widthOfTextAtSize(chunk, size) > maxWidth && chunk.length > 1) {
      let cut = chunk.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(chunk.slice(0, cut), size) > maxWidth) cut--;
      lines.push(chunk.slice(0, cut));
      chunk = chunk.slice(cut);
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

const cellText = (c: Cell): string => (c == null ? "-" : typeof c === "number" ? String(c) : c);

async function writePdf(blocks: PdfBlock[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const ensureRoom = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const drawParagraph = (text: string, f: PDFFont, size: number, gapAfter: number) => {
    for (const raw of winAnsiSafe(text).split("\n")) {
      const lines = wrapLine(raw, f, size, USABLE_W);
      for (const line of lines) {
        ensureRoom(size + 4);
        page.drawText(line, { x: MARGIN, y: y - size, size, font: f });
        y -= size + 4;
      }
    }
    y -= gapAfter;
  };

  for (const block of blocks) {
    switch (block.type) {
      case "title":
        drawParagraph(block.text, bold, 18, 8);
        break;
      case "heading":
        ensureRoom(40);
        y -= 8;
        drawParagraph(block.text, bold, 13, 4);
        break;
      case "note":
        drawParagraph(block.text, font, 8.5, 6);
        break;
      case "text":
        drawParagraph(block.text, font, 10, 8);
        break;
      case "table": {
        const size = 8.5;
        const cols = Math.max(1, block.columns.length);
        const colW = USABLE_W / cols;
        const drawRow = (cells: string[], f: PDFFont) => {
          ensureRoom(size + 6);
          cells.forEach((c, i) => {
            page.drawText(truncateToWidth(winAnsiSafe(c), f, size, colW - 6), {
              x: MARGIN + i * colW,
              y: y - size,
              size,
              font: f,
            });
          });
          y -= size + 5;
        };
        if (block.columns.length > 0) drawRow(block.columns, bold);
        for (const row of block.rows) drawRow(row.map(cellText), font);
        y -= 8;
        break;
      }
    }
  }

  return await doc.save();
}

export function makeWriters(): RenderWriters {
  return { xlsx: writeXlsx, pdf: writePdf };
}
