/**
 * Grid atoms for StagePolicyTable — the polished cell/header vocabulary.
 * Drop at: src/components/policies/policyGridUi.tsx
 *
 * These replace the pastel FAMILY_HUE bands, the shadcn badge family, the idle
 * sort glyph and the per-cell <Select>s. Everything here is presentational;
 * resolution/draft logic stays in StagePolicyTable.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { LAYER, tint } from "@/components/intelligence/piUi";

/* ── provenance ──────────────────────────────────────────────────────── */

/**
 * THE A1 PROVENANCE VOCABULARY (§5.4), COMPLETED IN WP 6.3.
 *
 * §5.4 names ten states: `data · master · contract · estimated · imputed ·
 * derived · suggested · override · edited · default`. This union carried EIGHT.
 * `contract` was in the `PROVENANCE` record below and not in the type, which
 * TypeScript reported and `scripts/typecheck-baseline.json` recorded as debt on
 * "WP 6.2's surface" — so the state that exists to make a substitution visible
 * (§4 D17) was itself invisible to the type system. It is declared now.
 *
 * `estimated` IS DELIBERATELY ABSENT AND THAT IS THE POINT. §14 reserves it for
 * the observations track: a value fitted from recorded history, with an n, a
 * window and a fit quality behind it. Nothing produces one today, and a state in
 * this union with no producer is a dot the grid could never draw — a promise, not
 * a vocabulary (the `seeded_from_hash` lesson: a column nothing fills). It joins
 * when an estimator does, and `provenanceVocabulary.test.ts` holds §5.4's list
 * against this union so the omission stays deliberate instead of becoming a gap.
 *
 * The rule every state answers to: NO DOT MAY CLAIM MORE THAN IT KNOWS (D16).
 */
export type Provenance =
  | "data"      // from project data
  | "master"    // from item master
  | "contract"  // EMPTY, and the schema declares what empty means (§4 D17)
  | "imputed"   // imputed project average — verify
  | "derived"   // derived fallback (≈)
  | "suggested" // this stage's own routing suggestion, ranked from uploaded volumes
  | "override"  // saved override
  | "edited"    // unsaved edit
  | "default";  // bundle default

export const PROVENANCE: Record<Provenance, { color: string | null; title: string }> = {
  data: { color: LAYER.process, title: "From project data" },
  master: { color: LAYER.process, title: "From item master" },
  imputed: { color: LAYER.brand, title: "Imputed project average — verify" },
  derived: {
    color: LAYER.firm,
    title: "Derived fallback (≈) — the engine computes this from your inbound/outbound uploads",
  },
  suggested: {
    color: LAYER.firm,
    title: "Suggested by ranking your uploaded volumes — not an uploaded value; confirm it",
  },
  override: { color: LAYER.product, title: "Saved override" },
  edited: { color: "#111111", title: "Edited" },
  /**
   * NOT A VALUE — the DECLARED MEANING OF AN EMPTY ONE (§4 D17).
   *
   * `suppliers.capacity_per_week` is nullable and `item_master.sql:44` says what
   * a null means: "NULL = ∞; finite enables partial capacity cuts". The grid used
   * to render that as `0` with provenance `default`, whose colour is null — so no
   * dot at all. Sixty of sixty suppliers in the measured project have a null
   * capacity (§15), which means the grid told the user every supplier in their
   * network had ZERO capacity when the model means unlimited. The exact inverse,
   * silently, on every row.
   *
   * This state renders the declared token instead of a made-up number, and it has
   * a colour, so a substitution is visible at the point of display (T2).
   */
  contract: { color: LAYER.firm, title: "Empty — the schema declares what that means" },
  default: { color: null, title: "Bundle default" },
};

export function ProvenanceDot({ p }: { p: Provenance }) {
  const { color, title } = PROVENANCE[p];
  if (!color) return null;
  return (
    <span
      title={title}
      className="absolute right-[2px] top-[2px] h-1 w-1 rounded-full"
      style={{ background: color }}
    />
  );
}

/**
 * The dot AS A BUTTON — A2's trigger (§5.4, WP 6.3).
 *
 * The dot itself is 4px, which is not a tap target. The button around it is 24px
 * with a negative margin, so the hit area grows without moving the dot one pixel:
 * the grid's column widths are computed from `columnFit` and a trigger that took
 * layout space would reflow every row.
 *
 * Presentational on purpose — it takes an `onClick` and knows nothing about what
 * opens. `policyGridUi` is the grid's atom set and the read lives in
 * `ValueChainPopover`, so the atom stays free of a data dependency.
 *
 * A column whose provenance state has NO colour (`default`) still gets a button,
 * because "nothing you supplied is in play" is one of the most useful things A2
 * can tell a reader, and it is the one state the dot cannot show.
 */
