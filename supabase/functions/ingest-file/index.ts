// Phase 3 / WP 3.2 / §8.1–8.4 — `ingest-file`: THE SERVER-SIDE PARSE.
//
// Upload → tier 0 + a run → parse → contract-driven validation → tier 1 → the
// promotion of what passed. One function, one path, for every CSV this product
// accepts, and `UploadWizard` no longer parses anything.
//
// WHY THE ORDER IS WHAT IT IS, because two of the steps cannot be swapped:
//
//   · the BYTES go to storage before the run opens, so `ingest_files.storage_path`
//     never names an object that does not exist. If the landing then fails, the
//     object is removed again — an orphan object is cheap, an orphan manifest row
//     is a tier-0 record that lies.
//   · the RUN opens before the file lands. `ingest_files.ingest_run_id` is NOT
//     NULL and the row is write-once, so there is no way to bind a file to a run
//     afterwards (WP 3.1's handoff says this in one line and it is the one line
//     that decides the shape of this function).
//
// Both of those, and the audit row, happen inside `public.ingest_land_file` — one
// transaction, because three PostgREST calls can stop between any two of them.
//
// WHAT THIS FUNCTION DOES NOT DECIDE. Not one validation rule lives here. The
// headers, the required flags and the cell rules all come from
// `ingestSpec.generated.ts`, which the data contract generates from the sidecars.
// Adding a column to an upload is a sidecar edit; it is not a code change, and
// `contract:generate -- --check` fails if the two drift.
//
// IDENTITY, STATED PLAINLY. This application does not use Supabase Auth: it
// authenticates against `approved_users` and keeps the user in localStorage, so
// the uploader's id arrives ASSERTED BY THE CLIENT, exactly as it does for
// `ingest-bom-multi-level` and every other ingest function (PLAN.md §4 D28, a
// standing decision). What the landing adds is that the assertion is CHECKED
// against the database: `ingest_land_file` sets `app.current_user_id` to the
// asserted actor and refuses the landing unless `has_project_access()` answers
// true for them. A caller therefore cannot land a file into a project its claimed
// user cannot reach. It can still claim to be another user who can, and that is
// D28 and not something this package closes — said here so that the audit row
// this function writes is read for what it is.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { parseCsv, sha256Hex } from "../_shared/csvParse.ts";
import type { Finding } from "../_shared/csvParse.ts";
import { validateRows } from "../_shared/ingestValidate.ts";
import { INGEST_DATASETS } from "../_shared/ingestSpec.generated.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "ingest";
// 32 MB. The largest lane file measured in production is three orders of
// magnitude smaller; the bound exists so that a mistake costs a message rather
// than a function timeout with a half-written run behind it.
const MAX_BYTES = 32 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** `inbound logistics (1).csv` → `inbound-logistics-1-.csv`, and never a path. */
function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "upload.csv";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const form = await req.formData();
    const file = form.get("file");
    const dataset = String(form.get("dataset") ?? "");
    const projectId = String(form.get("project_id") ?? "");
    const userId = String(form.get("user_id") ?? "");
    // `parse` returns the parsed rows and lands nothing. It exists for the
    // datasets the contract does not yet describe — the item masters, the node
    // list and the two deep-tier network tables — so that NO CSV is parsed in a
    // browser any more, while their promotion stays where it is until the package
    // that owns those tables (§16).
    const mode = String(form.get("mode") ?? "land");

    if (!(file instanceof File)) return json({ success: false, error: "No file was uploaded." }, 400);
    if (!projectId) return json({ success: false, error: "Missing project_id." }, 400);
    if (!userId) return json({ success: false, error: "Missing user_id." }, 400);
    if (file.size > MAX_BYTES) {
      return json({ success: false, error: `That file is ${file.size} bytes; the limit is ${MAX_BYTES}.` }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // The hash is of the bytes AS RECEIVED, before any decode or parse. That is
    // what makes it an anchor rather than a description.
    const sha = await sha256Hex(bytes);
    const text = new TextDecoder("utf-8").decode(bytes);
    const parse = parseCsv(text);

    if (!parse.ok) {
      // Nothing is landed: there is no file here, only bytes that are not one.
      return json({ success: false, stage: "parse", findings: parse.findings }, 400);
    }

    const spec = INGEST_DATASETS[dataset];

    // A DRY RUN. The wizard calls this the moment a file is chosen, so the person
    // sees the preview and the findings BEFORE they commit — which is what the
    // old client-side parse bought and what deleting it must not cost. It lands
    // nothing: no run is opened, no bytes are stored.
    if (mode === "parse") {
      const rows = parse.rows.map((r) => {
        const o: Record<string, string> = {};
        parse.headers.forEach((h, i) => { if (h) o[h] = (r.cells[i] ?? "").trim(); });
        return { ...o, __line: String(r.line) };
      });
      const dry = spec ? validateRows(parse, spec) : null;
      const dryFindings: Finding[] = dry
        ? [...dry.fileFindings, ...dry.rows.flatMap((r) => r.findings)]
        : parse.findings;
      return json({
        success: true,
        mode: "parse",
        headers: parse.headers,
        rows,
        described: Boolean(spec),
        findings: dryFindings.slice(0, 200),
        findings_truncated: Math.max(0, dryFindings.length - 200),
        rows_rejected: dry?.counts.rows_rejected ?? 0,
        content_sha256: sha,
      });
    }

    if (!spec) {
      return json({
        success: false,
        error: `"${dataset}" is not a dataset the data contract describes. ` +
               `It knows: ${Object.keys(INGEST_DATASETS).join(", ")}.`,
      }, 400);
    }

    const result = validateRows(parse, spec);
    if (!result.ok) {
      // A file-level problem — a missing required column, a duplicate header, a
      // column the server supplies. The file is the wrong file; nothing lands.
      return json({ success: false, stage: "validate", findings: result.fileFindings }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const stamp = new Date().toISOString().slice(0, 10);
    const storagePath = `project/${projectId}/${stamp}/${crypto.randomUUID()}__${safeName(file.name)}`;
    const upload = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: file.type || "text/csv",
      upsert: false,
    });
    if (upload.error) {
      console.error("[ingest-file] storage upload failed", upload.error);
      return json({ success: false, stage: "store", error: upload.error.message }, 500);
    }

    const { data: landed, error: landError } = await supabase.rpc("ingest_land_file", {
      _project_id: projectId,
      _actor_user_id: userId,
      _source_kind: "csv",
      _fact_class: spec.factClass,
      _target_table: spec.target,
      _original_filename: file.name,
      _storage_bucket: BUCKET,
      _storage_path: storagePath,
      _content_type: file.type || null,
      _byte_size: file.size,
      _content_sha256: sha,
      _rows: result.rows,
      _file_findings: result.fileFindings,
      _counts: result.counts,
    });

    if (landError) {
      // The bytes are removed again rather than left addressing nothing. A
      // stored object with no manifest row is invisible; a manifest row with no
      // object is a lie, and only one of those is worth avoiding by hand.
      await supabase.storage.from(BUCKET).remove([storagePath]);
      console.error("[ingest-file] landing failed", landError);
      return json({ success: false, stage: "land", error: landError.message }, 500);
    }

    const runId = (landed as { run_id: string }).run_id;

    const { data: applied, error: applyError } = await supabase.rpc("ingest_apply_run", {
      _run_id: runId, _actor_user_id: userId,
    });
    if (applyError) {
      // The landing STANDS. Tier 0 and tier 1 record what was uploaded whether or
      // not the promotion succeeded, which is the point of having them: the run
      // is re-appliable and the file is still there to look at.
      console.error("[ingest-file] apply failed", applyError);
      return json({
        success: false, stage: "apply", error: applyError.message,
        run_id: runId, landed, findings: result.fileFindings,
      }, 500);
    }

    const rowFindings: Finding[] = result.rows.flatMap((r) => r.findings);
    return json({
      success: true,
      run_id: runId,
      file_id: (landed as { file_id: string }).file_id,
      content_sha256: sha,
      target: spec.target,
      rows_read: result.rows.length,
      rows_staged: (landed as { rows_staged: number }).rows_staged,
      rows_promoted: (applied as { rows_promoted: number }).rows_promoted,
      rows_held: (applied as { rows_held: number }).rows_held,
      counts: result.counts,
      // Bounded: a file where every row is wrong would otherwise return a
      // response the size of the file. The counts above are complete; the run
      // holds every finding, row by row, for the review screen (WP 3.4).
      findings: [...result.fileFindings, ...rowFindings.slice(0, 200)],
      findings_truncated: rowFindings.length > 200 ? rowFindings.length - 200 : 0,
    });
  } catch (e) {
    console.error("[ingest-file] handler error", e);
    return json({ success: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
