import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { ErrorBanner, SectionCard } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Ban,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

type Tri = 'inherit' | 'allow' | 'deny';

interface CapRow {
  key: string;
  kind: 'page' | 'feature';
  label: string;
  description?: string | null;
  sort_order: number;
  role_default: boolean;
  org_override: boolean | null;
  user_override: boolean | null;
  effective: boolean;
}

interface ModelCatalogItem {
  id: string;
  code: string;
  display_name: string;
  provider_code: string | null;
  provider_name: string | null;
  enabled: boolean;
}

interface Budgets {
  monthly_usd: number | null;
  daily_usd: number | null;
  token_limit: number | null;
  rpm: number | null;
  rpd: number | null;
  mtd_cost_usd: number;
  mtd_requests: number;
  mtd_tokens: number;
  today_cost_usd: number;
  today_requests: number;
}

interface AccessData {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string;
  organization_id: string | null;
  is_super_admin: boolean;
  capabilities: CapRow[];
  models: {
    catalog: ModelCatalogItem[];
    allowed_ids: string[];
    default_id: string | null;
    fallback_id: string | null;
    all_allowed: boolean;
  };
  budgets: Budgets;
}

const db = supabase as any;
const ALWAYS_ON = new Set(['/profile']);

function triOf(override: boolean | null): Tri {
  if (override === null || override === undefined) return 'inherit';
  return override ? 'allow' : 'deny';
}

function computeEffective(row: Pick<CapRow, 'kind' | 'key' | 'role_default' | 'org_override' | 'user_override'>, isSuper: boolean): boolean {
  if (isSuper) return true;
  if (row.kind === 'page' && ALWAYS_ON.has(row.key)) return true;
  return row.user_override ?? row.org_override ?? row.role_default;
}