export function ProvenanceDotButton({ p, label }: { p: Provenance; label: string }) {
  const { color, title } = PROVENANCE[p];
  return (
    <button
      type="button"
      aria-label={`Where did ${label} come from?`}
      title={`${title} — click for the full chain`}
      className="absolute right-0 top-0 z-10 flex items-center justify-center p-[6px] leading-none"
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="block h-1 w-1 rounded-full"
        style={{ background: color ?? "#d4d4d4", outline: "1px solid transparent" }}
      />
    </button>
  );
}

export function ProvenanceLegend({ imputedLines }: { imputedLines?: number }) {
  const items: Array<[string, string]> = [
    ["from project data", LAYER.process],
    ["imputed average — verify", LAYER.brand],
    ["derived fallback (≈) · suggested · declared meaning of empty", LAYER.firm],
    ["saved override", LAYER.product],
    ["edited", "#111111"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10.5px] text-muted-foreground">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
      {!!imputedLines && (
        <span style={{ color: LAYER.brand }}>
          {imputedLines} line{imputedLines === 1 ? "" : "s"} use estimated values
        </span>
      )}
    </div>
  );
}

/* ── family bands ────────────────────────────────────────────────────── */

/** Policy family → layer color. Replaces FAMILY_HUE. */
export const FAMILY_COLOR: Record<string, string> = {
  sourcing: LAYER.process,
  material: LAYER.process,
  inventory: LAYER.firm,
  production: LAYER.product,
  product: LAYER.product,
  fulfillment: LAYER.brand,
  transport: "#9a9a9a",
};

