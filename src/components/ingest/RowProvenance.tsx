/**
 * WHERE A CANONICAL ROW CAME FROM (Phase 3 / WP 3.4, PLAN.md §10:
 * "show provenance on canonical rows").
 *
 * THE CLICK-THROUGH IS A JOIN, NOT A FEATURE. WP 3.3 put `ingest_run_id` and
 * `source_row_id` on all nine promotion targets, so a tier-2 row already points
 * at the staged row, whose `source_row_number` is the PHYSICAL line of the file
 * (header = line 1), whose run points at the `ingest_files` manifest with the
 * filename and the SHA-256 of the bytes as received. This component is those
 * four hops rendered.
 *
 * A NULL IS "UNKNOWN", NEVER "THERE WAS NONE", and the difference is the whole
 * reason this is a component and not a string template. Both FK columns are
 * `ON DELETE SET NULL` (`20260916000019`), so a null means either the run has
 * been deleted or the row predates the ingestion path — and TODAY IN PRODUCTION
 * IT IS ALWAYS THE SECOND: §15 reports `ingest_run_id` null on all 1 691
 * surviving arcs, because no ingestion run has ever happened. Rendering
 * "no source" for those rows would be a false statement about 100 % of the
 * data; rendering nothing at all would be §5 T1's fourth option, which does not
 * exist. So it says what is true: unknown, and why.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { FileText, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { provenanceText, shortSha, type Provenance } from "@/lib/ingest/runReview";

export interface RowProvenanceRef {
  ingest_run_id?: string | null;
  source_row_id?: string | null;
}

/**
 * Resolves the trace for one tier-2 row. Two reads rather than one join, because
 * PostgREST embeds through a declared foreign key and `source_row_id`'s is
 * DEFERRABLE — it is a real key and it does resolve, but keeping the hop
 * explicit is what makes a partial answer renderable: a staged row that survived
 * while its file row did not still yields the LINE, and a line is most of what a
 * person wanted.
 */
export async function fetchRowProvenance(ref: RowProvenanceRef): Promise<Provenance | null> {
  if (!ref.source_row_id && !ref.ingest_run_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  let line: number | null = null;
  let runId: string | null = ref.ingest_run_id ?? null;
  if (ref.source_row_id) {
    const { data } = await sb
      .from("ingest_staged_rows")
      .select("source_row_number, ingest_run_id")
      .eq("id", ref.source_row_id)
      .maybeSingle();
    if (data) {
      line = data.source_row_number ?? null;
      runId = runId ?? data.ingest_run_id ?? null;
    }
  }

  let filename: string | null = null;
  let sha: string | null = null;
  if (runId) {
    const { data } = await sb
      .from("ingest_files")
      .select("original_filename, content_sha256")
      .eq("ingest_run_id", runId)
      .maybeSingle();
    if (data) {
      filename = data.original_filename ?? null;
      sha = data.content_sha256 ?? null;
    }
  }
  return { filename, line, sha256: sha, runId };
}

export function RowProvenance({
  row,
  className,
  compact = true,
}: {
  row: RowProvenanceRef;
  className?: string;
  compact?: boolean;
}) {
  const [p, setP] = useState<Provenance | null>(null);
  const [loaded, setLoaded] = useState(false);
  const traced = Boolean(row.source_row_id || row.ingest_run_id);

  useEffect(() => {
    let cancelled = false;
    if (!traced) {
      setLoaded(true);
      return;
    }
    void fetchRowProvenance(row).then((r) => {
      if (!cancelled) {
        setP(r);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [row.source_row_id, row.ingest_run_id, traced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return null;
  const { text, known } = provenanceText(traced ? p : null);

  return (
    <Badge
      variant="outline"
      title={known && p?.sha256 ? `${text} · sha256 ${p.sha256}` : text}
      className={cn(
        "h-4 gap-1 px-1.5 text-[9px] font-normal whitespace-nowrap",
        known
          ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : "border-dashed border-muted-foreground/40 text-muted-foreground",
        className,
      )}
    >
      {known ? <FileText className="h-2.5 w-2.5" /> : <HelpCircle className="h-2.5 w-2.5" />}
      {known
        ? compact
          ? `${p?.filename ?? "file"} · line ${p?.line ?? "?"}`
          : `${text}${p?.sha256 ? ` · ${shortSha(p.sha256)}` : ""}`
        : "source unknown"}
    </Badge>
  );
}

export default RowProvenance;
