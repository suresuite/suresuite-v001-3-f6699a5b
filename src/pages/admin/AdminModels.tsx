import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { TableEmpty, TableLoading, TableShell, TH_DENSE } from '@/components/shared';
import { toast } from 'sonner';

interface Props {
  isCollapsed: boolean;
  setIsCollapsed: (v: boolean) => void;
}

interface Provider {
  id: string;
  code: string;
  display_name: string;
  enabled: boolean;
}
interface Model {
  id: string;
  provider_id: string | null;
  code: string;
  display_name: string;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  max_context: number;
  enabled: boolean;
}

const db = supabase as any;
const empty: Omit<Model, 'id'> = {
  provider_id: null,
  code: '',
  display_name: '',
  input_cost_per_1k: 0,
  output_cost_per_1k: 0,
  max_context: 128000,
  enabled: true,
};

export default function AdminModels({ isCollapsed, setIsCollapsed }: Props) {
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

  useEffect(() => {
    load();
  }, []);

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
    toast.success('Model added');
    setDraft({ ...empty });
    setOpen(false);
    load();
  };

  return (
    <AdminLayout
      isCollapsed={isCollapsed}
      setIsCollapsed={setIsCollapsed}
      title="AI Models"
      description="Providers, model catalog, and per-1k-token pricing used for cost accounting."
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-4 w-4" /> Add model
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add AI model</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Provider</Label>
                <Select
                  value={draft.provider_id ?? ''}
                  onValueChange={(v) => setDraft({ ...draft, provider_id: v || null })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Code (e.g. openai/gpt-5.5)</Label>
                <Input
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div className="col-span-2">
                <Label>Display name</Label>
                <Input
                  value={draft.display_name}
                  onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Input $/1k</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={draft.input_cost_per_1k}
                  onChange={(e) =>
                    setDraft({ ...draft, input_cost_per_1k: Number(e.target.value) })
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Output $/1k</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={draft.output_cost_per_1k}
                  onChange={(e) =>
                    setDraft({ ...draft, output_cost_per_1k: Number(e.target.value) })
                  }
                  className="mt-1"
                />
              </div>
              <div className="col-span-2">
                <Label>Max context</Label>
                <Input
                  type="number"
                  value={draft.max_context}
                  onChange={(e) =>
                    setDraft({ ...draft, max_context: Number(e.target.value) })
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <TableShell>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={TH_DENSE}>Model</TableHead>
              <TableHead className={TH_DENSE}>Code</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Input $/1k</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Output $/1k</TableHead>
              <TableHead className={`${TH_DENSE} text-right`}>Context</TableHead>
              <TableHead className={TH_DENSE}>Enabled</TableHead>
              <TableHead className={`${TH_DENSE} w-[80px]`}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoading colSpan={7} />
            ) : models.length === 0 ? (
              <TableEmpty colSpan={7} message="No models in the catalog yet." />
            ) : (
              models.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.display_name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{m.code}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(m.input_cost_per_1k).toFixed(4)}</TableCell>
                  <TableCell className="text-right tabular-nums">${Number(m.output_cost_per_1k).toFixed(4)}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.max_context.toLocaleString()}</TableCell>
                  <TableCell>
                    <Switch checked={m.enabled} onCheckedChange={() => toggle(m)} />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove(m)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableShell>
    </AdminLayout>
  );
}
