// @ts-nocheck — schema mismatch: uses the api-key RPCs from migration
// 20260711000001 which are not in the generated types yet. Remove once
// types are regenerated.
//
// Developer API page — API Phase 0 / G15 / §12 (developer experience).
// Self-service key management for the public /v1 gateway: create (show-once),
// list, rotate, revoke, per-key usage, and copy-paste quickstarts. Backed
// entirely by the SECURITY DEFINER RPCs (create/list/rotate/revoke_api_key);
// the plaintext secret exists only in this browser tab, once.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageLayout } from '@/components/shared/PageLayout';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, RefreshCcw, ShieldOff,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

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

const db = supabase as any;
const SUPABASE_URL: string =
  (supabase as any).supabaseUrl ?? 'https://wckdrutwkytwcomrlpib.supabase.co';
const API_BASE = `${SUPABASE_URL}/functions/v1/api/v1`;

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

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
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

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <CopyButton text={code} label="Copy" />
      </div>
      <pre className="rounded-md border border-border bg-muted/50 p-3 text-[11px] leading-relaxed overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
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

  const keyStatus = (k: ApiKeyRow): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } => {
    if (k.status === 'revoked') return { label: 'revoked', variant: 'destructive' };
    if (k.expires_at && new Date(k.expires_at).getTime() < Date.now()) {
      return { label: 'expired', variant: 'outline' };
    }
    return { label: 'active', variant: 'default' };
  };

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

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 pt-6">
        <PageHeader
          title="Developer API"
          subtitle="Drive SureSuite programmatically — API keys, scopes, and quickstarts for the /v1 gateway"
          onRefresh={load}
          refreshLoading={loading}
          rightContent={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Create API key
            </Button>
          }
        />

        <Tabs defaultValue="keys" className="space-y-4">
          <TabsList>
            <TabsTrigger value="keys">API keys</TabsTrigger>
            <TabsTrigger value="quickstart">Quickstart</TabsTrigger>
          </TabsList>

          {/* ── Keys ─────────────────────────────────────────────────────── */}
          <TabsContent value="keys" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <KeyRound className="h-4 w-4" /> Organization API keys
                </CardTitle>
                <CardDescription className="text-xs">
                  Keys authenticate external callers to the public API. The secret is shown once at
                  creation and stored only as a hash — rotate or revoke a key at any time; every
                  request made with it is audited.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Env</TableHead>
                      <TableHead>Scopes</TableHead>
                      <TableHead>Projects</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Requests (30d)</TableHead>
                      <TableHead>Last used</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center">
                          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                        </TableCell>
                      </TableRow>
                    ) : keys.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                          No API keys yet. Create one to call the API from scripts, notebooks, or CI.
                        </TableCell>
                      </TableRow>
                    ) : (
                      keys.map((k) => {
                        const st = keyStatus(k);
                        const u = usage[k.id];
                        return (
                          <TableRow key={k.id}>
                            <TableCell className="font-medium text-sm">{k.name}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              sk_{k.env}_{k.key_prefix}_••••
                            </TableCell>
                            <TableCell>
                              <Badge variant={k.env === 'live' ? 'default' : 'secondary'}>{k.env}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[220px]">
                              <div className="flex flex-wrap gap-1">
                                {k.scopes.map((s) => (
                                  <Badge key={s} variant="outline" className="font-mono text-[10px]">
                                    {s}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {k.project_ids ? `${k.project_ids.length} selected` : 'All'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={st.variant}>{st.label}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">
                              {u ? (
                                <>
                                  {u.requests_30d}
                                  {u.errors_30d > 0 && (
                                    <span className="text-destructive"> · {u.errors_30d} err</span>
                                  )}
                                </>
                              ) : '0'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              {k.status === 'active' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Rotate: mints a new secret; the old one keeps working for 72 h"
                                    onClick={() => setRotateTarget(k)}
                                  >
                                    <RefreshCcw className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Revoke immediately"
                                    onClick={() => setRevokeTarget(k)}
                                  >
                                    <ShieldOff className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm">Key hygiene</AlertTitle>
              <AlertDescription className="text-xs">
                Treat keys like passwords: store them in a secret manager or environment variable,
                never in source control. Use <span className="font-mono">test</span> keys (stricter
                limits, one concurrent run) while integrating, and give each system its own key with
                the narrowest scopes that work — a leaked key is one click to revoke here.
              </AlertDescription>
            </Alert>
          </TabsContent>

          {/* ── Quickstart ───────────────────────────────────────────────── */}
          <TabsContent value="quickstart" className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Base URL</CardTitle>
                <CardDescription className="text-xs">
                  All endpoints are versioned under <span className="font-mono">/v1</span> and
                  authenticated with <span className="font-mono">Authorization: Bearer sk_…</span>.
                  Errors use a consistent{' '}
                  <span className="font-mono">{'{"error":{"code","message"}}'}</span> envelope;
                  rate-limit state is returned in <span className="font-mono">X-RateLimit-*</span> headers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <code className="rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs">{API_BASE}</code>
                  <CopyButton text={API_BASE} />
                </div>
                <Snippet title="List your projects" code={curlList} />
                <Snippet title="Dispatch a simulation run (202 → run_id; retried submits with the same Idempotency-Key return the same run)" code={curlRun} />
                <Snippet title="Poll a run until it finishes" code={curlPoll} />
                <Snippet title="Python: end-to-end (snapshot policy → dispatch → poll → replications)" code={pythonSnippet} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Endpoints (v1)</CardTitle>
                <CardDescription className="text-xs">
                  Full reference: <span className="font-mono">docs/api/README.md</span> in the repository.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Purpose</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
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
                    ].map(([ep, scope, what]) => (
                      <TableRow key={ep}>
                        <TableCell className="font-mono text-[11px]">{ep}</TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">{scope}</TableCell>
                        <TableCell className="text-xs">{what}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Create key dialog ─────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreateForm(); }}>
        <DialogContent className="max-w-lg">
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
                placeholder="e.g. CI pipeline, analyst notebook"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Environment</Label>
              <Select value={env} onValueChange={(v) => setEnv(v as 'live' | 'test')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">test — stricter limits, 1 concurrent run (recommended to start)</SelectItem>
                  <SelectItem value="live">live — production traffic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scopes (least privilege: pick only what the caller needs)</Label>
              <div className="grid grid-cols-1 gap-1.5 rounded-md border border-border p-3 max-h-48 overflow-y-auto">
                {SCOPES.map((s) => (
                  <label key={s.id} className="flex items-start gap-2 text-sm cursor-pointer">
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
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={allProjects} onCheckedChange={(c) => setAllProjects(!!c)} />
                All projects in my organization
              </label>
              {!allProjects && (
                <div className="rounded-md border border-border p-3 max-h-36 overflow-y-auto space-y-1.5">
                  {projects.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No projects found.</p>
                  ) : (
                    projects.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer">
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
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={onCreate} disabled={creating}>
              {creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Show-once secret dialog ───────────────────────────────────────── */}
      <Dialog open={!!mintedKey} onOpenChange={(o) => { if (!o) setMintedKey(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Copy your API key now</DialogTitle>
            <DialogDescription>
              This is the only time the secret for “{mintedKey?.name}” is shown. Only a hash is
              stored — if you lose it, rotate the key to get a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs break-all">
              {mintedKey?.plaintext}
            </code>
            <CopyButton text={mintedKey?.plaintext ?? ''} />
          </div>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Store it in a secret manager or environment variable (e.g.{' '}
              <span className="font-mono">SURESUITE_API_KEY</span>). Never commit it to source control.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button onClick={() => setMintedKey(null)}>I've stored it safely</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rotate confirm ────────────────────────────────────────────────── */}
      <Dialog open={!!rotateTarget} onOpenChange={(o) => { if (!o) setRotateTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rotate “{rotateTarget?.name}”?</DialogTitle>
            <DialogDescription>
              A new secret is minted with the same scopes and project access. The current secret
              keeps working for 72 hours so callers can switch over without downtime, then expires.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRotateTarget(null)}>Cancel</Button>
            <Button onClick={onRotate} disabled={mutating}>
              {mutating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Rotate key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revoke confirm ────────────────────────────────────────────────── */}
      <Dialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke “{revokeTarget?.name}”?</DialogTitle>
            <DialogDescription>
              The key stops working on its next request. This cannot be undone — create a new key
              if the caller should regain access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={onRevoke} disabled={mutating}>
              {mutating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Revoke key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
