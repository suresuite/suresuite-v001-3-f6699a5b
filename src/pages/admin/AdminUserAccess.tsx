// User Access (/admin/users/:userId) — SuReSuite "Ledger" redesign.
// All data flow and RPCs unchanged from the original AdminUserAccess.tsx:
// get_user_access, admin_set_capability, admin_set_user_models,
// admin_set_user_budget, optimistic updates and effective-permission math.
// Presentation: SectionCard treatment, a segmented Inherit/Allow/Deny tri
// control, teal On / grey Off status dots, mono model codes, and a sticky
// "Preview as user" panel.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, KX, StatusDot, Segmented, MonoChip, type Tri } from '@/components/admin/adminUi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, ShieldCheck, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface CapRow {
  key: string; kind: 'page' | 'feature'; label: string; description?: string | null;
  sort_order: number; role_default: boolean; org_override: boolean | null;
  user_override: boolean | null; effective: boolean;
}
interface ModelCatalogItem { id: string; code: string; display_name: string; provider_code: string | null; provider_name: string | null; enabled: boolean; }
interface Budgets { monthly_usd: number | null; daily_usd: number | null; token_limit: number | null; rpm: number | null; rpd: number | null; mtd_cost_usd: number; mtd_requests: number; mtd_tokens: number; today_cost_usd: number; today_requests: number; }
interface AccessData {
  user_id: string; name: string | null; email: string | null; role: string; organization_id: string | null;
  is_super_admin: boolean; capabilities: CapRow[];
  models: { catalog: ModelCatalogItem[]; allowed_ids: string[]; default_id: string | null; fallback_id: string | null; all_allowed: boolean };
  budgets: Budgets;
}

