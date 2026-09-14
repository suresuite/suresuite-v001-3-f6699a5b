// Deterministic report-render pipeline — v1.2 Phase 3 (ai-agents.md §16.1
// apply mapping, §16.2 path law, §10 Q24).
//
// Pure orchestration over injected dependencies (db, storage upload, binary
// writers): no Deno.env, no module-level clients, no remote imports — the
// deterministic eval tier drives the WHOLE pipeline offline (rb-06/rb-07),
// and index.ts / agent-apply drive it with the service role + the real
// SheetJS/pdf-lib writers (writers.ts).
//
// The render law (§16.1): every number in a rendered document is resolved
// from the database AT RENDER TIME by _shared/reportTemplates.ts — the spec
// stores source references, never data, so a report can never disagree with
// the data it cites. Narrative renders under an explicit "AI-drafted
// commentary" heading with the provenance note (§12.2 transparency carried
// into the document). Rendered documents carry NO wall-clock values — the
// determinism contract (same spec + same data ⇒ identical cell values) holds
// by construction; created_at lives on the user_files row.

import {
  ReportResolveError,
  resolveReportSections,
  type ReportSectionSpec,
  type ResolvedReportSection,
} from "../_shared/reportTemplates.ts";

export const AI_COMMENTARY_HEADING = "AI-drafted commentary";
export const AI_COMMENTARY_PROVENANCE_NOTE =
  "AI-drafted — verify against the deterministic sections; every number in this document is resolved from the project database.";

/** §16.2 signed-URL lifetime (DEFAULT, §10 Q25). */
export const SIGNED_URL_TTL_SECONDS = 3600;

// ─────────────────────────────────────────────────────────────────────────────
// §16.2 path law
// ─────────────────────────────────────────────────────────────────────────────

/** Filesystem/URL-safe filename: ASCII word chars, dot, dash; single
 * underscores for everything else; bounded; never empty. */
export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "")
    .slice(0, 80);
  return cleaned || "report";
}

/** The §16.2 path law — NOT optional: the admin rollup and the storage
 * policies depend on the org/user hierarchy:
 * `org/<org_id>/user/<user_id>/<project_id|shared>/<file_id>__<safe_filename>` */
