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
  // ── The separation model (v2 §2): three grounds, two rule weights. ─────
  //
  //   canvas 93%  ·  head #fafafa  ·  body #fff
  //   outer  #d4d4d4 (anything touching the canvas)
  //   inner  #e8e8ea (anything inside a panel)
  //
  // A panel reads as an object with contents because its outline is heavier
  // than its own row dividers. When both were #d4d4d4 it read as a stack of
  // rules, which is what the black frame was compensating for.

  /** Ink: panel frame, primary-tone head, primary button, active segment.
   *  A fill and a frame value — the ink ladder below carries the text. */
  ink: '#18181b',

  // ── The ink ladder. Contrast on white, top to bottom. Nothing lighter
  //    than `faint` ever carries text (v2 §2). ────────────────────────────
  /** 16.9:1 — row labels, stat values, screen titles. */
  label: '#171717',
  /** 10.8:1 — body copy and prose. Never a heading. */
  body: '#3f3f46',
  /** 7.4:1 — micro-labels at 11px and below. Never below 10px. */
  quiet: '#525252',
  /** 5.3:1 — chevrons and the inactive tab label. The floor. */
  faint: '#6b6b6b',

  /** Row divider and stat-grid gap line — *inside* a panel. Never an outline. */
  divider: '#e8e8ea',
  /** The outer rule: panel outline, head bottom rule, toggle-off track —
   *  anything that touches the canvas. Never text. */
  hair: '#d4d4d4',
  /** Panel interior. Never the page canvas. */
  paper: '#ffffff',
  /** The secondary head's ground: a step off the body so the head reads as a
   *  lid rather than a first row. */
  head: '#fafafa',
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
//
// Three of them are fluid now (v2 §5.3). The clamps live in `index.css` so
// that CSS, not a resize listener, does the sizing: every floor is the spec's
// minimum (micro 10px, row 13.5px, title 17px) and every ceiling is what the
// widest phone and a fold-open tablet should reach. Tailwind needs the
// `length:` hint on a bare var or it guesses `color` and drops the rule —
// `text-[length:var(--fs-row)]`, never `text-[var(--fs-row)]`.

/** 10px mono uppercase — panel head label, stat label, agent badge. The only
 *  uppercase in the skin. Carries no colour: the head sets white, a secondary
 *  head sets `M.quiet`. */
export const M_LABEL = 'font-mono text-[10px] uppercase tracking-[0.14em]';

/** 10.5–11px mono — row sub-line, ids, counters, timestamps. */
export const M_MICRO =
  'font-mono text-[length:var(--fs-micro)] leading-tight tracking-[0.04em] text-[#525252]';

/** 13.5–15px — the row label, the workhorse size. */
export const M_ROW =
  'text-[length:var(--fs-row)] font-medium leading-tight text-[#171717]';

/** 14.5px — agent prose and chat only. Nothing else in the app gets this.
 *  Fixed, not fluid: prose adapts by line count, never by pixel height
 *  (v2 §5.4). */
export const M_PROSE = 'text-[14.5px] leading-[1.55] text-[#3f3f46] [text-wrap:pretty]';

/** 17–21px — the screen title. One per screen. 19px at 390. */
export const M_TITLE =
  'text-[length:var(--fs-title)] font-semibold leading-tight tracking-[-0.019em] text-[#171717]';

/** 20–28px — stat values only, always tabular. The cell steps the size down
 *  inside that band when the figure is long; the figure itself never moves. */
export const M_STAT =
  'text-[28px] font-semibold leading-[1.05] tracking-[-0.022em] tabular-nums text-[#171717]';

// ── Geometry and rhythm. ─────────────────────────────────────────────────

/** The screen gutter and the gap between groups, both fluid (v2 §5.3):
 *  14–18px of gutter, 18–24px between groups. */
export const M_SCREEN =
  'flex flex-col gap-[var(--m-gap)] px-[var(--m-gutter)] pb-4';

/** A row's box: the 44px touch floor, 11–14px vertical padding, 12px
 *  horizontal, 10px gap. `min-h-11` is the floor the padding never undercuts
 *  — checked at every value in the clamp, not assumed. */
export const M_ROW_BOX =
  'flex min-h-11 w-full items-center gap-2.5 px-3 py-[var(--m-row-y)] text-left';

/** Every button row wraps rather than squeezing below the touch minimum (§9.3). */
export const M_BUTTON_ROW = 'flex flex-wrap gap-2';
export const M_BUTTON_CELL = 'flex-[1_1_140px] min-w-0';

/** Ids, keys and lane codes break anywhere; they are never allowed to widen
 *  the screen (§9.4). */
export const M_CODE =
  'font-mono text-[length:var(--fs-micro)] tracking-[0.04em] [word-break:break-all]';

/** Colour transitions take 200ms; nothing else in the skin animates. */
export const M_FADE = 'transition-colors duration-200 motion-reduce:transition-none';