const db = supabase as any;
const ALWAYS_ON = new Set(['/profile']);
const TRI_OPTS = [{ value: 'inherit', label: 'Inherit' }, { value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }];
const triOf = (o: boolean | null): Tri => (o == null ? 'inherit' : o ? 'allow' : 'deny');
function computeEffective(row: Pick<CapRow, 'kind' | 'key' | 'role_default' | 'org_override' | 'user_override'>, isSuper: boolean) {
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
  const [preview, setPreview] = useState(true);
  const [monthly, setMonthly] = useState(''); const [daily, setDaily] = useState('');
  const [tokenLimit, setTokenLimit] = useState(''); const [rpm, setRpm] = useState(''); const [rpd, setRpd] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  const load = useCallback(async () => {
    if (!actor?.id) return;
    setLoading(true); setError(null);
    const { data: res, error: err } = await db.rpc('get_user_access', { p_actor_id: actor.id, p_actor_email: actor.email, p_target_user_id: userId });
    if (err) { setError(err.message); setLoading(false); return; }
    const d = res as AccessData;
    setData(d);
    setMonthly(d.budgets.monthly_usd?.toString() ?? ''); setDaily(d.budgets.daily_usd?.toString() ?? '');
    setTokenLimit(d.budgets.token_limit?.toString() ?? ''); setRpm(d.budgets.rpm?.toString() ?? ''); setRpd(d.budgets.rpd?.toString() ?? '');
    setLoading(false);
  }, [actor?.id, actor?.email, userId]);
  useEffect(() => { load(); }, [load]);

  const isSuper = data?.is_super_admin ?? false;
  const pages = useMemo(() => (data?.capabilities ?? []).filter((c) => c.kind === 'page'), [data]);
  const features = useMemo(() => (data?.capabilities ?? []).filter((c) => c.kind === 'feature'), [data]);

  const setOverride = async (row: CapRow, tri: Tri) => {
    if (!actor?.id || !data) return;
    const allowed = tri === 'inherit' ? null : tri === 'allow';
    setData((prev) => {
      if (!prev) return prev;
      const caps = prev.capabilities.map((c) => {
        if (c.key !== row.key) return c;
        const next = { ...c, user_override: allowed };
        return { ...next, effective: computeEffective(next, prev.is_super_admin) };
      });
      return { ...prev, capabilities: caps };
    });
    const { error: err } = await db.rpc('admin_set_capability', { p_actor_id: actor.id, p_actor_email: actor.email, p_scope: 'user', p_scope_id: data.user_id, p_capability_key: row.key, p_allowed: allowed });
    if (err) { toast.error(err.message); load(); }
    else toast.success(`${row.label}: ${tri === 'inherit' ? 'inheriting default' : tri === 'allow' ? 'allowed' : 'denied'}`);
  };

  const saveModels = async (next: { allowed_ids?: string[]; default_id?: string | null; fallback_id?: string | null }) => {
    if (!actor?.id || !data) return;
    const allowed_ids = next.allowed_ids ?? data.models.allowed_ids;
    const default_id = next.default_id !== undefined ? next.default_id : data.models.default_id;
    const fallback_id = next.fallback_id !== undefined ? next.fallback_id : data.models.fallback_id;
    setData((prev) => prev ? { ...prev, models: { ...prev.models, allowed_ids, default_id, fallback_id, all_allowed: allowed_ids.length === 0 } } : prev);
    const { error: err } = await db.rpc('admin_set_user_models', { p_actor_id: actor.id, p_actor_email: actor.email, p_target_user_id: data.user_id, p_allowed_model_ids: allowed_ids, p_default_model_id: default_id, p_fallback_model_id: fallback_id });
    if (err) { toast.error(err.message); load(); } else toast.success('AI models updated');
  };
  const toggleModel = (id: string, checked: boolean) => {
    if (!data) return;
    const set = new Set(data.models.allowed_ids);
    checked ? set.add(id) : set.delete(id);
    saveModels({ allowed_ids: Array.from(set) });
  };

  const saveBudgets = async () => {
    if (!actor?.id || !data) return;
    setSavingBudget(true);
    const numOrNull = (s: string) => { const t = s.trim(); return t === '' ? null : Number(t); };
    try {
      const m = await db.rpc('admin_set_user_budget', { p_actor_id: actor.id, p_actor_email: actor.email, p_target_user_id: data.user_id, p_period: 'monthly', p_budget_usd: numOrNull(monthly), p_token_limit: numOrNull(tokenLimit), p_rpm: numOrNull(rpm), p_rpd: null });
      if (m.error) throw m.error;
      const d = await db.rpc('admin_set_user_budget', { p_actor_id: actor.id, p_actor_email: actor.email, p_target_user_id: data.user_id, p_period: 'daily', p_budget_usd: numOrNull(daily), p_token_limit: null, p_rpm: null, p_rpd: numOrNull(rpd) });
      if (d.error) throw d.error;
      toast.success('Budgets & limits saved'); load();
    } catch (e: any) { toast.error(e?.message ?? 'Failed to save budgets'); }
    finally { setSavingBudget(false); }
  };

  const modelsByProvider = useMemo(() => {
    const groups = new Map<string, ModelCatalogItem[]>();
    for (const m of data?.models.catalog ?? []) { const k = m.provider_name ?? 'Other'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(m); }
    return Array.from(groups.entries());
  }, [data]);

  const title = data ? data.name || data.email || 'User access' : 'User access';
  const subtitle = data ? (
    <span className="inline-flex items-center gap-2">
      <span>{data.email}</span>
      <MonoChip>{data.role.replace('_', ' ')}</MonoChip>
      {data.is_super_admin && <span className="inline-flex items-center gap-1 rounded-sm bg-[#bf2330]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#bf2330]"><ShieldCheck className="h-3 w-3" /> super admin</span>}
    </span>
  ) : 'Loading…';

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title={title}
      subtitle={subtitle}
      /* The one admin screen with a real parent route, so it gets the header's
         own back affordance below `md` (spec §4.1) instead of a third text
         button competing with the title for a 390px row. The desktop Back
         button is unchanged - `md:contents` hands it straight back to the
         actions flex row above the breakpoint. */
      onBack={() => navigate('/admin/users')}
      backLabel="Back to users"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-sm" onClick={() => setPreview((p) => !p)}>
            {preview ? <EyeOff className="mr-1 h-4 w-4" /> : <Eye className="mr-1 h-4 w-4" />}{preview ? 'Hide preview' : 'Preview as user'}
          </Button>
          <span className="hidden md:contents">
            <Button variant="outline" size="sm" className="rounded-sm" onClick={() => navigate('/admin/users')}><ArrowLeft className="mr-1 h-4 w-4" /> Back</Button>
          </span>
        </div>
      }
    >
      {loading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="rounded-sm border border-[#bf2330]/40 bg-[#bf2330]/10 p-4 text-sm text-[#bf2330]">{error}</div>
      ) : !data ? null : (
        <div className={`grid gap-5 ${preview ? 'md:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
          <div className="space-y-4">
            <Section title="Pages"><CapMatrix rows={pages} isSuper={isSuper} onSet={setOverride} /></Section>
            <Section title="Features"><CapMatrix rows={features} isSuper={isSuper} onSet={setOverride} /></Section>

            <Section title="AI models" badge={isSuper ? 'All enabled' : data.models.all_allowed ? 'No restriction' : undefined}>
              <div className="space-y-4">
                {modelsByProvider.map(([provider, models]) => (
                  <div key={provider}>
                    <div className={`${KX} mb-1.5`}>{provider}</div>
                    <div className="space-y-1">
                      {models.map((m) => (
                        <label key={m.id} className="flex min-h-11 items-center gap-2.5 rounded-sm px-1 py-1 text-sm hover:bg-[#fafafa] md:min-h-0">
                          <Checkbox
                            // Spec 2.4. The 44px label around this is inert — it wraps a
                            // Radix button, not an input, so clicking the row text toggles
                            // nothing (measured). Below md the control itself becomes the
                            // 44x44 target, the negative margin hands the space back, and
                            // the 16x16 box is redrawn as a ::before so nothing moves.
                            // md: hides the pseudo box and restores the primitive's own
                            // geometry and fill exactly.
                            className={cn(
                              'relative -m-[14px] h-11 w-11 rounded-none border-0 bg-transparent',
                              "before:absolute before:left-1/2 before:top-1/2 before:h-4 before:w-4 before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-sm before:border before:border-primary before:content-['']",
                              'data-[state=checked]:bg-transparent data-[state=checked]:before:bg-primary',
                              '[&>span]:relative [&>span]:z-[1]',
                              'md:static md:m-0 md:block md:h-4 md:w-4 md:rounded-sm md:border md:border-primary md:before:hidden',
                              'md:data-[state=checked]:bg-primary md:[&>span]:static md:[&>span]:z-auto',
                            )}
                            checked={data.models.allowed_ids.includes(m.id)}
                            disabled={isSuper}
                            onCheckedChange={(v) => toggleModel(m.id, !!v)}
                          />
                          <span>{m.display_name}</span>
                          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{m.code}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="my-4 h-px bg-[--hair-border]" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] [&>*]:min-w-0">
                <div>
                  <Label className="text-xs">Default model</Label>
                  <Select value={data.models.default_id ?? 'none'} onValueChange={(v) => saveModels({ default_id: v === 'none' ? null : v })}>
                    <SelectTrigger className="mt-1 rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent><SelectItem value="none" className="min-h-11 md:min-h-0">—</SelectItem>{data.models.catalog.map((m) => <SelectItem key={m.id} value={m.id} className="min-h-11 md:min-h-0">{m.display_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Fallback model</Label>
                  <Select value={data.models.fallback_id ?? 'none'} onValueChange={(v) => saveModels({ fallback_id: v === 'none' ? null : v })}>
                    <SelectTrigger className="mt-1 rounded-sm"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent><SelectItem value="none" className="min-h-11 md:min-h-0">—</SelectItem>{data.models.catalog.map((m) => <SelectItem key={m.id} value={m.id} className="min-h-11 md:min-h-0">{m.display_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </Section>

            <Section title="Budgets & limits">
              <div className="mb-4 grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2.5 md:grid-cols-[repeat(4,minmax(0,1fr))]">
                <UsageStat label="Cost MTD" value={`$${data.budgets.mtd_cost_usd.toFixed(2)}`} cap={data.budgets.monthly_usd != null ? `of $${data.budgets.monthly_usd.toFixed(2)}` : undefined} over={data.budgets.monthly_usd != null && data.budgets.mtd_cost_usd >= data.budgets.monthly_usd} />
                <UsageStat label="Cost today" value={`$${data.budgets.today_cost_usd.toFixed(2)}`} cap={data.budgets.daily_usd != null ? `of $${data.budgets.daily_usd.toFixed(2)}` : undefined} over={data.budgets.daily_usd != null && data.budgets.today_cost_usd >= data.budgets.daily_usd} />
                <UsageStat label="Req MTD" value={data.budgets.mtd_requests.toLocaleString()} />
                <UsageStat label="Req today" value={data.budgets.today_requests.toLocaleString()} cap={data.budgets.rpd != null ? `of ${data.budgets.rpd}` : undefined} over={data.budgets.rpd != null && data.budgets.today_requests >= data.budgets.rpd} />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))] [&>*]:min-w-0">
                <Field label="Monthly budget (USD)" value={monthly} set={setMonthly} placeholder="e.g. 25.00" />
                <Field label="Daily budget (USD)" value={daily} set={setDaily} placeholder="e.g. 2.00" />
                <Field label="Monthly token limit" value={tokenLimit} set={setTokenLimit} />
                <Field label="Requests / min" value={rpm} set={setRpm} />
                <Field label="Requests / day" value={rpd} set={setRpd} />
              </div>
              <div className="mt-4 flex justify-end">
                <Button className="rounded-sm" onClick={saveBudgets} disabled={savingBudget}>{savingBudget && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save budgets & limits</Button>
              </div>
            </Section>
          </div>

          {preview && <PreviewPanel data={data} />}
        </div>
      )}
    </AdminLayout>
  );
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section className={`${SURFACE} p-4`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {badge && <MonoChip tone="solid">{badge}</MonoChip>}
      </div>
      {children}
    </section>
  );
}

function CapMatrix({ rows, isSuper, onSet }: { rows: CapRow[]; isSuper: boolean; onSet: (row: CapRow, tri: Tri) => void }) {
  return (
    <div className="divide-y divide-[--hair-divider]">
      {rows.map((row) => {
        const locked = ALWAYS_ON.has(row.key);
        return (
          <div key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 md:gap-y-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">{row.label}{locked && <Lock className="h-3 w-3 text-muted-foreground" />}</div>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-[#a3a3a3]">default {row.role_default ? 'allow' : 'deny'}</span>
            {locked || isSuper ? (
              <span className="w-full text-right text-[11px] text-muted-foreground sm:w-[210px]">{locked ? 'Always available' : 'Full access'}</span>
            ) : (
              <Segmented value={triOf(row.user_override)} options={TRI_OPTS} onChange={(v) => onSet(row, v as Tri)} />
            )}
            <span className="w-[52px] text-right">
              <StatusDot tone={row.effective ? 'active' : 'neutral'} label={row.effective ? 'On' : 'Off'} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function UsageStat({ label, value, cap, over }: { label: string; value: string; cap?: string; over?: boolean }) {
  return (
    <div className="rounded-sm border border-[--hair-border] px-3 py-2">
      <div className={KX}>{label}</div>
      <div className={`mt-1 text-sm font-semibold ${over ? 'text-[#bf2330]' : ''}`}>{value}</div>
      {cap && <div className="text-[11px] text-muted-foreground">{cap}</div>}
    </div>
  );
}

function Field({ label, value, set, placeholder }: { label: string; value: string; set: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className="mt-1 min-h-11 rounded-sm font-mono md:min-h-0" />
    </div>
  );
}

function PreviewPanel({ data }: { data: AccessData }) {
  const pages = data.capabilities.filter((c) => c.kind === 'page' && c.effective);
  const features = data.capabilities.filter((c) => c.kind === 'feature' && c.effective);
  return (
    <aside className={`${SURFACE} h-fit p-4 md:sticky md:top-16`}>
      <div className="mb-2.5 flex items-center gap-2">
        <Eye className="h-4 w-4 text-[#bf2330]" />
        <h3 className="text-[13px] font-semibold">Preview as {data.name || data.email}</h3>
      </div>
      <p className="mb-3.5 text-[11.5px] leading-relaxed text-[--ledger-quiet]">The navigation and abilities this user sees on their next login.</p>
      <div className={`${KX} mb-2`}>Navigation</div>
      <div className="mb-4 space-y-1">
        {pages.length === 0 ? <div className="text-xs text-muted-foreground">No pages</div> : pages.map((p) => (
          <div key={p.key} className="flex items-center gap-2 rounded-sm bg-[#f7f7f7] px-2 py-1 text-xs"><Check className="h-3 w-3 text-[#14b8c4]" />{p.label}</div>
        ))}
      </div>
      <div className={`${KX} mb-2`}>Features</div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {features.length === 0 ? <div className="text-xs text-muted-foreground">No features</div> : features.map((f) => <MonoChip key={f.key}>{f.label}</MonoChip>)}
      </div>
      <div className={`${KX} mb-2`}>AI models</div>
      <div className="flex flex-wrap gap-1.5">
        {data.models.all_allowed ? <MonoChip>All enabled models</MonoChip> : data.models.allowed_ids.length === 0 ? <div className="text-xs text-muted-foreground">None</div> : data.models.catalog.filter((m) => data.models.allowed_ids.includes(m.id)).map((m) => <MonoChip key={m.id}>{m.display_name}</MonoChip>)}
      </div>
    </aside>
  );
}