export function workspacePath(args: {
  orgId: string | null;
  userId: string;
  projectId: string | null;
  fileId: string;
  filename: string;
}): string {
  const org = args.orgId ?? "none";
  const scope = args.projectId ?? "shared";
  return `org/${org}/user/${args.userId}/${scope}/${args.fileId}__${safeFilename(args.filename)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Document models (pure — the rb-06 determinism fixtures pin these)
// ─────────────────────────────────────────────────────────────────────────────

export type Cell = string | number | null;

export interface WorkbookSheet {
  name: string;
  aoa: Cell[][];
}

export type PdfBlock =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "note"; text: string }
  | { type: "text"; text: string }
  | { type: "table"; columns: string[]; rows: Cell[][] };

/** XLSX sheet names: ≤31 chars, no []:*?/\ and unique within the book. */
function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

const provenanceLabel = (s: ResolvedReportSection): string =>
  s.provenance === "deterministic" ? "computed from your data" : "AI-drafted — verify";

/** The XLSX model: an Overview sheet + one sheet per section. Narrative
 * sheets carry the explicit "AI-drafted commentary" heading (§16.1). */
export function buildWorkbookModel(args: {
  title: string;
  templateId: string;
  sections: ResolvedReportSection[];
}): WorkbookSheet[] {
  const used = new Set<string>();
  const overview: Cell[][] = [
    ["SuReSuite decision report"],
    ["Title", args.title],
    ["Template", args.templateId],
    [null],
    ["Section", "Kind", "Provenance", "Source"],
    ...args.sections.map((s, i): Cell[] => [
      `${i + 1}. ${s.title}`,
      s.kind,
      provenanceLabel(s),
      s.source_ref,
    ]),
  ];
  const sheets: WorkbookSheet[] = [{ name: sheetName("Overview", used), aoa: overview }];
  args.sections.forEach((s, i) => {
    if (s.kind === "narrative") {
      const aoa: Cell[][] = [
        [AI_COMMENTARY_HEADING],
        ["Provenance", AI_COMMENTARY_PROVENANCE_NOTE],
        [null],
        [s.narrative_md ?? ""],
      ];
      if ((s.citations ?? []).length > 0) {
        aoa.push([null], ["Citations"]);
        for (const c of s.citations ?? []) aoa.push([`${c.kind}: ${c.ref}`]);
      }
      sheets.push({ name: sheetName(AI_COMMENTARY_HEADING, used), aoa });
    } else {
      sheets.push({
        name: sheetName(`${i + 1}. ${s.title}`, used),
        aoa: [
          [s.title],
          ["Source", s.source_ref],
          [null],
          [...s.columns],
          ...s.rows.map((r) => [...r]),
        ],
      });
    }
  });
  return sheets;
}

/** The PDF model: title, then per-section heading + source note + content.
 * Narrative renders under the explicit "AI-drafted commentary" heading with
 * its provenance note (§16.1). */
export function buildPdfModel(args: {
  title: string;
  templateId: string;
  sections: ResolvedReportSection[];
}): PdfBlock[] {
  const blocks: PdfBlock[] = [
    { type: "title", text: args.title },
    { type: "note", text: `SuReSuite decision report - template: ${args.templateId}` },
  ];
  for (const s of args.sections) {
    if (s.kind === "narrative") {
      blocks.push({ type: "heading", text: AI_COMMENTARY_HEADING });
      blocks.push({ type: "note", text: AI_COMMENTARY_PROVENANCE_NOTE });
      blocks.push({ type: "text", text: s.narrative_md ?? "" });
      if ((s.citations ?? []).length > 0) {
        blocks.push({
          type: "note",
          text: `Citations: ${(s.citations ?? []).map((c) => `${c.kind}:${c.ref}`).join("; ")}`,
        });
      }
    } else {
      blocks.push({ type: "heading", text: s.title });
      blocks.push({ type: "note", text: `Source: ${s.source_ref} (${provenanceLabel(s)})` });
      blocks.push({ type: "table", columns: s.columns, rows: s.rows });
    }
  }
  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// The render pipeline
// ─────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any };

export interface RenderWriters {
  xlsx(sheets: WorkbookSheet[]): Uint8Array | Promise<Uint8Array>;
  pdf(blocks: PdfBlock[]): Uint8Array | Promise<Uint8Array>;
}

export interface RenderDeps {
  writers: RenderWriters;
  /** Storage upload under the service role — the ONLY writer of workspace
   * objects (no public bucket, no client uploads). */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<{ error: { message: string } | null }>;
  /** Best-effort object cleanup when row bookkeeping fails mid-render. */
  remove?(paths: string[]): Promise<void>;
}

export interface RenderedFile {
  id: string;
  kind: "report_xlsx" | "report_pdf";
  name: string;
  path: string;
  size_bytes: number;
}

/** §4.4 applied_result shape for decision_report (+ card display extras). */
export interface DecisionReportRenderResult {
  file_ids: string[];
  paths: string[];
  files: RenderedFile[];
  template_id: string;
  format: string;
  total_bytes: number;
}

export class RenderFailure extends Error {
  constructor(public code: "stale_values" | "rpc_error", message: string) {
    super(message);
    this.name = "RenderFailure";
  }
}

const CONTENT_TYPES: Record<string, string> = {
  report_xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  report_pdf: "application/pdf",
};

/**
 * Render one approved decision_report spec: resolve sections against live
 * data, write the document(s), upload to the workspace bucket under the
 * §16.2 path law, insert user_files rows (create_user_file — the service
 * write path), and return {file_ids, paths}.
 *
 * Format semantics (§16.1 as-built): 'xlsx' ⇒ the XLSX data pack alone;
 * 'pdf' and 'both' ⇒ the PDF document PLUS the XLSX data pack — a rendered
 * document never circulates without the auditable numbers backing it.
 */
export async function renderDecisionReport(
  db: Db,
  deps: RenderDeps,
  args: {
    projectId: string;
    userId: string;
    orgId: string | null;
    proposalId: string | null;
    payload: Record<string, unknown>;
  },
): Promise<DecisionReportRenderResult> {
  const payload = args.payload ?? {};
  const templateId = String(payload.template_id ?? "");
  const format = String(payload.format ?? "pdf");
  const title = String(payload.title ?? "Decision report");
  const sections = Array.isArray(payload.sections) ? (payload.sections as ReportSectionSpec[]) : null;
  if (!templateId || !sections || sections.length === 0) {
    throw new RenderFailure("rpc_error", "stored payload failed validation: template_id/sections missing");
  }

  // Resolve every section against LIVE data — registered read tools and
  // persisted runs only. A vanished cited run fails stale_values (§4.2).
  let resolved: ResolvedReportSection[];
  try {
    resolved = await resolveReportSections(db, { projectId: args.projectId, userId: args.userId }, sections);
  } catch (e) {
    if (e instanceof ReportResolveError) throw new RenderFailure(e.code, e.message);
    throw new RenderFailure("rpc_error", e instanceof Error ? e.message : "section resolution failed");
  }

  const wantPdf = format === "pdf" || format === "both";
  const outputs: Array<{ kind: RenderedFile["kind"]; ext: string; bytes: Uint8Array }> = [];
  try {
    if (wantPdf) {
      outputs.push({
        kind: "report_pdf",
        ext: "pdf",
        bytes: await deps.writers.pdf(buildPdfModel({ title, templateId, sections: resolved })),
      });
    }
    outputs.push({
      kind: "report_xlsx",
      ext: "xlsx",
      bytes: await deps.writers.xlsx(buildWorkbookModel({ title, templateId, sections: resolved })),
    });
  } catch (e) {
    throw new RenderFailure("rpc_error", `document writer failed: ${e instanceof Error ? e.message : e}`);
  }

  const files: RenderedFile[] = [];
  const uploadedPaths: string[] = [];
  for (const out of outputs) {
    const fileId = crypto.randomUUID();
    const name = `${safeFilename(title)}.${out.ext}`;
    const path = workspacePath({
      orgId: args.orgId,
      userId: args.userId,
      projectId: args.projectId,
      fileId,
      filename: name,
    });

    const { error: uploadErr } = await deps.upload(path, out.bytes, CONTENT_TYPES[out.kind]);
    if (uploadErr) {
      await deps.remove?.(uploadedPaths).catch(() => {});
      throw new RenderFailure("rpc_error", `workspace upload failed: ${uploadErr.message}`);
    }
    uploadedPaths.push(path);

    const { data: rowId, error: insertErr } = await db.rpc("create_user_file", {
      p_id: fileId,
      p_user_id: args.userId,
      p_kind: out.kind,
      p_name: name,
      p_path: path,
      p_size_bytes: out.bytes.byteLength,
      p_org_id: args.orgId,
      p_project_id: args.projectId,
      p_proposal_id: args.proposalId,
    });
    if (insertErr) {
      await deps.remove?.(uploadedPaths).catch(() => {});
      throw new RenderFailure("rpc_error", `user_files bookkeeping failed: ${insertErr.message}`);
    }
    files.push({
      id: String(rowId ?? fileId),
      kind: out.kind,
      name,
      path,
      size_bytes: out.bytes.byteLength,
    });
  }

  return {
    file_ids: files.map((f) => f.id),
    paths: files.map((f) => f.path),
    files,
    template_id: templateId,
    format,
    total_bytes: files.reduce((n, f) => n + f.size_bytes, 0),
  };
}
