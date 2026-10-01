/**
 * `useConfirm()` — the one way to ask "are you sure?" (mobile redesign §2.3).
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ message, title, actionLabel }))) return;
 *
 * On desktop it is `window.confirm(message)`, the same text as before, so the
 * desktop behaves exactly as it did. On a phone it opens the ConfirmSheet:
 * `title` as its header, `message` split into bullets (see confirmBullets.ts),
 * Cancel and a red verb. Mounted by <ConfirmProvider> in App; without one (a
 * test, a story) it falls back to `window.confirm` everywhere.
 */
import * as React from 'react';
import type { ConfirmBullet } from './confirmBullets';

export interface ConfirmRequest {
  /** The existing `window.confirm` text, verbatim — what the desktop shows. */
  message: string;
  /** Phone title: names the object and ends with "?". */
  title: string;
  /** The message's leading question, verbatim, when the title restates it in
   *  other words. Defaults to `title`. */
  lead?: string;
  /** The primary verb: "Delete project", "Remove", "Delete version". */
  actionLabel: string;
  cancelLabel?: string;
  /** `neutral` for a choice that destroys nothing (reuse or re-run): ink
   *  primary, grey dots. */
  tone?: 'destructive' | 'neutral';
  /** False when closing the sheet without choosing would itself pick an
   *  outcome (on the reuse prompt, Cancel re-runs): no ✕, no scrim tap, no
   *  drag — one of the two buttons must be pressed. */
  dismissible?: boolean;
  /** Overrides the split of `message`. */
  bullets?: ConfirmBullet[];
}

export type ConfirmFn = (req: ConfirmRequest) => Promise<boolean>;

const nativeConfirm: ConfirmFn = (req) =>
  Promise.resolve(typeof window !== 'undefined' && window.confirm(req.message));

export const ConfirmContext = React.createContext<ConfirmFn>(nativeConfirm);

export function useConfirm(): ConfirmFn {
  return React.useContext(ConfirmContext);
}
