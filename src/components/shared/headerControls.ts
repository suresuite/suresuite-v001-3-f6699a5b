/**
 * Desktop page-header control primitives — handoff "Unified Desktop Page
 * Header (18 surfaces)".
 *
 * One header standard for every authenticated DESKTOP page: 10 main app pages
 * plus the 8 Super Admin sections that render through AdminLayout → PageHeader.
 * The bar is title + right slot, nothing else; every control in the slot is
 * exactly 36px tall (icon-only 36 × 36), 4px radius, 8px apart.
 *
 * ── Why every class here is `md:`-prefixed ──────────────────────────────
 * The handoff is scoped to the desktop product. Below 768px (`useIsMobile`'s
 * MOBILE_BREAKPOINT, which is Tailwind's `md` term for term) the mobile skin
 * owns the chrome: its own 44px touch floor, its own gutter, its own header
 * components under `@/components/mobile`. Prefixing rather than replacing
 * means these constants can be dropped onto a control that renders on BOTH
 * platforms (Profile, Interactive Network Space) without touching the phone.
 *
 * ── Why `cn()` at the call site is not optional ─────────────────────────
 * These override shadcn variant defaults that are themselves `md:`-prefixed
 * (`Button`'s `size="icon"` is `h-11 w-11 md:h-8 md:w-8`). Two `md:h-*` rules
 * in one class list are resolved by tailwind-merge, not by source order, so
 * the constant must reach the element through `cn(...)` with the constant
 * LAST. Every shadcn primitive here already does that with its `className`
 * prop; a hand-rolled element must call `cn()` itself.
 *
 * `box-sizing: border-box` is load-bearing — a bordered 36px control renders
 * 37.1px without it and the bar visibly mis-aligns. Tailwind's preflight sets
 * it globally, which is why no constant below repeats it.
 *
 * Sizes, in Tailwind terms: 36px = `h-9`, 28px = `h-7`, 14px = `px-3.5`,
 * 12px = `px-3`, 10px = `px-2.5`, 4px radius = `rounded-sm` (--radius is 4px
 * product-wide), 16px icon = `h-4`, 14px icon = `h-3.5`.
 */

/** Shared by every 36px control: kills the mobile touch floor the header's
 *  right slot re-applies below `md`, and pins the height and radius. */
const CONTROL = 'md:h-9 md:min-h-0 md:min-w-0 md:rounded-sm';

/** Label treatment shared by the three text buttons (13px / 500) and the
 *  7px gap between a 14px icon and its label. */
const LABEL = 'md:gap-[7px] md:px-3.5 md:text-[13px] md:font-medium md:[&_svg]:h-3.5 md:[&_svg]:w-3.5';

/**
 * Icon-only button — 36 × 36, `--border` hairline, 16px glyph at 75% ink.
 * Pair with shadcn `<Button variant="outline" size="icon">`. Always give it
 * an `aria-label` + `title`: the glyph is the control's whole name.
 */
export const HDR_ICON_BUTTON = `${CONTROL} md:w-9 md:border md:border-border md:bg-background md:p-0 md:text-foreground/75 md:shadow-none md:[&_svg]:h-4 md:[&_svg]:w-4`;

/**
 * The inverted state of a toggle-style icon button (analytics open, labels on,
 * map view) — matching today's `variant={active ? 'default' : 'outline'}`
 * behavior, but in the bar's own ink rather than the primary ramp.
 */
export const HDR_ICON_BUTTON_ON =
  'md:border-foreground md:bg-foreground md:text-background md:hover:bg-foreground/90';

/** Outline button — 36px, `--border` hairline, 13px/500 label, 14px icon. */
export const HDR_OUTLINE_BUTTON = `${CONTROL} ${LABEL} md:border md:border-border md:bg-background md:text-foreground md:shadow-none`;

/** Primary button — 36px, no border, `--primary` fill, `--background` label. */
export const HDR_PRIMARY_BUTTON = `${CONTROL} ${LABEL} md:border-0 md:bg-primary md:text-primary-foreground md:shadow-none md:hover:bg-primary/90 md:active:bg-primary/80`;

/** Ghost button — 36px, no border, no fill, 75% ink that goes full on hover. */
export const HDR_GHOST_BUTTON = `${CONTROL} ${LABEL} md:border-0 md:bg-transparent md:text-foreground/75 md:hover:text-foreground md:shadow-none`;

/**
 * Project select — the one project-context control in the product, identical
 * on all eight pages that carry one: 200 × 36, the `--border-strong` hairline
 * (the only control in the bar that gets it), full-strength ink at 13px/500,
 * 16px chevron at 60%. Goes on `<SelectTrigger>`.
 */
export const HDR_PROJECT_SELECT = `${CONTROL} md:w-[200px] md:justify-between md:gap-2 md:border md:border-border-strong md:bg-background md:px-3 md:text-[13px] md:font-medium md:text-foreground md:data-[placeholder]:text-foreground md:[&>svg]:h-4 md:[&>svg]:w-4 md:[&>svg]:text-foreground/60 md:[&>svg]:opacity-100`;

/**
 * Page-specific filter select (Process-Level's Level 1 Filter) — the plain
 * `--border` hairline and muted label that keep it behind the project select.
 * Width stays at the call site; it is page-specific.
 */
export const HDR_FILTER_SELECT = `${CONTROL} md:justify-between md:gap-2 md:border md:border-border md:bg-background md:px-3 md:text-[13px] md:font-normal md:text-muted-foreground md:[&>svg]:h-4 md:[&>svg]:w-4 md:[&>svg]:opacity-100`;

/**
 * Search input — the admin header fields and the expand-on-click inputs the
 * three network lenses use. Width stays at the call site (240px on Users,
 * 256px on Projects); only the height, radius and type scale are shared.
 */
export const HDR_SEARCH_INPUT = `${CONTROL} md:border md:border-border md:bg-background md:px-3 md:text-[13px] md:placeholder:text-muted-foreground`;

/**
 * Segmented control (Policies' Policies / Guide / Data map) — a 36px shell at
 * radius 5 holding 28px items at radius 3. The items are styled through a
 * child selector because they are rendered by `Segmented` itself; the child
 * combinator out-specifies the button's own utilities, so no `!important`.
 */
export const HDR_SEGMENTED =
  'md:h-9 md:rounded-[5px] md:border-border md:bg-background md:p-[3px] ' +
  'md:[&>button]:h-7 md:[&>button]:rounded-[3px] md:[&>button]:px-2.5 md:[&>button]:py-0 ' +
  'md:[&>button]:text-[12px] md:[&>button]:font-medium';
