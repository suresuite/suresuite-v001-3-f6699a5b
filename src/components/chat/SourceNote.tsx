/** §17.2: "every card carries its source note (meta.tool)" — the one-line
 * provenance footer of a data card. Renders nothing when the source could not
 * be derived (see partSourceNotes in partStyles.ts). */
export function SourceNote({ tool }: { tool?: string | null }) {
  if (!tool) return null;
  return (
    <div className="border-t border-border/60 px-2 py-1 text-[10.5px] text-muted-foreground">
      Source: <span className="font-mono">{tool}</span>
    </div>
  );
}
