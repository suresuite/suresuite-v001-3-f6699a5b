// AI Models (/admin/models) — SuReSuite "Ledger" redesign.
// Data flow unchanged (ai_providers / ai_models CRUD). Enabled uses the
// black-pill Toggle; codes render mono; delete is an inline red-hover icon.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SURFACE, TH, TD, ROW_HOVER, Toggle, EmptyRow, LoadingRow, useTableSort, useColumnFilters } from '@/components/admin/adminUi';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DIALOG_AS_SHEET } from '@/components/shared';
import { cn } from '@/lib/utils';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }
interface Provider { id: string; code: string; display_name: string; enabled: boolean; }
interface Model { id: string; provider_id: string | null; code: string; display_name: string; input_cost_per_1k: number; output_cost_per_1k: number; max_context: number; enabled: boolean; }

const db = supabase as any;
const empty: Omit<Model, 'id'> = { provider_id: null, code: '', display_name: '', input_cost_per_1k: 0, output_cost_per_1k: 0, max_context: 128000, enabled: true };

export default function AdminModels({ isCollapsed, setIsCollapsed }: Props) {
  const isMobile = useIsMobile();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Omit<Model, 'id'>>({ ...empty });

  const load = async () => {
    setLoading(true);
    const [p, m] = await Promise.all([
      db.from('ai_providers').select('*').order('display_name'),
      db.from('ai_models').select('*').order('display_name'),
    ]);
    setProviders((p.data ?? []) as Provider[]);
    setModels((m.data ?? []) as Model[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const toggle = async (row: Model) => {
    const next = !row.enabled;
    const { error } = await db.from('ai_models').update({ enabled: next }).eq('id', row.id);
    if (error) return toast.error(error.message);
    setModels((prev) => prev.map((m) => (m.id === row.id ? { ...m, enabled: next } : m)));
  };
  const remove = async (row: Model) => {
    if (!confirm(`Delete model ${row.code}?`)) return;
    const { error } = await db.from('ai_models').delete().eq('id', row.id);
    if (error) return toast.error(error.message);
    setModels((prev) => prev.filter((m) => m.id !== row.id));
  };
  const create = async () => {
    if (!draft.code || !draft.display_name) return toast.error('Code and name required');
    const { error } = await db.from('ai_models').insert(draft);
    if (error) return toast.error(error.message);
    toast.success('Model added'); setDraft({ ...empty }); setOpen(false); load();
  };

  const colFilterGetters = useMemo(() => ({
    name: (m: Model) => m.display_name, code: (m: Model) => m.code,
    inp: (m: Model) => String(m.input_cost_per_1k), out: (m: Model) => String(m.output_cost_per_1k), ctx: (m: Model) => String(m.max_context),
  }), []);
  const { filtered, FilterTH } = useColumnFilters(models, colFilterGetters);
  const sortGetters = useMemo(() => ({
    name: (m: Model) => m.display_name.toLowerCase(), code: (m: Model) => m.code.toLowerCase(),
    inp: (m: Model) => m.input_cost_per_1k, out: (m: Model) => m.output_cost_per_1k, ctx: (m: Model) => m.max_context, enabled: (m: Model) => (m.enabled ? 1 : 0),
  }), []);
  const { sorted, SortTH } = useTableSort(filtered, sortGetters);

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="AI Models"
      onRefresh={load} refreshLoading={loading}
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" className="rounded-sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Add model</Button></DialogTrigger>
          <DialogContent className={cn(DIALOG_AS_SHEET, 'md:max-w-lg md:rounded-sm')}>
            <DialogHeader><DialogTitle>Add AI model</DialogTitle></DialogHeader>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))] [&>*]:min-w-0">
              <div className="min-w-0 md:col-span-2">
                <Label className="text-xs">Provider</Label>
                <Select value={draft.provider_id ?? ''} onValueChange={(v) => setDraft({ ...draft, provider_id: v || null })}>
                  <SelectTrigger className="mt-1 rounded-sm"><SelectValue placeholder="Select provider" /></SelectTrigger>
                  <SelectContent>{providers.map((p) => <SelectItem key={p.id} value={p.id} className="min-h-11 md:min-h-0">{p.display_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0 md:col-span-2"><Label className="text-xs">Code (e.g. openai/gpt-5.5)</Label><Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className="mt-1 rounded-sm font-mono" /></div>
              <div className="min-w-0 md:col-span-2"><Label className="text-xs">Display name</Label><Input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} className="mt-1 rounded-sm" /></div>
              <div><Label className="text-xs">Input $/1k</Label><Input type="number" step="0.0001" value={draft.input_cost_per_1k} onChange={(e) => setDraft({ ...draft, input_cost_per_1k: Number(e.target.value) })} className="mt-1 rounded-sm font-mono" /></div>
              <div><Label className="text-xs">Output $/1k</Label><Input type="number" step="0.0001" value={draft.output_cost_per_1k} onChange={(e) => setDraft({ ...draft, output_cost_per_1k: Number(e.target.value) })} className="mt-1 rounded-sm font-mono" /></div>
              <div className="min-w-0 md:col-span-2"><Label className="text-xs">Max context</Label><Input type="number" value={draft.max_context} onChange={(e) => setDraft({ ...draft, max_context: Number(e.target.value) })} className="mt-1 rounded-sm font-mono" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" className="rounded-sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button className="rounded-sm" onClick={create}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      {isMobile ? (
        <div className={`${SURFACE} overflow-hidden`}>
          {loading ? (
            <div className="px-4 py-14 text-center text-[13px] text-muted-foreground">Loading…</div>
          ) : sorted.length === 0 ? (
            <div className="px-4 py-14 text-center text-[13px] text-muted-foreground">No models in the catalog yet.</div>
          ) : (
            sorted.map((m) => (
              <div key={m.id} className="border-b border-[--hair-divider] p-3 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{m.display_name}</span>
                  <span className="shrink-0"><Toggle checked={m.enabled} onCheckedChange={() => toggle(m)} /></span>
                </div>
                <div className="mt-1.5 break-words font-mono text-[11px] text-muted-foreground">{m.code}</div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-[3px] border border-[--zinc-border] px-1.5 py-px">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Input $/1k</span>
                    <span className="font-mono text-[11.5px] tabular-nums text-foreground">${Number(m.input_cost_per_1k).toFixed(4)}</span>
                  </span>
                  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-[3px] border border-[--zinc-border] px-1.5 py-px">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Output $/1k</span>
                    <span className="font-mono text-[11.5px] tabular-nums text-foreground">${Number(m.output_cost_per_1k).toFixed(4)}</span>
                  </span>
                  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-[3px] border border-[--zinc-border] px-1.5 py-px">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Context</span>
                    <span className="font-mono text-[11.5px] tabular-nums text-foreground">{m.max_context.toLocaleString()}</span>
                  </span>
                </div>
                <div className="mt-2.5 flex justify-end">
                  <button title="Delete" aria-label="Delete" className="grid h-11 w-11 place-items-center text-[#c98a8f] hover:text-[#bf2330]" onClick={() => remove(m)}>
                    <Trash2 className="h-[15px] w-[15px]" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
      <div className={`${SURFACE} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              <SortTH sortKey="name">Model</SortTH><SortTH sortKey="code">Code</SortTH>
              <SortTH sortKey="inp" align="right">Input $/1k</SortTH><SortTH sortKey="out" align="right">Output $/1k</SortTH>
              <SortTH sortKey="ctx" align="right">Context</SortTH><SortTH sortKey="enabled">Enabled</SortTH><th className={`${TH} w-[1%]`} />
            </tr>
            <tr>
              <FilterTH filterKey="name" /><FilterTH filterKey="code" />
              <FilterTH filterKey="inp" align="right" /><FilterTH filterKey="out" align="right" />
              <FilterTH filterKey="ctx" align="right" /><th className="border-b border-[--hair-border] bg-white" /><th className="border-b border-[--hair-border] bg-white" />
            </tr></thead>
            <tbody>
              {loading ? <LoadingRow colSpan={7} /> : sorted.length === 0 ? (
                <EmptyRow colSpan={7} message="No models in the catalog yet." />
              ) : sorted.map((m) => (
                <tr key={m.id} className={ROW_HOVER}>
                  <td className={`${TD} text-[13px] font-medium`}>{m.display_name}</td>
                  <td className={`${TD} font-mono text-[11.5px] text-muted-foreground`}>{m.code}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${Number(m.input_cost_per_1k).toFixed(4)}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>${Number(m.output_cost_per_1k).toFixed(4)}</td>
                  <td className={`${TD} text-right font-mono text-[12px] tabular-nums`}>{m.max_context.toLocaleString()}</td>
                  <td className={TD}><Toggle checked={m.enabled} onCheckedChange={() => toggle(m)} /></td>
                  <td className={`${TD} text-right`}>
                    <button title="Delete" aria-label="Delete" className="text-[#c98a8f] hover:text-[#bf2330]" onClick={() => remove(m)}><Trash2 className="h-[15px] w-[15px]" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </AdminLayout>
  );
}
