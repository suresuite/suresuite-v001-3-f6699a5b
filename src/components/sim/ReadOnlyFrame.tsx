import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Renders an editor read-only, with the reason on screen (WP 9.4 slice 4).
 *
 * A `<fieldset disabled>` disables every input, select and button inside it
 * natively, so no editor needs a read-only branch of its own — the controls are
 * the real ones, shown with the values the owner of the row set.
 */
export function ReadOnlyFrame({
  reason,
  children,
}: {
  /** null renders the children untouched */
  reason: string | null;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-[rgba(20,184,196,0.45)] bg-[rgba(20,184,196,0.07)] px-3 py-2 text-[12.5px] text-[#18181b]">
        <span className="min-w-0 flex-1 [text-wrap:pretty]">{reason}</span>
        <Link
          to="/policies"
          className="inline-flex min-h-11 items-center text-[#0e7f88] underline-offset-2 hover:underline md:min-h-0"
        >
          Run &amp; Validate ›
        </Link>
      </div>
      <fieldset disabled className="m-0 min-w-0 border-0 p-0 opacity-80">
        {children}
      </fieldset>
    </div>
  );
}
