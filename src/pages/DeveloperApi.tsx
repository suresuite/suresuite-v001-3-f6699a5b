// @ts-nocheck — schema mismatch: uses the api-key RPCs from migration
// 20260711000001 which are not in the generated types yet. Remove once
// types are regenerated.
//
// Developer API page — API Phase 0 / G15 / §12 (developer experience).
// Self-service key management for the public /v1 gateway: create (show-once),
// list, rotate, revoke, per-key usage, and copy-paste quickstarts. Backed
// entirely by the SECURITY DEFINER RPCs (create/list/rotate/revoke_api_key);
// the plaintext secret exists only in this browser tab, once.
//
// ── SuReSuite redesign (2026-07) ────────────────────────────────────────────
// This page carries the SuReSuite visual language rather than raw shadcn
// defaults: one 4px corner radius, 1px --hair-border rules, JetBrains-mono
// UPPERCASE table headers + kicker labels, a black-pill active tab
// (bg-foreground text-background), teal/red status dots, a bespoke red-kicker
// "Key hygiene" card ABOVE the table, "Create API key" living in the
// Organization-keys card header (not the PageHeader), and a two-column notebook
// config panel with "Open example in Colab" + a brand-yellow
// "Download template (.ipynb)". Local class constants below hold the shared
// treatment so every table/card is consistent. All data flow, RPCs, hooks and
// interactive primitives (Button/Dialog/Select/Input/Checkbox) are unchanged.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/shared/PageLayout';
import { PageHeader } from '@/components/shared/PageHeader';
import { ApiCodeBlock, InlineCode, TableBlock, PAGE_GUTTER, PAGE_GUTTER_SKIN } from '@/components/shared';
import { MobileSheet } from '@/components/shared/MobileSheet';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useRowBudget } from '@/hooks/useViewport';
import {
  M,
  MobileActionBar,
  MobileButton,
  MobileButtonRow,
  MobileChip,
  MobileGroup,
  MobileNote,
  MobilePanel,
  MobileRow,
  MobileSegmented,
  MobileStatGrid,
} from '@/components/mobile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle, Check, Copy, Download, ExternalLink, KeyRound, Loader2,
  NotebookText, Plus, RefreshCcw, ShieldOff,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { FROZEN_CELL, FROZEN_CELL_ON_TINT } from '@/components/shared';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface ApiKeyRow {
  id: string;
  key_prefix: string;
  org_id: string;
  org_name: string;
  name: string;
  scopes: string[];
  project_ids: string[] | null;
  env: 'live' | 'test';
  status: 'active' | 'revoked';
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by_email: string | null;
}

interface UsageRow {
  api_key_id: string;
  requests_24h: number;
  requests_30d: number;
  errors_30d: number;
  last_request_at: string | null;
}

interface NbScenario {
  id: string;
  name: string;
  horizon_days: number;
  warmup_days: number;
  replications: number;
  seed: number;
  primary_kpi: string;
  created_at: string;
}

interface NbPolicyVersion {
  id: string;
  label: string | null;
  policy_hash: string | null;
  created_at: string;
  run_count: number;
}

interface NbDatasetVersion {
  id: string;
  label: string | null;
  graph_hash: string | null;
  created_at: string;
}

const db = supabase as any;
const SUPABASE_URL: string =
  (supabase as any).supabaseUrl ?? 'https://wckdrutwkytwcomrlpib.supabase.co';
const API_BASE = `${SUPABASE_URL}/functions/v1/api/v1`;

// Canonical quickstart notebook: committed in the repo (Colab opens it from
// GitHub) and shipped as a static asset (the download button patches its
// CONFIG cell with the selected project's ids).
const NOTEBOOK_ASSET_PATH = '/notebooks/suresuite_api_quickstart.ipynb';
const NOTEBOOK_COLAB_URL =
  'https://colab.research.google.com/github/suresuite/suresuite-v001-3-f6699a5b/blob/main/public/notebooks/suresuite_api_quickstart.ipynb';

// ── Shared SuReSuite treatment (sharp corners, thin borders, mono labels) ────
const SURFACE = 'rounded-sm border border-[--hair-border] bg-white';
const KX = 'font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground';
// L2 — the column row as an ink block. Mono/uppercase/11px/0.04em unchanged;
// the ground and label colour changed, and the bottom border is gone because
// the ink block ends where the data begins.
const TH = 'text-left font-mono text-[11px] uppercase tracking-[0.04em] font-medium text-white bg-[--brand-ink] border-r border-r-[rgba(255,255,255,0.22)] last:border-r-0 px-4 py-2 whitespace-nowrap';
const TD = 'px-4 py-[11px] border-b border-[--hair-divider] align-middle';
// Brand-yellow accent for the "download a template" action — flags a starter
// artifact without competing with the black primary used elsewhere.
const TEMPLATE_BTN =
  'bg-[#F8D448] text-foreground border border-[#e6c02f] shadow-sm hover:bg-[#f0c93a] active:bg-[#e9c22f]';

const SCOPES: { id: string; label: string; hint: string }[] = [
  { id: 'read:data', label: 'read:data', hint: 'List/read projects, item masters, dataset versions' },
  { id: 'write:data', label: 'write:data', hint: 'Freeze dataset versions' },
  { id: 'read:policies', label: 'read:policies', hint: 'Policy catalog, configs, saved versions' },
  { id: 'write:policies', label: 'write:policies', hint: 'Edit policies, snapshot policy versions' },
  { id: 'read:runs', label: 'read:runs', hint: 'Run status, KPIs, replications, validation' },
  { id: 'write:runs', label: 'write:runs', hint: 'Dispatch, cancel, extend simulation runs' },
  { id: 'admin:keys', label: 'admin:keys', hint: 'List/revoke keys over the API (rarely needed)' },
];

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never expires' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

const ENDPOINTS: [string, string, string][] = [
  ['GET /projects · GET /projects/{id}', 'read:data', 'List / read projects'],
  ['POST /projects/{id}/datasets:freeze', 'write:data', 'Freeze an immutable dataset version (graph_hash)'],
  ['GET /projects/{id}/dataset-versions', 'read:data', 'Dataset provenance history'],
  ['GET /projects/{id}/policy-catalog', 'read:policies', 'Engine policy catalog (registry export)'],
  ['GET · PUT /projects/{id}/policies', 'read/write:policies', 'Read / edit policy defaults & overrides'],
  ['GET · POST /projects/{id}/policy-versions', 'read/write:policies', 'List / snapshot immutable policy versions'],
  ['GET · POST /projects/{id}/scenarios', 'read/write:runs', 'List / create scenarios'],
  ['POST /projects/{id}/runs', 'write:runs', 'Dispatch a run (Idempotency-Key supported)'],
  ['GET /runs/{id} · /replications · /validation', 'read:runs', 'Status, KPIs, per-rep rows, credibility badge'],
  ['POST /runs/{id}:cancel · :add-reps', 'write:runs', 'Cancel or extend an in-flight run'],
  ['GET /keys · POST /keys/{id}:revoke', 'admin:keys', 'Key inventory / kill switch over the API'],
];

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label && <span className="ml-1.5">{label}</span>}
    </Button>
  );
}

