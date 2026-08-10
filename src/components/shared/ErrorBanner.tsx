import { ReactNode } from 'react';

/** Destructive error box shared by the admin pages. */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-sm border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {children}
    </div>
  );
}
