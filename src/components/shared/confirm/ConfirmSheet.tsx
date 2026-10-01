/**
 * ConfirmSheet — the phone's "are you sure?" (mobile redesign handoff §2.3).
 *
 * Mobile-only: <ConfirmProvider> mounts it only below the mobile query, and the
 * two typed-name deletes render it only in their `useIsMobile()` branch. It is
 * a ResponsiveDialog, so it has the one sheet geometry and the no-autofocus rule.
 *
 * Title names the object and ends with "?"; the bullets are the existing
 * confirm text (confirmBullets.ts) on a white panel, red dots for permanent
 * loss and amber for side effects; the footer is Cancel plus one red verb.
 * The typed-name variant adds a field that is never focused for the user and
 * keeps the verb disabled, with its reason in view, until the caller's existing
 * check passes.
 */
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import type { ConfirmBullet } from './confirmBullets';

const DOT: Record<ConfirmBullet['tone'], string> = {
  red: 'bg-[#bf2330]',
  amber: 'bg-[#e0930b]',
  neutral: 'bg-[#d4d4d4]',
};

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  bullets?: ConfirmBullet[];
  /** Bullets under the existing copy's own headings ("Deleted, forever",
   *  "Kept, …"), one panel each with the heading as its panel head. */
  groups?: { label?: string; bullets: ConfirmBullet[] }[];
  /** 12px lines under the panel — the existing secondary copy. */
  notes?: React.ReactNode[];
  actionLabel: string;
  cancelLabel?: string;
  tone?: 'destructive' | 'neutral';
  dismissible?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** The action is running: the verb reads `busyLabel` and nothing can be pressed. */
  busy?: boolean;
  busyLabel?: string;
  /** What went wrong, in red above the buttons; the sheet stays open. */
  error?: string | null;
  /** Why the verb is disabled. Shown above the buttons; null when it is enabled. */
  disabledReason?: string | null;
  typed?: {
    label: React.ReactNode;
    value: string;
    onChange: (v: string) => void;
  };
}

export function ConfirmSheet({
  open,
  title,
  bullets = [],
  groups = [],
  notes,
  actionLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
  dismissible = true,
  onConfirm,
  onCancel,
  busy = false,
  busyLabel,
  error,
  disabledReason,
  typed,
}: ConfirmSheetProps) {
  const inputId = React.useId();
  const disabled = busy || !!disabledReason;
  const note = error ? (
    <p role="alert" className="mb-2 text-[12px] leading-[1.4] text-[#bf2330]">{error}</p>
  ) : disabledReason ? (
    <p className="mb-2 text-[12px] leading-[1.4] text-[#525252]">{disabledReason}</p>
  ) : null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => {
        if (!v && dismissible && !busy) onCancel();
      }}
    >
      <ResponsiveDialogContent aria-describedby={undefined}>
        <ResponsiveDialogHeader hideClose={!dismissible}>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {bullets.length > 0 && <BulletPanel bullets={bullets} />}
        {groups.map((g, i) =>
          g.bullets.length > 0 ? <BulletPanel key={i} label={g.label} bullets={g.bullets} /> : null,
        )}

        {notes?.map((n, i) => (
          <p key={i} className="text-[12px] leading-[1.4] text-[#525252]">{n}</p>
        ))}

        {typed && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[12px] leading-[1.4] text-[#525252]">
              {typed.label}
            </label>
            {/* 16px text: iOS zooms the page into any field smaller than that. */}
            <input
              id={inputId}
              value={typed.value}
              onChange={(e) => typed.onChange(e.target.value)}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="h-11 w-full rounded-[4px] border border-[#d4d4d4] bg-white px-3 font-mono text-[16px] text-[#171717] outline-none focus:border-[#18181b]"
            />
          </div>
        )}

        <ResponsiveDialogFooter note={note}>
          <Button variant="outline" className="border-[#d4d4d4] font-medium" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={disabled}
            className={cn(
              'font-semibold text-white shadow-none disabled:opacity-100 disabled:bg-[#a1a1aa]',
              tone === 'destructive' ? 'bg-[#bf2330] hover:bg-[#a51e29] active:bg-[#a51e29]' : 'bg-[#18181b] hover:bg-[#18181b]/90',
            )}
          >
            {busy ? busyLabel ?? actionLabel : actionLabel}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** The skin's Panel: white, 1px #d4d4d4, 4px radius; an optional #fafafa head
 *  in the mono micro-label; rows divided by #e8e8ea. */
function BulletPanel({ label, bullets }: { label?: string; bullets: ConfirmBullet[] }) {
  return (
    <section className="overflow-hidden rounded-[4px] border border-[#d4d4d4] bg-white">
      {label && (
        <h3 className="flex min-h-8 items-center border-b border-[#e8e8ea] bg-[#fafafa] px-3 py-[7px] font-mono text-[10px] font-medium uppercase leading-[1.3] tracking-[0.14em] text-[#525252]">
          {label}
        </h3>
      )}
      <ul>
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex gap-2.5 border-b border-[#e8e8ea] px-3.5 py-[11px] text-[14.5px] leading-[1.4] text-[#171717] last:border-b-0"
          >
            <span aria-hidden className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', DOT[b.tone])} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{b.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