function IdCell({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy id"
      className="group inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {value}
      {copied
        ? <Check className="h-3 w-3 shrink-0" />
        : <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />}
    </button>
  );
}

export default function DeveloperApi({ isCollapsed, setIsCollapsed }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [usage, setUsage] = useState<Record<string, UsageRow>>({});
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // create-dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [env, setEnv] = useState<'live' | 'test'>('test');
  const [scopes, setScopes] = useState<string[]>(['read:data', 'read:runs']);
  const [allProjects, setAllProjects] = useState(true);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('never');

  // show-once state
  const [mintedKey, setMintedKey] = useState<{ plaintext: string; name: string } | null>(null);

  // rotate / revoke targets
  const [rotateTarget, setRotateTarget] = useState<ApiKeyRow | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [mutating, setMutating] = useState(false);

  // notebook tab: selected project + the ids the notebook's CONFIG cell needs
  const [nbProjectId, setNbProjectId] = useState('');
  const [nbLoading, setNbLoading] = useState(false);
  const [nbDownloading, setNbDownloading] = useState(false);
  const [nbScenarios, setNbScenarios] = useState<NbScenario[]>([]);
  const [nbPolicyVersions, setNbPolicyVersions] = useState<NbPolicyVersion[]>([]);
  const [nbDatasetVersions, setNbDatasetVersions] = useState<NbDatasetVersion[]>([]);

  const rpcAuth = useMemo(
    () => ({ p_user_id: user?.id, p_user_email: user?.email }),
    [user?.id, user?.email],
  );

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [keysRes, usageRes, projectsRes] = await Promise.all([
      db.rpc('list_api_keys', rpcAuth),
      db.rpc('api_key_usage', rpcAuth),
      db.rpc('list_projects', rpcAuth),
    ]);
    if (keysRes.error) {
      // 'forbidden' = a plain user account; anything else is a real failure.
      const msg = String(keysRes.error.message ?? '');
      toast({
        title: msg.includes('forbidden')
          ? 'Your account cannot manage API keys'
          : 'Could not load API keys',
        description: msg.includes('forbidden')
          ? 'Ask an admin or modeler in your organization to create a key for you.'
          : msg,
        variant: 'destructive',
      });
      setKeys([]);
    } else {
      setKeys((keysRes.data ?? []) as ApiKeyRow[]);
    }
    setUsage(
      Object.fromEntries(((usageRes.data ?? []) as UsageRow[]).map((u) => [u.api_key_id, u])),
    );
    setProjects(
      ((projectsRes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name })),
    );
    setLoading(false);
  }, [user?.id, rpcAuth, toast]);

  useEffect(() => { load(); }, [load]);

  // Load the selected project's ids for the notebook config panel — the same
  // reads the app's own pages use (scenarios table + list_* RPCs), so what the
  // panel shows is exactly what the API will accept.
  useEffect(() => {
    if (!nbProjectId) {
      setNbScenarios([]);
      setNbPolicyVersions([]);
      setNbDatasetVersions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setNbLoading(true);
      const [sc, pv, dv] = await Promise.all([
        db.from('scenarios')
          .select('id,name,horizon_days,warmup_days,replications,seed,primary_kpi,created_at')
          .eq('project_id', nbProjectId)
          .order('created_at', { ascending: false }),
        db.rpc('list_policy_versions', { p_project_id: nbProjectId }),
        db.rpc('list_dataset_versions', { p_project_id: nbProjectId }),
      ]);
      if (cancelled) return;
      setNbScenarios((sc.data ?? []) as NbScenario[]);
      setNbPolicyVersions((pv.data ?? []) as NbPolicyVersion[]);
      setNbDatasetVersions((dv.data ?? []) as NbDatasetVersion[]);
      setNbLoading(false);
    })();
    return () => { cancelled = true; };
  }, [nbProjectId]);

  const nbProject = projects.find((p) => p.id === nbProjectId) ?? null;
  const nbScenario = nbScenarios[0] ?? null;
  const nbPolicyVersion = nbPolicyVersions[0] ?? null;

  // Mirrors the notebook's CONFIG cell exactly (same "# ── CONFIG" marker the
  // download patcher and the .ipynb template share).
  const nbConfigCell = useMemo(() => {
    if (!nbProject) return '';
    return [
      '# ── CONFIG ──────────────────────────────────────────────────────────────────',
      `# Filled from /developer → Notebook for project “${nbProject.name}”.`,
      `BASE_URL = "${API_BASE}"`,
      `PROJECT_ID = "${nbProject.id}"`,
      nbScenario
        ? `SCENARIO_ID = "${nbScenario.id}"  # ${nbScenario.name}`
        : 'SCENARIO_ID = ""         # no scenarios yet — §6 of the notebook creates one',
      nbPolicyVersion
        ? `POLICY_VERSION_ID = "${nbPolicyVersion.id}"  # ${nbPolicyVersion.label ?? 'unlabelled'}`
        : 'POLICY_VERSION_ID = ""   # no snapshots yet — §5 of the notebook makes one',
    ].join('\n');
  }, [nbProject, nbScenario, nbPolicyVersion]);

  const downloadNotebook = async () => {
    setNbDownloading(true);
    try {
      const res = await fetch(NOTEBOOK_ASSET_PATH);
      if (!res.ok) throw new Error(`could not load notebook template (${res.status})`);
      const nb = await res.json();
      if (nbConfigCell) {
        const idx = (nb.cells ?? []).findIndex((c: { cell_type: string; source: string | string[] }) =>
          c.cell_type === 'code' &&
          (Array.isArray(c.source) ? c.source.join('') : String(c.source)).startsWith('# ── CONFIG'));
        if (idx >= 0) {
          const lines = nbConfigCell.split('\n');
          nb.cells[idx].source = lines.map((l, i) => (i < lines.length - 1 ? `${l}\n` : l));
        }
      }
      const slug = nbProject
        ? `_${nbProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
        : '';
      const blob = new Blob([JSON.stringify(nb, null, 1)], { type: 'application/x-ipynb+json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `suresuite_api_quickstart${slug}.ipynb`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast({
        title: 'Notebook download failed',
        description: String((e as Error)?.message ?? e),
        variant: 'destructive',
      });
    } finally {
      setNbDownloading(false);
    }
  };

  const resetCreateForm = () => {
    setName('');
    setEnv('test');
    setScopes(['read:data', 'read:runs']);
    setAllProjects(true);
    setProjectIds([]);
    setExpiry('never');
  };

  const onCreate = async () => {
    if (!scopes.length) {
      toast({ title: 'Pick at least one scope', variant: 'destructive' });
      return;
    }
    setCreating(true);
    const expiresAt = expiry === 'never'
      ? null
      : new Date(Date.now() + Number(expiry) * 86400_000).toISOString();
    const { data, error } = await db.rpc('create_api_key', {
      ...rpcAuth,
      p_name: name || 'API key',
      p_scopes: scopes,
      p_env: env,
      p_project_ids: allProjects || projectIds.length === 0 ? null : projectIds,
      p_expires_at: expiresAt,
    });
    setCreating(false);
    if (error) {
      toast({ title: 'Could not create key', description: error.message, variant: 'destructive' });
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setCreateOpen(false);
    resetCreateForm();
    setMintedKey({ plaintext: row.plaintext_key, name: name || 'API key' });
    load();
  };

  const onRotate = async () => {
    if (!rotateTarget) return;
    setMutating(true);
    const { data, error } = await db.rpc('rotate_api_key', {
      ...rpcAuth,
      p_key_id: rotateTarget.id,
      p_overlap_hours: 72,
    });
    setMutating(false);
    setRotateTarget(null);
    if (error) {
      toast({ title: 'Could not rotate key', description: error.message, variant: 'destructive' });
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setMintedKey({ plaintext: row.plaintext_key, name: `${rotateTarget.name} (rotated)` });
    load();
  };

  const onRevoke = async () => {
    if (!revokeTarget) return;
    setMutating(true);
    const { error } = await db.rpc('revoke_api_key', { ...rpcAuth, p_key_id: revokeTarget.id });
    setMutating(false);
    setRevokeTarget(null);
    if (error) {
      toast({ title: 'Could not revoke key', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Key revoked', description: 'It stops working on the next request.' });
    load();
  };

  // active | expired | revoked → dot color + label, matching the prototype.
  /* ── the phone tree (v2 §4B) ─────────────────────────────────────────────
     WHY A BRANCH. Below 768px this page is three ledgers, a nine-column key
     table and a two-column notebook layout. §10 says a dense table
     summarises with the ledger deferred, and §9.5 forbids sideways scroll
     outside a deliberate table sheet — so each ledger becomes a panel of rows
     whose sub-line carries the columns the row cannot show, and the full
     record is one tap away in a sheet with every column intact.

     NOTHING IS REMOVED. Rotate and revoke keep their own rows rather than
     hiding behind two 14px icons; the create dialog is the same dialog; the
     `#F8D448` template download keeps its "begin here" fill, which is the one
     place in the skin that colour is allowed (§3). */
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<'keys' | 'quickstart' | 'notebook'>('keys');
  const [openKeyId, setOpenKeyId] = useState<string | null>(null);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const endpointBudget = useRowBudget(4, 6, 9);

  const keyStatus = (k: ApiKeyRow): { label: string; dot: string; text: string } => {
    if (k.status === 'revoked') return { label: 'revoked', dot: '#bf2330', text: 'text-[#bf2330]' };
    if (k.expires_at && new Date(k.expires_at).getTime() < Date.now()) {
      return { label: 'expired', dot: '#a3a3a3', text: 'text-muted-foreground' };
    }
    return { label: 'active', dot: '#14b8c4', text: 'text-foreground' };
  };

  const activeCount = keys.filter((k) => keyStatus(k).label === 'active').length;

  const exampleKey = 'sk_live_1a2b3c4d_…your-key…';
  const curlList = `curl -s ${API_BASE}/projects \\
  -H "Authorization: Bearer ${exampleKey}"`;
  const curlRun = `curl -s -X POST ${API_BASE}/projects/PROJECT_ID/runs \\
  -H "Authorization: Bearer ${exampleKey}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: my-run-2026-07-11" \\
  -d '{"scenario_id":"SCENARIO_ID","policy_version_id":"POLICY_VERSION_ID"}'`;
  const curlPoll = `curl -s ${API_BASE}/runs/RUN_ID \\
  -H "Authorization: Bearer ${exampleKey}"`;
  const pythonSnippet = `import os, time, requests

BASE = "${API_BASE}"
HEADERS = {"Authorization": f"Bearer {os.environ['SURESUITE_API_KEY']}"}

# 1. pick a project
projects = requests.get(f"{BASE}/projects", headers=HEADERS).json()["data"]
project_id = projects[0]["id"]

# 2. snapshot the current policy configuration
version = requests.post(
    f"{BASE}/projects/{project_id}/policy-versions",
    headers=HEADERS, json={"label": "api run"},
).json()

# 3. dispatch a run against an existing scenario
scenarios = requests.get(f"{BASE}/projects/{project_id}/scenarios", headers=HEADERS).json()["data"]
run = requests.post(
    f"{BASE}/projects/{project_id}/runs",
    headers={**HEADERS, "Idempotency-Key": "notebook-demo-1"},
    json={"scenario_id": scenarios[0]["id"], "policy_version_id": version["id"]},
).json()

# 4. poll until finished, then read replications
while True:
    r = requests.get(f"{BASE}/runs/{run['run_id']}", headers=HEADERS).json()
    if r["status"] in ("succeeded", "failed", "cancelled"):
        break
    time.sleep(5)
reps = requests.get(f"{BASE}/runs/{run['run_id']}/replications", headers=HEADERS).json()["data"]
print(r["aggregate_kpis"], len(reps))`;
  const shortageSnippet = `import os, time, requests

BASE = "${API_BASE}"
HEADERS = {"Authorization": f"Bearer {os.environ['SURESUITE_API_KEY']}"}

def run_and_wait(project_id, scenario_id, policy_version_id, idem):
    submitted = requests.post(
        f"{BASE}/projects/{project_id}/runs", headers={**HEADERS, "Idempotency-Key": idem},
        json={"scenario_id": scenario_id, "policy_version_id": policy_version_id},
    ).json()
    run_id = submitted["run_id"]
    while True:
        run = requests.get(f"{BASE}/runs/{run_id}", headers=HEADERS).json()
        if run["status"] in ("succeeded", "failed", "cancelled"):
            return run
        time.sleep(5)

# 1. resolve "Project AA" and its "Version 3" policy snapshot by name
projects = requests.get(f"{BASE}/projects", headers=HEADERS).json()["data"]
project = next(p for p in projects if p["name"].strip().lower() == "project aa")
versions = requests.get(f"{BASE}/projects/{project['id']}/policy-versions", headers=HEADERS).json()["data"]
version_3 = next(v for v in versions if (v.get("label") or "").strip().lower() == "version 3")

# 2. baseline scenario (no disruption)
baseline = requests.post(
    f"{BASE}/projects/{project['id']}/scenarios", headers=HEADERS,
    json={"name": "Material shortage — baseline", "horizon_days": 120, "warmup_days": 14,
          "replications": 20, "seed": 42, "crn": True, "primary_kpi": "fill_rate"},
).json()
run_baseline = run_and_wait(project["id"], baseline["id"], version_3["id"], "shortage-baseline")

# 3. shortage scenario — cut a material/supplier's capacity for 3 weeks
shortage = requests.post(
    f"{BASE}/projects/{project['id']}/scenarios", headers=HEADERS,
    json={"name": "Material shortage — RM-2201 cut", "horizon_days": 120, "warmup_days": 14,
          "replications": 20, "seed": 42, "crn": True, "primary_kpi": "fill_rate",
          "disruption_schedule": [{"target": "RM-2201", "target_type": "material",
                                   "start_day": 30, "duration_days": 21, "magnitude_pct": 60}]},
).json()
run_shortage = run_and_wait(project["id"], shortage["id"], version_3["id"], "shortage-cut")

# 4. shortage evidence — driven by policy P-C.1 unmet_demand_handling
for kpi in ("fill_rate", "lost_sales_value", "max_backlog", "service_loss_area", "ttr_weeks"):
    a, b = run_baseline["aggregate_kpis"].get(kpi), run_shortage["aggregate_kpis"].get(kpi)
    print(f"{kpi:20s} baseline={a}  shortage={b}")`;

  // The three dialogs are the REAL editors and both chromes mount them
  // unchanged (§8). Below `md` they take the touch floor on every control;
  // nothing else about them moves.
  const dialogs = (
    <>
    {/* ── Create key dialog ─────────────────────────────────────────────── */}
    <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}>
      <DialogContent className="max-w-lg rounded-sm">
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>
            The key is scoped to your organization. You'll see the secret once, right after creation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              className="rounded-sm"
              placeholder="e.g. CI pipeline, analyst notebook"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <Select value={env} onValueChange={(v) => setEnv(v as 'live' | 'test')}>
              <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="test">test — stricter limits, 1 concurrent run (recommended to start)</SelectItem>
                <SelectItem value="live">live — production traffic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Scopes (least privilege: pick only what the caller needs)</Label>
            <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto rounded-sm border border-[--hair-border] p-3">
              {SCOPES.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-start gap-2 text-sm">
                  <Checkbox
                    checked={scopes.includes(s.id)}
                    onCheckedChange={(c) =>
                      setScopes((prev) => (c ? [...prev, s.id] : prev.filter((x) => x !== s.id)))}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-xs">{s.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Project access</Label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={allProjects} onCheckedChange={(c) => setAllProjects(!!c)} />
              All projects in my organization
            </label>
            {!allProjects && (
              <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-sm border border-[--hair-border] p-3">
                {projects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No projects found.</p>
                ) : (
                  projects.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={projectIds.includes(p.id)}
                        onCheckedChange={(c) =>
                          setProjectIds((prev) => (c ? [...prev, p.id] : prev.filter((x) => x !== p.id)))}
                      />
                      {p.name}
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Expiry</Label>
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button className="rounded-sm" onClick={onCreate} disabled={creating}>
            {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Create key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Show-once secret dialog ───────────────────────────────────────── */}
    <Dialog open={!!mintedKey} onOpenChange={(o) => { if (!o) setMintedKey(null); }}>
      <DialogContent className="max-w-lg rounded-sm">
        <DialogHeader>
          <DialogTitle>Copy your API key now</DialogTitle>
          <DialogDescription>
            This is the only time the secret for “{mintedKey?.name}” is shown. Only a hash is
            stored — if you lose it, rotate the key to get a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <InlineCode className="flex-1 break-all rounded-sm border-[--hair-border] px-3 py-2 text-xs">
            {mintedKey?.plaintext}
          </InlineCode>
          <CopyButton text={mintedKey?.plaintext ?? ''} />
        </div>
        <div className={`${SURFACE} flex gap-3 px-4 py-3`}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#bf2330]" />
          <div className="text-xs leading-[1.5] text-[#525252]">
            Store it in a secret manager or environment variable (e.g.{' '}
            <span className="font-mono">SURESUITE_API_KEY</span>). Never commit it to source control.
          </div>
        </div>
        <DialogFooter>
          <Button className="rounded-sm" onClick={() => setMintedKey(null)}>I've stored it safely</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Rotate confirm ────────────────────────────────────────────────── */}
    <Dialog open={!!rotateTarget} onOpenChange={(o) => { if (!o) setRotateTarget(null); }}>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle>Rotate “{rotateTarget?.name}”?</DialogTitle>
          <DialogDescription>
            A new secret is minted and shown once. The current secret keeps working for a 72-hour
            overlap so you can roll it out, then stops automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => setRotateTarget(null)}>Cancel</Button>
          <Button className="rounded-sm" onClick={onRotate} disabled={mutating}>
            {mutating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Rotate key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Revoke confirm ────────────────────────────────────────────────── */}
    <Dialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
      <DialogContent className="rounded-sm">
        <DialogHeader>
          <DialogTitle>Revoke “{revokeTarget?.name}”?</DialogTitle>
          <DialogDescription>
            This is immediate and cannot be undone — the key stops working on its next request.
            Any system still using it will start getting 401s.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="rounded-sm" onClick={() => setRevokeTarget(null)}>Cancel</Button>
          <Button variant="destructive" className="rounded-sm" onClick={onRevoke} disabled={mutating}>
            {mutating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Revoke key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
  const openKey = keys.find((k) => k.id === openKeyId) ?? null;

  const mobileKeys = (
    <>
      <MobileGroup>
        {/* §13.3 — the thing that needs attention, and the screen's one ink
            head: a key is a credential and hygiene is what goes wrong. */}
        <MobilePanel tone="primary" label="Key hygiene" counter="read first">
          <p className="px-3 py-3 text-[12.5px] leading-[1.55] text-[#3f3f46] [text-wrap:pretty]">
            Store keys in a secret manager, never in source control. Start on{' '}
            <span className="font-mono">test</span> keys, give each system its own key with the
            narrowest scopes that work — a leaked key is one click to revoke.
          </p>
        </MobilePanel>
      </MobileGroup>

      <MobileGroup label="Organization keys">
        {keys.length > 0 && (
          <MobileStatGrid
            stats={[
              { label: 'Keys', value: String(keys.length) },
              {
                label: 'Active',
                value: String(activeCount),
                dot: activeCount > 0 ? M.process : M.idle,
              },
              {
                label: 'Req 30d',
                value: Object.values(usage)
                  .reduce((n, u) => n + Number(u.requests_30d ?? 0), 0)
                  .toLocaleString(),
              },
            ]}
          />
        )}

        <MobilePanel label="Keys" counter={`${activeCount} / ${keys.length} active`}>
          {loading ? (
            <p className="px-3 py-8 text-center text-[13px] text-[#525252]">Loading…</p>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-9 text-center">
              <span className="max-w-[250px] text-[13px] leading-relaxed text-[#525252] [text-wrap:pretty]">
                No API keys yet. Create one to call the API from scripts, notebooks or CI — the
                secret is shown once.
              </span>
            </div>
          ) : (
            keys.map((k) => {
              const st = keyStatus(k);
              const u = usage[k.id];
              return (
                <MobileRow
                  key={k.id}
                  dot={st.dot}
                  label={k.name}
                  sub={`sk_${k.env}_${k.key_prefix}_•••• · ${st.label} · ${
                    k.project_ids ? `${k.project_ids.length} projects` : 'all projects'
                  }`}
                  value={u ? Number(u.requests_30d).toLocaleString() : '0'}
                  onClick={() => setOpenKeyId(k.id)}
                />
              );
            })
          )}
        </MobilePanel>
      </MobileGroup>

      {/* The full record — every column the nine-column ledger has, plus the
          two actions that were icon-only on desktop. */}
      <MobileSheet
        open={openKey != null}
        title={openKey?.name ?? ''}
        sub="The whole record, and everything you can do to this key."
        onClose={() => setOpenKeyId(null)}
      >
        {openKey && (
          <div className="flex flex-col">
            <MobileRow chevron={false} label="Key" sub={`sk_${openKey.env}_${openKey.key_prefix}_••••`} />
            <MobileRow chevron={false} label="Environment" value={openKey.env} />
            <MobileRow
              chevron={false}
              dot={keyStatus(openKey).dot}
              label="Status"
              value={keyStatus(openKey).label}
            />
            <MobileRow
              chevron={false}
              label="Scopes"
              sub={openKey.scopes.join(' · ')}
              value={String(openKey.scopes.length)}
            />
            <MobileRow
              chevron={false}
              label="Projects"
              value={openKey.project_ids ? `${openKey.project_ids.length} selected` : 'All'}
            />
            <MobileRow
              chevron={false}
              label="Requests 30d"
              sub={
                usage[openKey.id]?.errors_30d
                  ? `${usage[openKey.id].errors_30d} errors`
                  : undefined
              }
              value={
                usage[openKey.id] ? Number(usage[openKey.id].requests_30d).toLocaleString() : '0'
              }
            />
            <MobileRow
              chevron={false}
              label="Last used"
              value={openKey.last_used_at ? new Date(openKey.last_used_at).toLocaleDateString() : 'never'}
            />
            <div className="p-3">
              <MobileButtonRow>
                <MobileButton
                  weight="secondary"
                  disabled={openKey.status !== 'active'}
                  title="Rotate: mints a new secret; the old one keeps working for 72 h"
                  onClick={() => {
                    setRotateTarget(openKey);
                    setOpenKeyId(null);
                  }}
                >
                  Rotate
                </MobileButton>
                <MobileButton
                  weight="secondary"
                  disabled={openKey.status !== 'active'}
                  title="Revoke immediately"
                  onClick={() => {
                    setRevokeTarget(openKey);
                    setOpenKeyId(null);
                  }}
                >
                  Revoke
                </MobileButton>
              </MobileButtonRow>
              {openKey.status !== 'active' && (
                <p className="mt-1.5 text-[12px] leading-[1.4] text-[#525252] [text-wrap:pretty]">
                  This key is {keyStatus(openKey).label} — there is nothing left to rotate or revoke.
                </p>
              )}
            </div>
          </div>
        )}
      </MobileSheet>
    </>
  );

  const mobileQuickstart = (
    <>
      <MobileGroup label="Base URL">
        <MobilePanel label="Gateway" counter="/v1">
          <MobileRow
            chevron={false}
            label={API_BASE}
            sub="Authorization: Bearer sk_…"
            className="[&_span]:[word-break:break-all]"
          />
          <div className="p-3">
            <MobileButton weight="secondary" block onClick={() => navigator.clipboard?.writeText(API_BASE)}>
              Copy base URL
            </MobileButton>
          </div>
          <p className="px-3 py-3 text-[12.5px] leading-[1.5] text-[#3f3f46] [text-wrap:pretty]">
            All endpoints are versioned under <span className="font-mono">/v1</span>. Errors use a
            consistent <span className="font-mono">{'{"error":{"code","message"}}'}</span> envelope;
            rate-limit state is returned in <span className="font-mono">X-RateLimit-*</span> headers.
          </p>
        </MobilePanel>
      </MobileGroup>

      {/* A code block is one of the two places §9.5 allows sideways scroll. */}
      <MobileGroup label="Calls">
        <ApiCodeBlock title="List your projects" code={curlList} />
        <ApiCodeBlock title="Dispatch a run (202 → run_id)" code={curlRun} />
        <ApiCodeBlock title="Poll a run until it finishes" code={curlPoll} />
        <ApiCodeBlock title="Python: end-to-end" code={pythonSnippet} />
        <ApiCodeBlock title="Python: material shortage — Project AA, Version 3" code={shortageSnippet} />
      </MobileGroup>

      <MobileGroup label="Reference">
        <MobilePanel label="Endpoints · v1" counter={`${ENDPOINTS.length}`}>
          {ENDPOINTS.slice(0, endpointBudget).map(([ep, scope, what]) => (
            <MobileRow key={ep} chevron={false} label={ep} sub={`${scope} · ${what}`} />
          ))}
          {ENDPOINTS.length > endpointBudget && (
            <MobileRow
              label={`All ${ENDPOINTS.length} endpoints`}
              sub={`${ENDPOINTS.length - endpointBudget} more`}
              onClick={() => setEndpointsOpen(true)}
            />
          )}
          <p className="px-3 py-3 text-[12px] leading-[1.45] text-[#525252]">
            Full reference: <span className="font-mono">docs/api/README.md</span> in the repository.
          </p>
        </MobilePanel>
      </MobileGroup>

      <MobileSheet
        open={endpointsOpen}
        title="Endpoints · v1"
        sub="Every endpoint, its scope and what it does."
        onClose={() => setEndpointsOpen(false)}
      >
        <div className="flex flex-col">
          {ENDPOINTS.map(([ep, scope, what]) => (
            <MobileRow key={ep} chevron={false} label={ep} sub={`${scope} · ${what}`} />
          ))}
        </div>
      </MobileSheet>
    </>
  );

  const mobileNotebook = (
    <>
      <MobileGroup label="Template">
        <MobilePanel label="Ready-to-run quickstart" counter="§1–13">
          <p className="px-3 py-3 text-[12.5px] leading-[1.55] text-[#3f3f46] [text-wrap:pretty]">
            §1–12 cover the full API surface; §13 is a worked material-shortage deep dive — pick
            your project below, then edit its <span className="font-mono">SHORTAGE_TARGET</span> to
            a real material or supplier key.
          </p>
          <div className="p-3">
            <MobileButtonRow>
              <MobileButton
                weight="secondary"
                onClick={() => window.open(NOTEBOOK_COLAB_URL, '_blank', 'noreferrer')}
              >
                Open in Colab
              </MobileButton>
              {/* "Begin here" — the one #F8D448 the skin allows, and the
                  template download is exactly what it is reserved for (§3). */}
              <MobileButton weight="begin" onClick={downloadNotebook} disabled={nbDownloading}>
                {nbDownloading ? 'Preparing…' : 'Download template'}
              </MobileButton>
            </MobileButtonRow>
          </div>
        </MobilePanel>
      </MobileGroup>

      <MobileGroup label="Project">
        <MobilePanel label="Notebook project" counter={nbProject ? '1' : 'none'}>
          <MobileRow
            chevron={false}
            label="Project"
            trailing={
              <select
                className="h-11 min-w-0 max-w-[52vw] shrink rounded-[6px] border border-[#d4d4d4] bg-white px-2 text-[length:var(--fs-row)] text-[#171717] focus:border-[#18181b] focus:outline-none"
                value={nbProjectId}
                onChange={(e) => setNbProjectId(e.target.value)}
                aria-label="Notebook project"
              >
                <option value="">
                  {projects.length ? 'Select a project…' : 'No projects available'}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            }
          />
          {nbProject && (
            <MobileRow chevron={false} label="Project ID" sub={nbProject.id} />
          )}
        </MobilePanel>

        <ApiCodeBlock
          title="Notebook CONFIG cell (pre-filled)"
          code={nbConfigCell || '# Select a project to fill in BASE_URL, PROJECT_ID, SCENARIO_ID, POLICY_VERSION_ID'}
        />
      </MobileGroup>

      {nbProject && !nbLoading && (
        <MobileGroup label="Ids the notebook needs">
          <MobilePanel label="Scenarios · SCENARIO_ID" counter={`${nbScenarios.length}`}>
            {nbScenarios.length === 0 ? (
              <p className="px-3 py-3 text-[12.5px] leading-[1.45] text-[#525252]">
                None yet — §6 of the notebook creates one via{' '}
                <span className="font-mono">POST …/scenarios</span>.
              </p>
            ) : (
              nbScenarios.map((sc) => (
                <MobileRow
                  key={sc.id}
                  chevron={false}
                  label={sc.name}
                  sub={`${sc.id} · ${sc.horizon_days} d (+${sc.warmup_days}) · ${sc.replications} reps · ${sc.primary_kpi}`}
                />
              ))
            )}
          </MobilePanel>

          <MobilePanel label="Policy versions · POLICY_VERSION_ID" counter={`${nbPolicyVersions.length}`}>
            {nbPolicyVersions.length === 0 ? (
              <p className="px-3 py-3 text-[12.5px] leading-[1.45] text-[#525252]">
                None yet — §5 of the notebook snapshots one via{' '}
                <span className="font-mono">POST …/policy-versions</span>.
              </p>
            ) : (
              nbPolicyVersions.map((v) => (
                <MobileRow
                  key={v.id}
                  chevron={false}
                  label={v.label ?? 'unlabelled'}
                  sub={`${v.id} · policy ${(v.policy_hash ?? '').slice(0, 12)}… · ${new Date(v.created_at).toLocaleDateString()}`}
                  value={String(v.run_count)}
                />
              ))
            )}
          </MobilePanel>

          <MobilePanel label="Dataset versions · provenance" counter={`${nbDatasetVersions.length}`}>
            {nbDatasetVersions.length === 0 ? (
              <p className="px-3 py-3 text-[12.5px] leading-[1.45] text-[#525252]">
                None yet — §2 of the notebook freezes one via{' '}
                <span className="font-mono">POST …/datasets:freeze</span>.
              </p>
            ) : (
              nbDatasetVersions.map((v) => (
                <MobileRow
                  key={v.id}
                  chevron={false}
                  label={v.label ?? 'unlabelled'}
                  sub={`${v.id} · graph ${(v.graph_hash ?? '').slice(0, 12)}… · ${new Date(v.created_at).toLocaleDateString()}`}
                />
              ))
            )}
          </MobilePanel>
        </MobileGroup>
      )}

      {nbLoading && (
        <MobilePanel label="Ids the notebook needs">
          <p className="px-3 py-8 text-center text-[13px] text-[#525252]">Loading…</p>
        </MobilePanel>
      )}

      {/* §13.6 — one consequence line, and this is the one that matters. */}
      <MobileNote>
        Never paste your API key into a notebook cell. In Colab store it once in the Secrets panel
        as <span className="font-mono">SURESUITE_API_KEY</span>.
      </MobileNote>
    </>
  );

  if (isMobile) {
    return (
      <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
        <div className={PAGE_GUTTER_SKIN}>
          <PageHeader
            skin
            title="Developer API"
            subtitle="Drive SureSuite programmatically — API keys, scopes, and quickstarts for the /v1 gateway"
            onRefresh={load}
            refreshLoading={loading}
          />

          {/* Three peer views — exactly what §4 reserves the segmented control
              for. Same three tabs, same names, same order as the desktop
              TabsList. */}
          <MobileSegmented
            ariaLabel="Developer API views"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'keys', label: 'API keys', count: keys.length || undefined },
              { value: 'quickstart', label: 'Quickstart' },
              { value: 'notebook', label: 'Notebook' },
            ]}
          />

          <div className="mt-[var(--m-gap)] flex flex-col gap-[var(--m-gap)]">
            {tab === 'keys' ? mobileKeys : tab === 'quickstart' ? mobileQuickstart : mobileNotebook}
          </div>

          {tab === 'keys' && (
            <MobileActionBar primary={{ label: 'Create API key', onClick: () => setCreateOpen(true) }} />
          )}
        </div>
        {dialogs}
      </PageLayout>
    );
  }

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className={PAGE_GUTTER}>
        <PageHeader
          title="Developer API"
          subtitle="Drive SureSuite programmatically — API keys, scopes, and quickstarts for the /v1 gateway"
          onRefresh={load}
          refreshLoading={loading}
        />

        <Tabs defaultValue="keys" className="space-y-4">
          {/* Black-pill active tab (bg-foreground text-background), sharp corners */}
          <TabsList className="inline-flex h-auto items-center gap-0.5 rounded-sm border border-[--hair-border] bg-white p-[3px]">
            <TabsTrigger
              value="keys"
              className="rounded-[2px] px-[15px] py-[7px] text-[12.5px] font-medium text-muted-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none"
            >
              API keys
            </TabsTrigger>
            <TabsTrigger
              value="quickstart"
              className="rounded-[2px] px-[15px] py-[7px] text-[12.5px] font-medium text-muted-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none"
            >
              Quickstart
            </TabsTrigger>
            <TabsTrigger
              value="notebook"
              className="rounded-[2px] px-[15px] py-[7px] text-[12.5px] font-medium text-muted-foreground data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none"
            >
              Notebook
            </TabsTrigger>
          </TabsList>

          {/* ── Keys ─────────────────────────────────────────────────────── */}
          <TabsContent value="keys" className="space-y-3.5">
            {/* Key hygiene — bespoke red-kicker card, ABOVE the table */}
            <div className={`${SURFACE} flex gap-3 px-4 py-3.5`}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#bf2330]" />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#bf2330]">
                  Key hygiene
                </div>
                <div className="mt-1.5 max-w-3xl text-[12.5px] leading-[1.55] text-[#525252]">
                  Store keys in a secret manager, never in source control. Start on{' '}
                  <span className="font-mono">test</span> keys, give each system its own key with the
                  narrowest scopes that work — a leaked key is one click to revoke.
                </div>
              </div>
            </div>

            {/* L1: the table's name reads on the canvas, above the shell. */}
            <TableBlock
              name="Organization keys"
              count={keys.length}
              meta={`${activeCount} active`}
              actions={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Create API key
                </Button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={`${TH} ${FROZEN_CELL_ON_TINT}`}>Name</th>
                      <th className={TH}>Key</th>
                      <th className={TH}>Env</th>
                      <th className={TH}>Scopes</th>
                      <th className={TH}>Projects</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Req 30d</th>
                      <th className={TH}>Last used</th>
                      <th className={`${TH} w-[1%]`} />
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-12 text-center">
                          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                        </td>
                      </tr>
                    ) : keys.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-14">
                          <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                            <div className="grid h-11 w-11 place-items-center rounded-md border border-[--hair-border] text-muted-foreground">
                              <KeyRound className="h-[18px] w-[18px]" />
                            </div>
                            <div className="mt-4 text-[15px] font-semibold">No API keys yet</div>
                            <div className="mt-1.5 text-[13px] leading-[1.5] text-muted-foreground">
                              Create one to call the API from scripts, notebooks, or CI. The secret is
                              shown once.
                            </div>
                            <Button size="sm" className="mt-[18px] rounded-sm" onClick={() => setCreateOpen(true)}>
                              <Plus className="mr-1.5 h-3.5 w-3.5" /> Create API key
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      keys.map((k) => {
                        const st = keyStatus(k);
                        const u = usage[k.id];
                        return (
                          <tr key={k.id} className="hover:bg-[#fcfcfc]">
                            <td className={`${TD} whitespace-nowrap text-[13px] font-medium`}>{k.name}</td>
                            <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                              sk_{k.env}_{k.key_prefix}_••••
                            </td>
                            <td className={TD}>
                              {k.env === 'test' ? (
                                <span className="rounded-sm bg-[#f0f0f0] px-[7px] py-0.5 font-mono text-[10px] text-[#525252]">
                                  test
                                </span>
                              ) : (
                                <span className="rounded-sm border border-[#d4d4d4] px-[7px] py-0.5 font-mono text-[10px] text-foreground">
                                  live
                                </span>
                              )}
                            </td>
                            <td className={`${TD} max-w-[220px]`}>
                              <div className="flex flex-wrap gap-1">
                                {k.scopes.map((s) => (
                                  <span
                                    key={s}
                                    className="rounded-sm border border-[--zinc-border] px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className={`${TD} text-xs text-muted-foreground`}>
                              {k.project_ids ? `${k.project_ids.length} selected` : 'All'}
                            </td>
                            <td className={TD}>
                              <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${st.text}`}>
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ background: st.dot }}
                                />
                                {st.label}
                              </span>
                            </td>
                            <td className={`${TD} whitespace-nowrap text-right font-mono text-xs tabular-nums`}>
                              {u ? (
                                <>
                                  {Number(u.requests_30d).toLocaleString()}
                                  {u.errors_30d > 0 && (
                                    <span className="text-[#bf2330]"> · {u.errors_30d} err</span>
                                  )}
                                </>
                              ) : '0'}
                            </td>
                            <td className={`${TD} whitespace-nowrap text-xs text-muted-foreground`}>
                              {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}
                            </td>
                            <td className={`${TD} whitespace-nowrap text-right`}>
                              {k.status === 'active' && (
                                <div className="inline-flex items-center gap-2 text-[#a3a3a3]">
                                  <button
                                    type="button"
                                    title="Rotate: mints a new secret; the old one keeps working for 72 h"
                                    className="hover:text-foreground"
                                    onClick={() => setRotateTarget(k)}
                                  >
                                    <RefreshCcw className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Revoke immediately"
                                    className="hover:text-[#bf2330]"
                                    onClick={() => setRevokeTarget(k)}
                                  >
                                    <ShieldOff className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </TableBlock>
          </TabsContent>

          {/* ── Quickstart ───────────────────────────────────────────────── */}
          <TabsContent value="quickstart" className="space-y-4">
            <div>
              <div className="text-[14px] font-semibold">Base URL</div>
              <div className="mt-2 flex items-center gap-2.5">
                <InlineCode className="min-w-0 flex-1 truncate rounded-sm border-[--hair-border] text-[11.5px]">
                  {API_BASE}
                </InlineCode>
                <CopyButton text={API_BASE} label="Copy" />
              </div>
              <p className="mt-2 text-xs leading-[1.5] text-muted-foreground">
                All endpoints are versioned under <span className="font-mono">/v1</span> and
                authenticated with <span className="font-mono">Authorization: Bearer sk_…</span>.
                Errors use a consistent{' '}
                <span className="font-mono">{'{"error":{"code","message"}}'}</span> envelope;
                rate-limit state is returned in <span className="font-mono">X-RateLimit-*</span> headers.
              </p>
            </div>

            <div className="grid gap-3.5 md:grid-cols-2">
              <ApiCodeBlock title="List your projects" code={curlList} />
              <ApiCodeBlock title="Dispatch a run (202 → run_id; a retried submit with the same Idempotency-Key returns the same run)" code={curlRun} />
              <ApiCodeBlock title="Poll a run until it finishes" code={curlPoll} />
              <ApiCodeBlock title="Python: end-to-end (snapshot → dispatch → poll → replications)" code={pythonSnippet} />
            </div>

            <div>
              <div className="text-[14px] font-semibold">Example: material shortage on Project AA (Version 3)</div>
              <p className="mt-2 text-xs leading-[1.5] text-muted-foreground">
                Resolves a real project and policy snapshot by name, runs a baseline and a
                supplier/material capacity-cut scenario, then compares the shortage KPIs
                (<span className="font-mono">fill_rate</span>,{' '}
                <span className="font-mono">lost_sales_value</span>,{' '}
                <span className="font-mono">max_backlog</span>) driven by policy{' '}
                <span className="font-mono">P-C.1 unmet_demand_handling</span>. The full
                version — with baseline vs. shortage charts and a weekly fill-rate
                trajectory plot — is §13 of the{' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => {
                    const tab = document.querySelector<HTMLButtonElement>('[value="notebook"]');
                    tab?.click();
                  }}
                >
                  Notebook tab
                </button>{' '}
                quickstart.
              </p>
            </div>
            <ApiCodeBlock title="Python: material shortage — Project AA, Version 3" code={shortageSnippet} />

            {/* L1: the table's name reads on the canvas, above the shell. */}
            <TableBlock name="Endpoints · v1" count={ENDPOINTS.length}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <tbody>
                    {ENDPOINTS.map(([ep, scope, what]) => (
                      <tr key={ep} className="hover:bg-[#fcfcfc]">
                        <td className={`${TD} whitespace-nowrap font-mono text-[11px] text-foreground`}>{ep}</td>
                        <td className={`${TD} whitespace-nowrap font-mono text-[11px] text-muted-foreground`}>{scope}</td>
                        <td className={`${TD} text-xs text-[#525252]`}>{what}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-[--hair-border] px-4 py-2.5 text-[11px] text-muted-foreground">
                Full reference: <span className="font-mono">docs/api/README.md</span> in the repository.
              </div>
            </TableBlock>
          </TabsContent>

          {/* ── Notebook ─────────────────────────────────────────────────── */}
          <TabsContent value="notebook" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-[14px] font-semibold">
                  <NotebookText className="h-3.5 w-3.5" /> Ready-to-run quickstart
                </div>
                <p className="text-xs text-muted-foreground">
                  §1–12 cover the full API surface; §13 is a worked material-shortage
                  deep dive — pick your project above, then edit its `SHORTAGE_TARGET`
                  to a real material or supplier key.
                </p>
              </div>
              <div className="flex flex-none gap-2">
                <Button size="sm" variant="outline" className="rounded-sm" asChild>
                  <a href={NOTEBOOK_COLAB_URL} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open example in Colab
                  </a>
                </Button>
                <Button size="sm" className={`rounded-sm ${TEMPLATE_BTN}`} onClick={downloadNotebook} disabled={nbDownloading}>
                  {nbDownloading
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <Download className="mr-1.5 h-3.5 w-3.5" />}
                  Download template (.ipynb){nbProject ? ` for “${nbProject.name}”` : ''}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-start">
              {/* Project + CONFIG cell */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-[#404040]">Project</Label>
                  <Select value={nbProjectId} onValueChange={setNbProjectId}>
                    <SelectTrigger className="rounded-sm">
                      <SelectValue placeholder={projects.length ? 'Select a project…' : 'No projects available'} />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {nbProject && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Project ID</p>
                    <div className="flex items-center gap-2">
                      <InlineCode className="min-w-0 flex-1 truncate rounded-sm border-[--hair-border]">{nbProject.id}</InlineCode>
                      <CopyButton text={nbProject.id} />
                    </div>
                  </div>
                )}

                <ApiCodeBlock
                  title="Notebook CONFIG cell (pre-filled — paste over the notebook's first code cell)"
                  code={nbConfigCell || '# Select a project to fill in BASE_URL, PROJECT_ID, SCENARIO_ID, POLICY_VERSION_ID'}
                />
              </div>

              {/* Id reference tables */}
              <div className="space-y-3.5">
                {!nbProject ? (
                  <div className={`${SURFACE} px-4 py-10 text-center text-sm text-muted-foreground`}>
                    Select a project to see every id the notebook needs.
                  </div>
                ) : nbLoading ? (
                  <div className={`${SURFACE} px-4 py-10 text-center`}>
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div>
                      <div className={`${KX} mb-1.5 tracking-[0.06em]`}>
                        Scenarios ({nbScenarios.length}) · SCENARIO_ID
                      </div>
                      {nbScenarios.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          None yet — §6 of the notebook creates one via{' '}
                          <span className="font-mono">POST …/scenarios</span>.
                        </p>
                      ) : (
                        <div className={`${SURFACE} overflow-hidden`}>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr>
                                  <th className={TH}>Name</th>
                                  <th className={TH}>ID</th>
                                  <th className={TH}>Horizon</th>
                                  <th className={TH}>Reps</th>
                                  <th className={TH}>Primary KPI</th>
                                </tr>
                              </thead>
                              <tbody>
                                {nbScenarios.map((s) => (
                                  <tr key={s.id} className="hover:bg-[#fcfcfc]">
                                    <td className={`${TD} ${FROZEN_CELL} text-xs font-medium`}>{s.name}</td>
                                    <td className={TD}><IdCell value={s.id} /></td>
                                    <td className={`${TD} text-xs`}>{s.horizon_days} d (+{s.warmup_days})</td>
                                    <td className={`${TD} text-xs`}>{s.replications}</td>
                                    <td className={`${TD} font-mono text-[11px]`}>{s.primary_kpi}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className={`${KX} mb-1.5 tracking-[0.06em]`}>
                        Policy versions ({nbPolicyVersions.length}) · POLICY_VERSION_ID
                      </div>
                      {nbPolicyVersions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          None yet — §5 of the notebook snapshots one via{' '}
                          <span className="font-mono">POST …/policy-versions</span>.
                        </p>
                      ) : (
                        <div className={`${SURFACE} overflow-hidden`}>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr>
                                  <th className={TH}>Label</th>
                                  <th className={TH}>ID</th>
                                  <th className={TH}>policy_hash</th>
                                  <th className={TH}>Runs</th>
                                  <th className={TH}>Created</th>
                                </tr>
                              </thead>
                              <tbody>
                                {nbPolicyVersions.slice(0, 8).map((v) => (
                                  <tr key={v.id} className="hover:bg-[#fcfcfc]">
                                    <td className={`${TD} text-xs font-medium`}>{v.label ?? 'unlabelled'}</td>
                                    <td className={TD}><IdCell value={v.id} /></td>
                                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>{(v.policy_hash ?? '').slice(0, 12)}…</td>
                                    <td className={`${TD} text-xs`}>{v.run_count}</td>
                                    <td className={`${TD} whitespace-nowrap text-xs text-muted-foreground`}>{new Date(v.created_at).toLocaleDateString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className={`${KX} mb-1.5 tracking-[0.06em]`}>
                        Dataset versions ({nbDatasetVersions.length}) · input-data provenance
                      </div>
                      {nbDatasetVersions.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          None yet — §2 of the notebook freezes one via{' '}
                          <span className="font-mono">POST …/datasets:freeze</span>.
                        </p>
                      ) : (
                        <div className={`${SURFACE} overflow-hidden`}>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr>
                                  <th className={TH}>Label</th>
                                  <th className={TH}>ID</th>
                                  <th className={TH}>graph_hash</th>
                                  <th className={TH}>Created</th>
                                </tr>
                              </thead>
                              <tbody>
                                {nbDatasetVersions.slice(0, 8).map((v) => (
                                  <tr key={v.id} className="hover:bg-[#fcfcfc]">
                                    <td className={`${TD} text-xs font-medium`}>{v.label ?? 'unlabelled'}</td>
                                    <td className={TD}><IdCell value={v.id} /></td>
                                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>{(v.graph_hash ?? '').slice(0, 12)}…</td>
                                    <td className={`${TD} whitespace-nowrap text-xs text-muted-foreground`}>{new Date(v.created_at).toLocaleDateString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className={`${SURFACE} flex gap-3 px-4 py-3.5`}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#bf2330]" />
              <div className="text-xs leading-[1.55] text-[#525252]">
                Never paste your API key into a notebook cell. In Colab, store it once in the{' '}
                <span className="font-medium">Secrets</span> panel as{' '}
                <span className="font-mono">SURESUITE_API_KEY</span> — the notebook reads it from
                there (or from the environment / a hidden prompt when run locally). If Colab can’t
                open the repository directly, download the template and use Colab’s{' '}
                <span className="font-medium">File → Upload notebook</span>.
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {dialogs}
    </PageLayout>
  );
}
