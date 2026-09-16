// D20 · A PARTIAL READ IS SHOWN, NOT LOGGED.
//
// `projectLanes`'s fallback reads each lane table with an explicit ceiling. It
// used to return the slice as though it were the project, and the only trace
// was a `.limit(10000)` in the source — no warning, no banner, nothing the
// person reading the numbers could see. Every surface that renders lane-derived
// values therefore has to render this when the read was cut short: §5 T2 says
// substitution is visible AT THE POINT OF DISPLAY, and a truncated read is the
// largest substitution there is — the rest of the project standing in as zero.
//
// The wording lives in `laneTruncationNotice()`, not here, because the policy
// grid, the data map and the verification stage all show the same fact and
// three paraphrases of one fact is what `single-source` (I1) forbids.
import { TriangleAlert } from "lucide-react";
import { laneTruncationNotice } from "@/lib/policies/laneTruncation";
import type { ProjectLanes } from "@/lib/policies/projectLanes";

export function LaneTruncationNotice({
  truncated,
  className,
}: {
  truncated: ProjectLanes["truncated"] | undefined;
  className?: string;
}) {
  const message = laneTruncationNotice({ truncated: truncated ?? [] });
  if (!message) return null;
  return (
    <div
      role="status"
      className={
        "flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 " +
        "text-sm text-amber-800 dark:text-amber-200 " +
        (className ?? "")
      }
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
