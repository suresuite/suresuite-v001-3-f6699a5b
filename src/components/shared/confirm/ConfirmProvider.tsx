/**
 * Serves `useConfirm()` (mobile redesign §2.3). Mounted once in App, inside the
 * router — the sheet reads the route to know whether a tab bar sits under it.
 *
 * Desktop: `window.confirm(message)`, exactly the call the app made before.
 * Phone: one ConfirmSheet at a time; the promise resolves true on the verb and
 * false on Cancel or any dismissal. A second request while one is open answers
 * the first with false — the same "no" a native dialog would have given it.
 */
import * as React from 'react';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { lazyChunk } from '@/lib/lazyChunk';
import { confirmBullets } from './confirmBullets';
import { ConfirmContext, type ConfirmFn, type ConfirmRequest } from './useConfirm';

// Lazy: the provider sits in App, so anything it imports statically lands in the
// initial bundle (scripts/audit-bundle-size.mjs). The sheet pulls in the dialog
// primitives and the mobile chrome, and only a phone that asks a question needs it.
const ConfirmSheet = lazyChunk(() => import('./ConfirmSheet').then((m) => ({ default: m.ConfirmSheet })));

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [request, setRequest] = React.useState<ConfirmRequest | null>(null);
  const resolver = React.useRef<((ok: boolean) => void) | null>(null);

  const settle = React.useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
  }, []);

  const confirm = React.useCallback<ConfirmFn>(
    (req) => {
      if (!isMobile) return Promise.resolve(window.confirm(req.message));
      resolver.current?.(false);
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setRequest(req);
      });
    },
    [isMobile],
  );

  // A pending question must not outlive the provider, or the sheet that asks it
  // (rotating a tablet past the mobile query unmounts the sheet).
  React.useEffect(() => () => resolver.current?.(false), []);
  React.useEffect(() => {
    if (!isMobile && resolver.current) settle(false);
  }, [isMobile, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && isMobile && (
        <React.Suspense fallback={null}>
        <ConfirmSheet
          open
          title={request.title}
          bullets={
            request.bullets ??
            confirmBullets(request.message, {
              lead: request.lead ?? request.title,
              neutral: request.tone === 'neutral',
              actionLabel: request.actionLabel,
              cancelLabel: request.cancelLabel,
            })
          }
          actionLabel={request.actionLabel}
          cancelLabel={request.cancelLabel}
          tone={request.tone}
          dismissible={request.dismissible}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
        </React.Suspense>
      )}
    </ConfirmContext.Provider>
  );
}
