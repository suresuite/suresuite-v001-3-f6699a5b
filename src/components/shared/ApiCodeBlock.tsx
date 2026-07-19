import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Copy } from 'lucide-react';

/** Titled code snippet with a copy button — lifted from DeveloperApi's local Snippet. */
export function ApiCodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="ml-1.5">Copy</span>
        </Button>
      </div>
      <pre className="rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}
