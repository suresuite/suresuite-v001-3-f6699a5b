import { useEffect, useMemo, useState } from "react";
import { PageLayout } from "@/components/shared/PageLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { PAGE_GUTTER_SKIN } from "@/components/shared/PageBody";
import {
  M,
  MobileChip,
  MobileGroup,
  MobileHeaderSearch,
  MobilePageHeader,
  MobilePanel,
  MobileRow,
  ProjectChip,
} from "@/components/mobile";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/intelligence/piUi";
import { useGlobalProject } from "@/hooks/useGlobalProject";
import { useProjects } from "@/hooks/useProjects";
import { usePolicies } from "@/hooks/usePolicies";
import { useProjectContext } from "@/hooks/useProjectContext";
import { useModelValidation } from "@/hooks/useModelValidation";
import { useStageGuards } from "@/hooks/useStageGuards";
import { useItemMasters } from "@/hooks/useItemMasters";
import { usePolicySearchIndex, type SearchObjectType, type SearchResult } from "@/hooks/usePolicySearchIndex";
import { useTimeUnit, DAYS_PER_UNIT, UNIT_LABEL_PLURAL } from "@/hooks/useTimeUnit";
import { FocusedStage } from "@/components/policies/FocusedStage";
import { GuidePanel } from "@/components/policies/GuidePanel";
import { VerifiableExportsSection } from "@/components/policies/VerifiableExportsSection";
import { DataMapGrid } from "@/components/policies/DataMapGrid";
import {
  PolicySetupBar,
  policyContextLine,
  type PlanningUnit,
} from "@/components/policies/PolicySetupBar";
import {
  formatVersionWhen,
  PolicyHistorySheet,
  SaveVersionDialog,
  versionDisplayName,
} from "@/components/policies/PolicyVersionSheets";
import type { StageKey } from "@/lib/policies/stages";

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (c: boolean) => void;
}

// v3 §3.1 — lens dot per object type; "policy" carries none.
const SEARCH_DOT: Partial<Record<SearchObjectType, string>> = {
  supplier: M.firm,
  customer: M.firm,
  plant: M.firm,
  material: M.product,
  product: M.product,
  lane: M.process,
};
const SEARCH_GROUP_LABEL: Record<SearchObjectType, string> = {
  supplier: "Suppliers",
  customer: "Customers",
  plant: "Plant",
  material: "Materials",
  product: "Products",
  lane: "Lanes",
  policy: "Policies",
};

/** §3.1: `background:#f0f0f0` on the matched run, `#171717` text — never
 *  `#F8D448` (readme §3.9's four uses, none of them this). */
function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <span style={{ background: "#f0f0f0", color: "#171717" }}>{text.slice(i, i + query.length)}</span>
      {text.slice(i + query.length)}
    </>
  );
}

/** Horizon + "Week 1 = …" calendar mapping, from the project's sim window. */
function useHorizon(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  unit: PlanningUnit,
) {
  return useMemo(() => {
    const s = startDate ? new Date(startDate) : null;
    const e = endDate ? new Date(endDate) : null;
    const valid = s && e && Number.isFinite(s.getTime()) && Number.isFinite(e.getTime()) && e > s;
    const days = valid ? Math.round((e!.getTime() - s!.getTime()) / 86_400_000) : null;
    const span = DAYS_PER_UNIT[unit];
    const horizon =
      days === null
        ? "not set"
        : unit === "day"
          ? `${days} days`
          : `${days} days · ${(days / span).toFixed(1)} ${UNIT_LABEL_PLURAL[unit]}`;

    let unitMap = "";
    if (s && Number.isFinite(s.getTime())) {
      const fmt = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const label = unit === "day" ? "Day" : unit === "week" ? "Week" : "Month";
      unitMap =
        unit === "day"
          ? `${label} 1 = ${fmt(s)}`
          : `${label} 1 = ${fmt(s)} → ${fmt(new Date(s.getTime() + (span - 1) * 86_400_000))} (${span} days each)`;
    }
    return { horizon, unitMap };
  }, [startDate, endDate, unit]);
}