export default function AdminUserAccess({ isCollapsed, setIsCollapsed }: Props) {
  const { userId = '' } = useParams();
  const navigate = useNavigate();
  const { user: actor } = useAuth();

  const [data, setData] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // Local budget form state (explicit save).
  const [monthly, setMonthly] = useState('');
  const [daily, setDaily] = useState('');
  const [tokenLimit, setTokenLimit] = useState('');
  const [rpm, setRpm] = useState('');
  const [rpd, setRpd] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  const load = useCallback(async () => {
    if (!actor?.id) return;
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await db.rpc('get_user_access', {
      p_actor_id: actor.id,
      p_actor_email: actor.email,
      p_target_user_id: userId,
    });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const d = res as AccessData;
    setData(d);
    setMonthly(d.budgets.monthly_usd?.toString() ?? '');
    setDaily(d.budgets.daily_usd?.toString() ?? '');
    setTokenLimit(d.budgets.token_limit?.toString() ?? '');
    setRpm(d.budgets.rpm?.toString() ?? '');
    setRpd(d.budgets.rpd?.toString() ?? '');
    setLoading(false);
  }, [actor?.id, actor?.email, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const isSuper = data?.is_super_admin ?? false;
  const pages = useMemo(() => (data?.capabilities ?? []).filter((c) => c.kind === 'page'), [data]);
  const features = useMemo(
    () => (data?.capabilities ?? []).filter((c) => c.kind === 'feature'),
    [data],
  );

  const setOverride = async (row: CapRow, tri: Tri) => {
    if (!actor?.id || !data) return;
    const allowed = tri === 'inherit' ? null : tri === 'allow';
    // optimistic update
    setData((prev) => {
      if (!prev) return prev;
      const caps = prev.capabilities.map((c) => {
        if (c.key !== row.key) return c;
        const next = { ...c, user_override: allowed };
        return { ...next, effective: computeEffective(next, prev.is_super_admin) };
      });
      return { ...prev, capabilities: caps };
    });
    const { error: err } = await db.rpc('admin_set_capability', {
      p_actor_id: actor.id,
      p_actor_email: actor.email,
      p_scope: 'user',
      p_scope_id: data.user_id,
      p_capability_key: row.key,
      p_allowed: allowed,
    });
    if (err) {
      toast.error(err.message);
      load();
    } else {
      toast.success(`${row.label}: ${tri === 'inherit' ? 'inheriting default' : tri === 'allow' ? 'allowed' : 'denied'}`);
    }
  };

  const saveModels = async (next: { allowed_ids?: string[]; default_id?: string | null; fallback_id?: string | null }) => {
    if (!actor?.id || !data) return;
    const allowed_ids = next.allowed_ids ?? data.models.allowed_ids;
    const default_id = next.default_id !== undefined ? next.default_id : data.models.default_id;
    const fallback_id = next.fallback_id !== undefined ? next.fallback_id : data.models.fallback_id;
    setData((prev) =>
      prev
        ? { ...prev, models: { ...prev.models, allowed_ids, default_id, fallback_id, all_allowed: allowed_ids.length === 0 } }
        : prev,
    );
    const { error: err } = await db.rpc('admin_set_user_models', {
      p_actor_id: actor.id,
      p_actor_email: actor.email,
      p_target_user_id: data.user_id,
      p_allowed_model_ids: allowed_ids,
      p_default_model_id: default_id,
      p_fallback_model_id: fallback_id,
    });
    if (err) {
      toast.error(err.message);
      load();
    } else {
      toast.success('AI models updated');
    }
  };

  const toggleModel = (id: string, checked: boolean) => {
    if (!data) return;
    const set = new Set(data.models.allowed_ids);
    if (checked) set.add(id);
    else set.delete(id);
    saveModels({ allowed_ids: Array.from(set) });
  };

  const saveBudgets = async () => {
    if (!actor?.id || !data) return;
    setSavingBudget(true);
    const numOrNull = (s: string) => {
      const t = s.trim();
      return t === '' ? null : Number(t);
    };
    try {
      const monthlyRes = await db.rpc('admin_set_user_budget', {
        p_actor_id: actor.id,
        p_actor_email: actor.email,
        p_target_user_id: data.user_id,
        p_period: 'monthly',
        p_budget_usd: numOrNull(monthly),
        p_token_limit: numOrNull(tokenLimit),
        p_rpm: numOrNull(rpm),
        p_rpd: null,
      });
      if (monthlyRes.error) throw monthlyRes.error;
      const dailyRes = await db.rpc('admin_set_user_budget', {
        p_actor_id: actor.id,
        p_actor_email: actor.email,
        p_target_user_id: data.user_id,
        p_period: 'daily',
        p_budget_usd: numOrNull(daily),
        p_token_limit: null,
        p_rpm: null,
        p_rpd: numOrNull(rpd),
      });
      if (dailyRes.error) throw dailyRes.error;
      toast.success('Budgets & limits saved');
      load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save budgets');
    } finally {
      setSavingBudget(false);
    }
  };

  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, ModelCatalogItem[]>();
    for (const m of data?.models.catalog ?? []) {
      const key = m.provider_name ?? 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries());
  }, [data]);

  const title = data ? data.name || data.email || 'User access' : 'User access';
  const subtitle = data ? (
    <span className="inline-flex items-center gap-2">
      <span>{data.email}</span>
      <Badge variant="secondary" className="text-[10px] font-medium capitalize">
        {data.role.replace('_', ' ')}
      </Badge>
      {data.is_super_admin && (
        <Badge className="bg-primary/10 text-primary hover:bg-primary/10 text-[10px] font-medium">
          <ShieldCheck className="mr-0.5 h-3 w-3" /> Super admin
        </Badge>
      )}
    </span>
  ) : (
    'Loading…'
  );

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title={title}
      description={subtitle}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPreview((p) => !p)}>
            {preview ? <EyeOff className="mr-1 h-4 w-4" /> : <Eye className="mr-1 h-4 w-4" />}
            {preview ? 'Hide preview' : 'Preview as user'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/admin/users')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Back
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : !data ? null : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">

            {/* ── Pages ─────────────────────────────────────────────── */}
            <SectionCard title="Pages">
              <CapMatrix rows={pages} isSuper={isSuper} onSet={setOverride} />
            </SectionCard>

            {/* ── Features ──────────────────────────────────────────── */}
            <SectionCard title="Features">
              <CapMatrix rows={features} isSuper={isSuper} onSet={setOverride} />
            </SectionCard>

            {/* ── AI models ─────────────────────────────────────────── */}
            <SectionCard
              title="AI models"
              badge={
                isSuper
                  ? 'All enabled'
                  : data.models.all_allowed
                    ? 'No restriction'
                    : undefined
              }
            >
              <div className="space-y-4">
                {modelsByProvider.map(([provider, models]) => (
                  <div key={provider}>
                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {provider}
                    </div>
                    <div className="space-y-1.5">
                      {models.map((m) => (
                        <label
                          key={m.id}
                          className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/40"
                        >
                          <Checkbox
                            checked={data.models.allowed_ids.includes(m.id)}
                            disabled={isSuper}
                            onCheckedChange={(v) => toggleModel(m.id, !!v)}
                          />
                          <span>{m.display_name}</span>
                          <span className="ml-auto font-mono text-xs text-muted-foreground">{m.code}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <Separator className="my-4" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Default model</Label>
                  <Select
                    value={data.models.default_id ?? 'none'}
                    onValueChange={(v) => saveModels({ default_id: v === 'none' ? null : v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {data.models.catalog.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Fallback model</Label>
                  <Select
                    value={data.models.fallback_id ?? 'none'}
                    onValueChange={(v) => saveModels({ fallback_id: v === 'none' ? null : v })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {data.models.catalog.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </SectionCard>

            {/* ── Budgets & limits ──────────────────────────────────── */}
            <SectionCard title="Budgets & limits">
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <UsageStat label="Cost (MTD)" value={`$${data.budgets.mtd_cost_usd.toFixed(2)}`}
                  cap={data.budgets.monthly_usd != null ? `of $${data.budgets.monthly_usd.toFixed(2)}` : undefined}
                  over={data.budgets.monthly_usd != null && data.budgets.mtd_cost_usd >= data.budgets.monthly_usd} />
                <UsageStat label="Cost (today)" value={`$${data.budgets.today_cost_usd.toFixed(2)}`}
                  cap={data.budgets.daily_usd != null ? `of $${data.budgets.daily_usd.toFixed(2)}` : undefined}
                  over={data.budgets.daily_usd != null && data.budgets.today_cost_usd >= data.budgets.daily_usd} />
                <UsageStat label="Requests (MTD)" value={data.budgets.mtd_requests.toLocaleString()} />
                <UsageStat label="Requests (today)" value={data.budgets.today_requests.toLocaleString()}
                  cap={data.budgets.rpd != null ? `of ${data.budgets.rpd}` : undefined}
                  over={data.budgets.rpd != null && data.budgets.today_requests >= data.budgets.rpd} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Monthly budget (USD)</Label>
                  <Input type="number" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="e.g. 25.00" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Daily budget (USD)</Label>
                  <Input type="number" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="e.g. 2.00" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Monthly token limit</Label>
                  <Input type="number" value={tokenLimit} onChange={(e) => setTokenLimit(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Requests / min</Label>
                  <Input type="number" value={rpm} onChange={(e) => setRpm(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Requests / day</Label>
                  <Input type="number" value={rpd} onChange={(e) => setRpd(e.target.value)} className="mt-1" />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={saveBudgets} disabled={savingBudget}>
                  {savingBudget && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save budgets &amp; limits
                </Button>
              </div>
            </SectionCard>
          </div>

          {/* ── Preview as user ─────────────────────────────────────── */}
          {preview && <PreviewPanel data={data} />}
        </div>
      )}
    </AdminLayout>
  );
}

function CapMatrix({
  rows,
  isSuper,
  onSet,
}: {
  rows: CapRow[];
  isSuper: boolean;
  onSet: (row: CapRow, tri: Tri) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {rows.map((row) => {
        const locked = ALWAYS_ON.has(row.key);
        return (
          <div key={row.key} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {row.label}
                {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
              </div>
              {row.description && (
                <div className="truncate text-xs text-muted-foreground">{row.description}</div>
              )}
            </div>
            <Badge
              variant="outline"
              className="hidden shrink-0 text-[10px] font-normal text-muted-foreground sm:inline-flex"
              title="Role default"
            >
              default: {row.role_default ? 'allow' : 'deny'}
            </Badge>
            {row.org_override != null && (
              <Badge variant="outline" className="hidden shrink-0 text-[10px] font-normal text-muted-foreground md:inline-flex" title="Organization override">
                org: {row.org_override ? 'allow' : 'deny'}
              </Badge>
            )}
            {locked || isSuper ? (
              <span className="w-[210px] text-right text-xs text-muted-foreground">
                {locked ? 'Always available' : 'Full access'}
              </span>
            ) : (
              <ToggleGroup
                type="single"
                value={triOf(row.user_override)}
                onValueChange={(v) => v && onSet(row, v as Tri)}
                className="shrink-0"
              >
                <ToggleGroupItem value="inherit" className="h-8 px-2 text-xs">Inherit</ToggleGroupItem>
                <ToggleGroupItem value="allow" className="h-8 px-2 text-xs">Allow</ToggleGroupItem>
                <ToggleGroupItem value="deny" className="h-8 px-2 text-xs">Deny</ToggleGroupItem>
              </ToggleGroup>
            )}
            <span className="w-16 shrink-0 text-right">
              {row.effective ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                >
                  <Check className="mr-0.5 h-3 w-3" /> On
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-muted-foreground">
                  <Ban className="mr-0.5 h-3 w-3" /> Off
                </Badge>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function UsageStat({ label, value, cap, over }: { label: string; value: string; cap?: string; over?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${over ? 'text-destructive' : 'text-foreground'}`}>{value}</div>
      {cap && <div className="text-[11px] text-muted-foreground">{cap}</div>}
    </div>
  );
}

function PreviewPanel({ data }: { data: AccessData }) {
  const allowedPages = data.capabilities.filter((c) => c.kind === 'page' && c.effective);
  const allowedFeatures = data.capabilities.filter((c) => c.kind === 'feature' && c.effective);
  return (
    <aside className="h-fit rounded-lg border border-border bg-card p-4 lg:sticky lg:top-4">
      <div className="mb-3 flex items-center gap-2">
        <Eye className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Preview as {data.name || data.email}</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        The navigation and abilities this user sees on their next login.
      </p>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Navigation</div>
      <div className="mb-4 space-y-1">
        {allowedPages.length === 0 ? (
          <div className="text-xs text-muted-foreground">No pages</div>
        ) : (
          allowedPages.map((p) => (
            <div key={p.key} className="flex items-center gap-2 rounded-md bg-accent/40 px-2 py-1 text-xs">
              <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-300" />
              {p.label}
            </div>
          ))
        )}
      </div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Features</div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {allowedFeatures.length === 0 ? (
          <div className="text-xs text-muted-foreground">No features</div>
        ) : (
          allowedFeatures.map((f) => (
            <Badge key={f.key} variant="secondary" className="text-[11px]">{f.label}</Badge>
          ))
        )}
      </div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">AI models</div>
      <div className="flex flex-wrap gap-1.5">
        {data.models.all_allowed ? (
          <Badge variant="outline" className="text-[11px]">All enabled models</Badge>
        ) : data.models.allowed_ids.length === 0 ? (
          <div className="text-xs text-muted-foreground">None</div>
        ) : (
          data.models.catalog
            .filter((m) => data.models.allowed_ids.includes(m.id))
            .map((m) => (
              <Badge key={m.id} variant="outline" className="text-[11px]">{m.display_name}</Badge>
            ))
        )}
      </div>
    </aside>
  );
}
