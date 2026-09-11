// src/hooks/useViewport.ts
//
// The second axis. `useIsMobile()` answers one question — is this below `md` —
// and that is the right question for a structural branch. It is the wrong
// question for how much fits: a 320x568 SE and a 430x932 Pro Max are both
// "mobile", and a screen tuned for one either clips its last panel on the
// first or strands 200px of bare canvas on the second (v2 §5.1).
//
// Rules for using it:
//
//   * It NEVER changes what renders — only how much of it renders at once,
//     and at what size. Same components, same data, same routes on every
//     device. A row that does not fit is deferred into a sheet, never dropped.
//   * Prefer CSS. `clamp()`, `dvh` and container queries size things without
//     a listener and without a re-render; the clamp set in `index.css` is
//     where sizing belongs. Reach for this hook only when the decision is a
//     COUNT — how many rows, how many stat cells — because CSS cannot count.
//   * One listener for the app, not one per component. `useViewport()` reads
//     the value published by <ViewportProvider>, mounted once in App.
//
// The bands are device classes, not arbitrary thresholds:
//
//   compact   320-379   SE, mini, small Android
//   regular   380-519   12 / 13 / 14 / 15, Pixel, Galaxy
//   wide      >= 520    Pro Max in landscape, fold open, tablet portrait
//
//   short     < 700     SE / 8 (667), any phone in landscape
//   standard  700-849   13 / 14 / 15 (844-852)
//   tall      >= 850    Pro Max (932), Ultra (915+)

import * as React from 'react';

export type WidthBand = 'compact' | 'regular' | 'wide';
export type HeightBand = 'short' | 'standard' | 'tall';

export interface Viewport {
  width: WidthBand;
  height: HeightBand;
  landscape: boolean;
  /** The dynamic viewport height in px — what `100dvh` resolves to now. */
  dvh: number;
  /** `env(safe-area-inset-bottom)` in px, 0 where the device has none. */
  safeBottom: number;
}

const WIDTH_BANDS: ReadonlyArray<readonly [number, WidthBand]> = [
  [380, 'compact'],
  [520, 'regular'],
];

const HEIGHT_BANDS: ReadonlyArray<readonly [number, HeightBand]> = [
  [700, 'short'],
  [850, 'standard'],
];

function bandFor<T>(px: number, bands: ReadonlyArray<readonly [number, T]>, last: T): T {
  for (const [limit, band] of bands) if (px < limit) return band;
  return last;
}

/** The inset the device reserves for the home indicator. Read off a probe
 *  element rather than guessed: `env()` is not readable from JS directly, and
 *  the value differs between a notched phone, the same phone in landscape,
 *  and an installed PWA. */
function readSafeBottom(): number {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;' +
    'height:env(safe-area-inset-bottom, 0px)';
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return px;
}

/** SSR and first paint: a 390x844 phone, the modal device. Nothing renders
 *  differently on the strength of it — the first effect corrects it before
 *  paint, and every consumer must be correct at any band anyway. */
const FALLBACK: Viewport = {
  width: 'regular',
  height: 'standard',
  landscape: false,
  dvh: 844,
  safeBottom: 0,
};

function measure(): Viewport {
  if (typeof window === 'undefined') return FALLBACK;
  const w = window.innerWidth;
  // `visualViewport.height` is the dynamic height — it tracks the URL bar
  // collapsing, which `innerHeight` on iOS does not.
  const h = window.visualViewport?.height ?? window.innerHeight;
  return {
    width: bandFor(w, WIDTH_BANDS, 'wide'),
    height: bandFor(h, HEIGHT_BANDS, 'tall'),
    landscape: w > h,
    dvh: h,
    safeBottom: readSafeBottom(),
  };
}

function same(a: Viewport, b: Viewport): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.landscape === b.landscape &&
    a.dvh === b.dvh &&
    a.safeBottom === b.safeBottom
  );
}

const ViewportContext = React.createContext<Viewport | null>(null);

/**
 * Mounted once, at the top of the app. Everything below reads the same object,
 * so a screen with nine panels costs one listener rather than nine.
 */
export function ViewportProvider({ children }: { children: React.ReactNode }) {
  const [vp, setVp] = React.useState<Viewport>(FALLBACK);

  React.useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      // Coalesce to one measurement per frame: an iOS URL-bar collapse fires
      // `resize` and `visualViewport.resize` together, and a rotation fires
      // both again on the way out.
      frame = requestAnimationFrame(() => setVp((prev) => {
        const next = measure();
        return same(prev, next) ? prev : next;
      }));
    };

    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, []);

  return <ViewportContext.Provider value={vp}>{children}</ViewportContext.Provider>;
}

/** The viewport bands. Falls back to a 390x844 phone where the provider is
 *  absent — a test harness, a story — rather than throwing: nothing here is
 *  load-bearing enough to fail a render over. */
export function useViewport(): Viewport {
  return React.useContext(ViewportContext) ?? FALLBACK;
}

/**
 * True where the bottom chrome takes its compact form: a phone held sideways
 * (v2 §5.2). A landscape phone has ~390px of height, and the portrait tab bar
 * plus action bar would spend a third of it on chrome, so both bands lay their
 * contents along the axis that has room. Nothing is removed in either
 * orientation — same tabs, same actions, same destinations.
 */
export function useCompactChrome(): boolean {
  const { landscape, height } = useViewport();
  return landscape && height === 'short';
}

/**
 * How many rows of a list a device can hold before the rest is deferred
 * (v2 §5.4). The deferral row that follows is not optional — "defer, never
 * truncate" means the full list is one tap away in a sheet, with every column
 * the desktop view has.
 *
 *   useRowBudget()            3 / 5 / 7 by height band
 *   useRowBudget(2, 4, 6)     a denser row, or a panel that shares the screen
 */
export function useRowBudget(short = 3, standard = 5, tall = 7): number {
  const { height } = useViewport();
  return height === 'short' ? short : height === 'standard' ? standard : tall;
}

/**
 * How many stat cells fit above the fold (v2 §5.4): the 3 headline figures on
 * a short device, 4 on a standard one, 6 on a tall one. The rest are not
 * dropped — they live on the detail screen that already holds them.
 */
export function useStatBudget(short = 3, standard = 4, tall = 6): number {
  const { height } = useViewport();
  return height === 'short' ? short : height === 'standard' ? standard : tall;
}

/** Prose clamps by LINES, never by pixels — a pixel `max-height` on text is
 *  the one thing §9.4 rules out outright. 4 / 6 / 8 by height band. */
export function useProseLines(short = 4, standard = 6, tall = 8): number {
  const { height } = useViewport();
  return height === 'short' ? short : height === 'standard' ? standard : tall;
}