export default function ProjectPolicies({ isCollapsed, setIsCollapsed }: Props) {
  const isMobile = useIsMobile();
  const {
    globalSelectedProjectId,
    setGlobalSelectedProjectId,
    selectedProject,
    setSelectedProject,
  } = useGlobalProject();
  const projectId = globalSelectedProjectId;
  const { projects } = useProjects();

  // The grid is the widest surface in the app — start with the rail collapsed
  // so the pointer starts near the lines.
  useEffect(() => {
    setIsCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep `selectedProject` in sync with the picker so downstream cards have full project meta.
  useEffect(() => {
    if (!projectId) return;
    const match = projects.find((p) => p.id === projectId);
    if (match && match.id !== selectedProject?.id) {
      setSelectedProject(match as any);
    }
  }, [projectId, projects, selectedProject?.id, setSelectedProject]);

  const {
    defaults,
    overrides,
    loading,
    fulfillmentStrategy,
    activePreset,
    presetAppliedAt,
    versions,
    isDirty,
    selectedVersionId,
    setSelectedVersionId,
    restoreVersion,
    saveDefault,
    applyResolvedPreset,
    clearActivePreset,
    bulkUpsertOverrides,
    deleteOverride,
    saveSnapshot,
    updateVersionNotes,
    deleteVersion,
    exportVersion,
  } = usePolicies(projectId);

  const { ctx, hasData } = useProjectContext({ projectId, fulfillmentStrategy });
  const { unit: storedUnit, setUnit } = useTimeUnit(projectId);
  // Unset behaves exactly like "day" — the engine stores days and adaptLabel
  // leaves labels alone — so the control always shows the effective unit.
  const unit: PlanningUnit = storedUnit ?? "day";
  const { horizon, unitMap } = useHorizon(
    selectedProject?.simulation_start,
    selectedProject?.simulation_end,
    unit,
  );

  const [tab, setTab] = useState<"stages" | "guide" | "datamap">("stages");
  const [activeStage, setActiveStage] = useState<StageKey>("supplier");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  // v3 §3.1 (gap-close T6): search the network, not the catalog.
  const [policyQuery, setPolicyQuery] = useState("");
  const [policyFilter, setPolicyFilter] = useState<SearchObjectType | "all">("all");

  // Stage 4 evidence: an adopted model card exists — the persisted proof that
  // replications ran and a warm-up was adopted (G13).
  const { cards } = useModelValidation(projectId);
  const { guards, rowsByStage } = useStageGuards({
    projectId,
    plantName: ctx?.plant_name,
    defaults,
    overrides,
    evidence: cards.length > 0,
  });
  const { materials, products, suppliers } = useItemMasters(projectId);
  const searchIndex = usePolicySearchIndex({
    rowsByStage,
    overrides,
    materials: materials.map((m) => ({ id: m.material_id, name: m.name })),
    products: products.map((p) => ({ id: p.product_id, name: p.name })),
    suppliers: suppliers.map((s) => ({ id: s.supplier_id, name: s.name })),
    plantName: ctx?.plant_name,
  });
  const policyQueryLower = policyQuery.trim().toLowerCase();
  // §6: "one query result produces the chip counts, the group headers and
  // the hidden-row lines" — searchMatches is that one result; every count
  // below reads from it, none are computed separately.
  const searchMatches = useMemo(
    () =>
      policyQueryLower
        ? searchIndex.filter(
            (r) =>
              r.name.toLowerCase().includes(policyQueryLower) ||
              (r.sub ?? "").toLowerCase().includes(policyQueryLower),
          )
        : [],
    [searchIndex, policyQueryLower],
  );
  const searchTypeCounts = useMemo(() => {
    const counts = new Map<SearchObjectType, number>();
    for (const r of searchMatches) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
    return counts;
  }, [searchMatches]);
  const filteredMatches =
    policyFilter === "all" ? searchMatches : searchMatches.filter((r) => r.type === policyFilter);
  // Groups ordered by how hard the query hits — most matches first, read
  // straight off searchMatches, the same one result the chips read.
  const groupedMatches = useMemo(() => {
    const groups = new Map<SearchObjectType, SearchResult[]>();
    for (const r of filteredMatches) {
      (groups.get(r.type) ?? groups.set(r.type, []).get(r.type)!).push(r);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filteredMatches]);
  const searching = policyQueryLower.length > 0;

  const openSearchResult = (result: SearchResult) => {
    if (result.targetStage) setActiveStage(result.targetStage);
    setTab("stages");
    setPolicyQuery("");
  };

  const currentVersion = versions.find((v) => v.id === selectedVersionId) ?? null;

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      {/* The chrome contract's root header (v3 §1.1) — D2: search takes the
          second row, not the three-view segmented (frame B1 wants search;
          the code had the segmented; both don't fit under the chip at
          320–375px, and §1.2's whole argument for search-in-header is that
          it never scrolls away). Guide and Data map demote to rows inside
          the body (the "Views" panel below) instead. Desktop keeps the
          shared <PageHeader> and its own segmented, untouched. */}
      {isMobile && (
        <MobilePageHeader variant="root" title="Policies">
          {/* Stacked, not shared on one line, matching the Simulation Lab
              root header — a chip beside search leaves too little room for
              either at 320-375px (same reasoning the segmented had). */}
          <div className="flex w-full flex-col gap-2.5">
            <ProjectChip
              projects={projects}
              selectedId={projectId}
              onSelect={(id) => setGlobalSelectedProjectId(id)}
            />
            <MobileHeaderSearch
              value={policyQuery}
              onChange={setPolicyQuery}
              placeholder="Search suppliers, materials, policies…"
            />
          </div>
        </MobilePageHeader>
      )}
      <div className={PAGE_GUTTER_SKIN}>
        {!isMobile && (
          <PageHeader
            title="Supply chain policies"
            subtitle={policyContextLine({
              plant: ctx?.plant_name || selectedProject?.plant_name || "—",
              model: selectedProject?.supply_chain_model || "—",
              bom: selectedProject?.bom_level || "—",
              suppliers: ctx?.supplier_count ?? 0,
              plants: ctx?.plant_count ?? 0,
              customers: ctx?.customer_count ?? 0,
              strategy: fulfillmentStrategy,
            })}
            rightContent={
              <>
                <Segmented<"stages" | "guide" | "datamap">
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "stages", label: "Policies" },
                    { value: "guide", label: "Guide" },
                    { value: "datamap", label: "Data map" },
                  ]}
                />
                <Select
                  value={projectId || ""}
                  onValueChange={(v) => setGlobalSelectedProjectId(v || null)}
                >
                  <SelectTrigger className="h-8 w-[210px] gap-1.5">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            }
          />
        )}

        {!projectId ? (
          <Alert>
            <AlertDescription>Select a project to configure policies.</AlertDescription>
          </Alert>
        ) : isMobile && searching ? (
          // v3 §3.1: the network, not the catalog — business objects
          // alongside policies, grouped by type, every object carrying a
          // real policy count. Tapping a result jumps to the stage that
          // governs it, where the existing (already-correct) grid shows the
          // full resolved detail — B2's bespoke object-detail sheet isn't
          // built here; see the commit message for why.
          <div className="flex flex-col gap-[var(--m-gap)]">
            {searchTypeCounts.size > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                  type="button"
                  onClick={() => setPolicyFilter("all")}
                  className={
                    policyFilter === "all"
                      ? "shrink-0 whitespace-nowrap rounded-full border border-[#18181b] bg-[#18181b] px-3 py-1.5 font-mono text-[11px] text-white"
                      : "shrink-0 whitespace-nowrap rounded-full border border-[#d4d4d4] bg-white px-3 py-1.5 font-mono text-[11px] text-[#3f3f46]"
                  }
                >
                  All {searchMatches.length}
                </button>
                {[...searchTypeCounts.entries()].map(([type, count]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPolicyFilter(type)}
                    className={
                      policyFilter === type
                        ? "shrink-0 whitespace-nowrap rounded-full border border-[#18181b] bg-[#18181b] px-3 py-1.5 font-mono text-[11px] text-white"
                        : "shrink-0 whitespace-nowrap rounded-full border border-[#d4d4d4] bg-white px-3 py-1.5 font-mono text-[11px] text-[#3f3f46]"
                    }
                  >
                    {SEARCH_GROUP_LABEL[type]} {count}
                  </button>
                ))}
              </div>
            )}

            {groupedMatches.length === 0 ? (
              <MobilePanel label="Search" counter="0">
                <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-[#525252]">
                  No matches for “{policyQuery}”.
                </p>
              </MobilePanel>
            ) : (
              groupedMatches.map(([type, results]) => (
                <MobileGroup key={type} label={`${SEARCH_GROUP_LABEL[type]} · ${results.length}`}>
                  <MobilePanel label={SEARCH_GROUP_LABEL[type]} counter={String(results.length)}>
                    {results.map((r) => (
                      <MobileRow
                        key={`${r.type}-${r.id}`}
                        dot={SEARCH_DOT[r.type]}
                        label={highlightMatch(r.name, policyQuery)}
                        sub={r.type === "policy" ? `param ${r.matchedField}` : r.sub}
                        trailing={
                          r.policyCount != null ? <MobileChip>{r.policyCount} pol</MobileChip> : undefined
                        }
                        onClick={() => openSearchResult(r)}
                      />
                    ))}
                  </MobilePanel>
                </MobileGroup>
              ))
            )}
          </div>
        ) : (
          <>
            {isMobile && (
              // D2: Guide and Data map demote to rows here, off the header's
              // second row (now search's).
              <MobilePanel label="Views">
                <MobileRow
                  label="Policies"
                  chevron={false}
                  dot={tab === "stages" ? M.ink : undefined}
                  onClick={() => setTab("stages")}
                />
                <MobileRow label="Guide" chevron onClick={() => setTab("guide")} />
                <MobileRow label="Data map" chevron onClick={() => setTab("datamap")} />
              </MobilePanel>
            )}
            {tab === "datamap" ? (
              <DataMapGrid projectId={projectId} />
            ) : tab === "guide" ? (
              <GuidePanel
                onJumpToStage={(s) => {
                  setActiveStage(s);
                  setTab("stages");
                }}
              />
            ) : (
          <>
            <PolicySetupBar
              versionName={
                currentVersion ? versionDisplayName(currentVersion) : "Current (live working copy)"
              }
              isSnapshot={!!currentVersion}
              versionStamp={
                currentVersion
                  ? `${formatVersionWhen(currentVersion.created_at)} · ${
                      currentVersion.author_name || currentVersion.author_email || "unknown"
                    }`
                  : undefined
              }
              versionCount={versions.length}
              dirty={isDirty}
              onSaveVersion={() => setSaveOpen(true)}
              onOpenHistory={() => setHistoryOpen(true)}
              unit={unit}
              onUnitChange={setUnit}
              horizon={horizon}
              unitMap={unitMap}
              stages={guards}
              activeStage={activeStage}
              onStageChange={setActiveStage}
            />

            <FocusedStage
              projectId={projectId}
              stageKey={activeStage}
              defaults={defaults}
              overrides={overrides}
              ctx={ctx}
              hasData={hasData}
              fulfillmentStrategy={fulfillmentStrategy}
              activePreset={activePreset}
              presetAppliedAt={presetAppliedAt}
              saveDefault={saveDefault}
              bulkUpsertOverrides={bulkUpsertOverrides}
              deleteOverride={deleteOverride}
              applyResolvedPreset={applyResolvedPreset}
              clearActivePreset={clearActivePreset}
              saveSnapshot={saveSnapshot}
              selectedVersionId={selectedVersionId}
              policyDirty={isDirty}
              rowsByStage={rowsByStage}
            />

            {loading && (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">loading policies…</p>
            )}
          </>
            )}
          </>
        )}

        <SaveVersionDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          current={currentVersion}
          onSave={saveSnapshot}
        />
        <PolicyHistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          versions={versions}
          selectedVersionId={selectedVersionId}
          onSelect={setSelectedVersionId}
          onRestore={restoreVersion}
          onExport={exportVersion}
          onDelete={deleteVersion}
          onUpdateNotes={updateVersionNotes}
          exportsSection={
            projectId ? (
              <VerifiableExportsSection
                projectId={projectId}
                projectName={selectedProject?.name ?? null}
              />
            ) : null
          }
        />
      </div>
    </PageLayout>
  );
}