export function FamilyBand({
  family,
  label,
  width,
  collapsed,
  last,
  onToggle,
}: {
  family: string;
  /** Display text override (e.g. "sourcing (folded)") — `family` still drives the color. */
  label?: string;
  width: number;
  collapsed: boolean;
  /** The outermost column carries no right rule — otherwise it springs a scrollbar. */
  last?: boolean;
  onToggle: () => void;
}) {
  const color = FAMILY_COLOR[family] ?? "#9a9a9a";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${collapsed ? "Expand" : "Collapse"} the ${family} family`}
      style={{
        flex: `0 0 ${width}px`,
        width,
        color,
        opacity: collapsed ? 0.45 : 1,
        borderRight: last ? "none" : "2px solid #ffffff",
      }}
      className="flex h-full w-full items-center gap-1.5 overflow-hidden px-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.16em]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">{label ?? family}</span>
      <span className="shrink-0 text-[9px] text-white/60">{collapsed ? "▸" : "▾"}</span>
    </button>
  );
}

export function FamilyChip({
  family,
  hidden,
  onToggle,
}: {
  family: string;
  hidden: boolean;
  onToggle: () => void;
}) {
  const color = FAMILY_COLOR[family] ?? "#9a9a9a";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={`${hidden ? "Show" : "Hide"} ${family}`}
      className="inline-flex h-[22px] items-center gap-1.5 rounded-sm px-[7px] font-mono text-[10px] uppercase tracking-[0.08em]"
      style={
        hidden
          ? { border: "1px solid var(--zinc-border)", background: "#ffffff", color: "#c4c4c4" }
          : { border: "1px solid transparent", background: tint(color, 0.1), color }
      }
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: hidden ? "#dcdcdc" : color }}
      />
      {family}
    </button>
  );
}

/* ── column header ───────────────────────────────────────────────────── */

/**
 * Sort arrow renders ONLY on the active column — an always-present idle glyph
 * reserved ~11px in every header and collided with the info button.
 */
export function SortHeader({
  label,
  sub,
  dir,
  onSort,
  onInfo,
  pending,
  quiet,
  filter,
  onFilter,
  last,
}: {
  label: string;
  /** Second header line: unit, range, provenance note — never part of `label`. */
  sub?: string;
  dir: "asc" | "desc" | null;
  onSort: () => void;
  onInfo?: () => void;
  pending?: boolean;
  /** Engine-pending column: dims the sub line further. */
  quiet?: boolean;
  filter?: string;
  onFilter?: (v: string) => void;
  /** The outermost column carries no right rule — it would spring a scrollbar. */
  last?: boolean;
}) {
  return (
    <div
      className="flex h-full flex-col justify-between gap-[3px] px-1.5 py-1"
      style={{ borderRight: last ? "none" : "1px solid rgba(255,255,255,0.22)" }}
    >
      <div className="flex min-w-0 items-start gap-[3px]">
        <button
          type="button"
          onClick={onSort}
          title={sub ? `${label} — ${sub}` : label}
          className="flex min-w-0 flex-1 flex-col items-start text-left font-mono text-white"
        >
          <span className="flex w-full min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase leading-[1.2] tracking-[0.08em]">
              {label}
            </span>
            {dir && <span className="shrink-0 font-mono text-[9px] text-white">{dir === "asc" ? "↑" : "↓"}</span>}
          </span>
          {sub && (
            <span
              className="w-full truncate text-[9px] leading-[1.2] normal-case tracking-normal"
              style={{ color: quiet ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.55)" }}
            >
              {sub}
            </span>
          )}
        </button>
        {onInfo && (
          <button
            type="button"
            onClick={onInfo}
            title="unit · range · meaning · engine use"
            className="grid h-3 w-3 shrink-0 place-items-center rounded-full border border-white/40 font-mono text-[8px] leading-none text-white hover:border-white hover:text-white"
          >
            i
          </button>
        )}
      </div>
      {pending && (
        <span
          title="Stored and versioned — not consumed by the engine yet."
          className="self-start rounded-sm bg-white/15 px-1 font-mono text-[9px] text-white"
        >
          pending
        </span>
      )}
      {onFilter && (
        <input
          value={filter ?? ""}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="filter"
          size={1}
          style={{ boxSizing: "border-box", minWidth: 0 }}
          className="h-[18px] w-full rounded border border-[--zinc-border] bg-white px-[5px] text-[10px] text-foreground outline-none placeholder:text-[#a3a3a3] focus:border-foreground"
        />
      )}
    </div>
  );
}

/* ── cells ───────────────────────────────────────────────────────────── */

export function NumCell({
  value,
  provenance,
  onCommit,
  decimals,
  integer,
  unit,
  placeholder = "—",
  title,
  dot,
}: {
  value: number | undefined;
  provenance: Provenance;
  onCommit: (v: number | undefined) => void;
  /**
   * What an EMPTY cell shows. "—" for a column where empty means "unset", and
   * the schema's declared token where empty means something — "∞" for a supplier
   * capacity (§4 D17). It is a placeholder and not a value on purpose: typing
   * over it still commits a number, and clearing the cell returns to the
   * declared meaning rather than to a zero nobody chose.
   */
  placeholder?: string;
  /** Fixed decimal count — what puts every row's decimal point on one axis. */
  decimals?: number;
  /** Thousands-separated, no decimals (columnFit `kind: "int"`). */
  integer?: boolean;
  /** Unit glyph rendered in its own fixed gutter, never inside the value text. */
  unit?: string;
  /**
   * The cell's own hover text, which the caller assembles from the resolved
   * provenance — where the number came from, and what stood in for it if nothing
   * did. DECLARED IN WP 6.3: the component already read it and the props type did
   * not carry it, so the one string that answers "where did THIS number come
   * from" was, to the type system, not a prop at all. A2's popover replaces the
   * hover with something a person can read; until it does, this is the answer.
   */
  title?: string;
  /**
   * The provenance marker to render. Defaults to the plain dot; the grid passes a
   * popover-wrapped `ProvenanceDotButton` where A2 can answer (§5.4). A SLOT
   * rather than a callback because the trigger has to BE the element Radix
   * anchors to, and because it keeps this module presentational.
   */
  dot?: React.ReactNode;
}) {
  const derived = provenance === "derived";
  const formatted = (v: number) =>
    integer ? v.toLocaleString("en-US") : decimals != null ? v.toFixed(decimals) : String(v);
  const text = value === undefined || value === null ? "" : (derived ? "≈ " : "") + formatted(value);
  return (
    <>
      {dot ?? <ProvenanceDot p={provenance} />}
      <span
        className="grid h-5 items-center"
        style={{ gridTemplateColumns: `minmax(0,1fr) ${unit ? 14 : 0}px`, columnGap: unit ? 3 : 0 }}
      >
        <input
          defaultValue={text}
          key={text}
          placeholder={placeholder}
          title={title ?? PROVENANCE[provenance].title}
          size={1}
          onBlur={(e) => {
            const raw = e.target.value.replace("≈", "").trim();
            onCommit(raw === "" ? undefined : parseFloat(raw.replace(",", ".")));
          }}
          style={{ boxSizing: "border-box", minWidth: 0 }}
          className="h-5 w-full rounded-sm border border-transparent bg-transparent px-[5px] text-right font-mono text-[11.5px] tabular-nums outline-none hover:bg-[#fafafa] focus:border-[--zinc-border] focus:bg-background"
        />
        {unit && <span className="text-[9px] text-[#a3a3a3]">{unit}</span>}
      </span>
    </>
  );
}

/** Cell-sized segmented control. Always shows a selection — never grey-on-grey. */
export function CellSegmented<T extends string>({
  value,
  options,
  onChange,
  tiny,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  tiny?: boolean;
}) {
  const selected = options.some((o) => o.value === value) ? value : options[0]?.value;
  return (
    <div className="inline-flex rounded-sm border border-[--zinc-border] bg-background p-[2px]">
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "whitespace-nowrap rounded-[2px] font-mono transition-colors",
              tiny ? "px-[4px] py-[2px] text-[9px]" : "px-1.5 py-[2px] text-[10px]",
              active ? "bg-foreground font-medium text-background" : "text-[--hair-quiet] hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── replenishment parameters (__inv_params) ─────────────────────────── */

/** Policy type → the parameters it actually uses, in display order. */
export const POLICY_PARAMS: Record<string, Array<{ field: string; symbol: string }>> = {
  min_max: [
    { field: "reorder_point", symbol: "s" },
    { field: "order_up_to", symbol: "S" },
  ],
  base_stock: [{ field: "order_up_to", symbol: "S" }],
  rop: [
    { field: "rop_q_quantity", symbol: "Q" },
    { field: "reorder_point", symbol: "R" },
  ],
  periodic_review: [
    { field: "review_period_days", symbol: "T" },
    { field: "order_up_to", symbol: "S" },
  ],
};

export const POLICY_TYPE_OPTIONS = [
  { value: "min_max", label: "s,S", title: "Min-max (s, S)" },
  { value: "base_stock", label: "S", title: "Base stock (S)" },
  { value: "rop", label: "R,Q", title: "(R, Q)" },
  { value: "periodic_review", label: "T,S", title: "Periodic review (T, S)" },
] as const;

/**
 * The dynamic cell: only the parameters the current policy type uses.
 * `basis` is hidden unless it deviates from days_of_supply (or showBasis) —
 * it repeated identically on every line and read as noise.
 */
export function ReplenishmentCell({
  policyType,
  params,
  labelFor,
  basis,
  onBasisChange,
  showBasis,
  paramW,
}: {
  policyType: string;
  params: Array<{ field: string; value: number | undefined; onCommit: (v: number | undefined) => void; invalid?: string }>;
  labelFor: (field: string) => string;
  basis: "days_of_supply" | "forward_visible";
  onBasisChange: (b: "days_of_supply" | "forward_visible") => void;
  showBasis?: boolean;
  /** Value input width — the fit shrinks this (columnFit §1.2) when the cell
   *  itself has been compacted, so the cell's contents keep fitting its box. */
  paramW?: number;
}) {
  const spec = POLICY_PARAMS[policyType] ?? POLICY_PARAMS.min_max;
  const visibleBasis = showBasis || basis !== "days_of_supply";
  const w = paramW ?? 52;
  return (
    <div className="flex w-full items-center gap-[7px] overflow-hidden px-1">
      {spec.map(({ field, symbol }) => {
        const p = params.find((x) => x.field === field);
        return (
          <div key={field} className="flex shrink-0 items-center gap-[3px]">
            <span title={labelFor(field)} className="cursor-help font-mono text-[10px] font-medium text-muted-foreground">
              {symbol}
            </span>
            <input
              key={String(p?.value)}
              defaultValue={p?.value ?? ""}
              placeholder="—"
              size={1}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                p?.onCommit(raw === "" ? undefined : parseFloat(raw.replace(",", ".")));
              }}
              style={{ width: w, boxSizing: "border-box" }}
              className="h-5 rounded-sm border border-transparent bg-transparent px-1 text-right font-mono text-[11.5px] tabular-nums outline-none hover:bg-[#fafafa] focus:border-[--zinc-border] focus:bg-background"
            />
            {p?.invalid && (
              <span title={p.invalid} className="cursor-help font-mono text-[10px] font-medium" style={{ color: LAYER.brand }}>
                !
              </span>
            )}
          </div>
        );
      })}
      {visibleBasis && (
        <CellSegmented
          tiny
          value={basis}
          onChange={onBasisChange}
          options={[
            { value: "days_of_supply", label: "days_of_supply", title: "Policy Basis · days_of_supply" },
            { value: "forward_visible", label: "forward_visible", title: "Policy Basis · forward_visible" },
          ]}
        />
      )}
    </div>
  );
}

/* ── row flags ───────────────────────────────────────────────────────── */

export function RowFlag({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <span
      title={title}
      className="shrink-0 whitespace-nowrap rounded-sm px-1 font-mono text-[9px]"
      style={{ background: tint(LAYER.brand, 0.1), color: LAYER.brand }}
    >
      {children}
    </span>
  );
}

/** 2px left accent on the first frozen cell. */
export function rowAccent(opts: { edited: boolean; attention: boolean; multiSource: boolean }) {
  if (opts.edited) return "#111111";
  if (opts.attention) return LAYER.brand;
  if (opts.multiSource) return LAYER.process;
  return null;
}
