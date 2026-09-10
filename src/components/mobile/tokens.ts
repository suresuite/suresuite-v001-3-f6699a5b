// The mobile skin — one palette, five type sizes, six radii.
//
// Source: `docs/mobile-skin-spec.md`, itself the handoff's `Mobile UI Rules`.
// These are literal design values, not themeable surfaces: the skin is a
// light-only, fixed-ink language that exists below `md` and nowhere else, so
// it is held as hex here rather than as HSL tokens in index.css. Nothing in
// this file may be used above `md` — the desktop system is unchanged, and a
// shared component that reaches for these must gate them behind the mobile
// branch (`useIsMobile()` or a `md:` reset).
//
// Two ways to spend them:
//   * `M` — raw hex, for inline styles and SVG/canvas fills where a class
//     cannot reach (dots, tracks, progress fills).
//   * the `M_*` class constants — Tailwind arbitrary values, for markup.
// Both quote the same numbers; change one, change the other.

export const M = {
  /** Ink, panel frame, panel head, primary button, active segment. Never a page background. */
  ink: '#18181b',
  /** Body copy and prose. Never a heading. */
  body: '#3f3f46',
  /** Secondary text, micro-labels, chevrons, inactive tab. Never below 10px. */
  quiet: '#525252',
  /** Row divider *inside* a panel. Never a panel outline. */
  divider: '#e4e4e4',
  /** Secondary panel outline, stat-grid gap line, toggle-off track. Never text. */
  hair: '#d4d4d4',
  /** Panel interior, tab bar, thread canvas. Never the page canvas. */
  paper: '#ffffff',
  /** The segmented control's track — a half-step darker than `divider`. */
  track: '#e4e4e7',

  // ── Meaning. Only ever a 6px dot, a 2px rule, or a small chip. ──────────
  /** Firm level · derived or imputed · the warning frame. */
  firm: '#e0930b',
  /** Product level. */
  product: '#7c3aed',
  /** Process level · running or healthy. */
  process: '#14b8c4',
  /** Blocking · rejected · risk analyst · the `!` mark. */
  blocking: '#bf2330',
  /** "Begin here", and only that: template download, walkthrough, pending count. */
  begin: '#F8D448',
  /** The 1px edge that keeps a `begin` fill from floating off the canvas. */
  beginEdge: '#e6c02f',
  /** Queued · inactive · off. Same value as `hair`, different job. */
  idle: '#d4d4d4',

  // ── The amber frame. A fill this large is legal only at 12% alpha. ──────
  warnFill: '#e0930b1f',
  warnInk: '#6b4405',
} as const;

// ── Type. Five sizes and nothing between them. ───────────────────────────

/** 10px mono uppercase — panel head label, stat label, agent badge. The only
 *  uppercase in the skin. Carries no colour: the head sets white, a secondary
 *  head sets `M.quiet`. */
export const M_LABEL = 'font-mono text-[10px] uppercase tracking-[0.14em]';

/** 10.5px mono — row sub-line, ids, counters, timestamps. */
export const M_MICRO = 'font-mono text-[10.5px] leading-tight tracking-[0.04em] text-[#525252]';

/** 13.5px — the row label, the workhorse size. */
export const M_ROW = 'text-[13.5px] font-medium leading-tight text-[#18181b]';

/** 14.5px — agent prose and chat only. Nothing else in the app gets this. */
export const M_PROSE = 'text-[14.5px] leading-[1.55] text-[#3f3f46] [text-wrap:pretty]';

/** 19px — the screen title. One per screen. */
export const M_TITLE =
  'text-[19px] font-semibold leading-tight tracking-[-0.019em] text-[#18181b]';

/** 20–28px — stat values only, always tabular. */
export const M_STAT =
  'text-[28px] font-semibold leading-[1.05] tracking-[-0.022em] tabular-nums text-[#18181b]';

// ── Geometry and rhythm. ─────────────────────────────────────────────────

/** Screen gutter, 16px, and the 12px gap between panels. */
export const M_SCREEN = 'flex flex-col gap-3 px-4 pb-4';

/** A row's box: the 44px touch floor, 13px/12px padding, 10px gap. */
export const M_ROW_BOX = 'flex min-h-11 w-full items-center gap-2.5 px-3 py-[13px] text-left';

/** Every button row wraps rather than squeezing below the touch minimum (§9.3). */
export const M_BUTTON_ROW = 'flex flex-wrap gap-2';
export const M_BUTTON_CELL = 'flex-[1_1_140px] min-w-0';

/** Ids, keys and lane codes break anywhere; they are never allowed to widen
 *  the screen (§9.4). */
export const M_CODE = 'font-mono text-[10.5px] tracking-[0.04em] [word-break:break-all]';

/** Colour transitions take 200ms; nothing else in the skin animates. */
export const M_FADE = 'transition-colors duration-200 motion-reduce:transition-none';
