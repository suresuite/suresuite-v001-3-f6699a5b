import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface UserRow {
  user_id: string;
  name: string | null;
  email: string | null;
}

interface AiModel {
  id: string;
  code: string;
  display_name: string;
  enabled: boolean;
}

interface Props {
  user: UserRow;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const db = supabase as any;

export function UserAiConfigDrawer({ user, open, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<AiModel[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [fallbackModel, setFallbackModel] = useState<string>('');
  const [monthlyBudget, setMonthlyBudget] = useState<string>('');
  const [dailyBudget, setDailyBudget] = useState<string>('');
  const [rpm, setRpm] = useState<string>('');
  const [rpd, setRpd] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [modelsRes, permRes, budgetsRes] = await Promise.all([
        db.from('ai_models').select('id,code,display_name,enabled').eq('enabled', true).order('display_name'),
        db.from('user_ai_permissions').select('*').eq('user_id', user.user_id).maybeSingle(),
        db.from('ai_budgets').select('*').eq('scope', 'user').eq('scope_id', user.user_id),
      ]);
      if (cancelled) return;
      setModels((modelsRes.data ?? []) as AiModel[]);
      const perm = permRes.data;
      if (perm) {
        setAllowed(new Set((perm.allowed_model_ids ?? []) as string[]));
        setDefaultModel(perm.default_model_id ?? '');
        setFallbackModel(perm.fallback_model_id ?? '');
      } else {
        setAllowed(new Set());
        setDefaultModel('');
        setFallbackModel('');
      }
      const budgets = (budgetsRes.data ?? []) as any[];
      const monthly = budgets.find((b) => b.period === 'monthly');
      const daily = budgets.find((b) => b.period === 'daily');
      setMonthlyBudget(monthly?.budget_usd?.toString() ?? '');
      setDailyBudget(daily?.budget_usd?.toString() ?? '');
      setRpm(monthly?.rpm?.toString() ?? daily?.rpm?.toString() ?? '');
      setRpd(daily?.rpd?.toString() ?? '');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user.user_id]);

  const toggleModel = (id: string, checked: boolean) => {
    const next = new Set(allowed);
    if (checked) next.add(id);
    else next.delete(id);
    setAllowed(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const permPayload = {
        user_id: user.user_id,
        allowed_model_ids: Array.from(allowed),
        default_model_id: defaultModel || null,
        fallback_model_id: fallbackModel || null,
      };
      const { error: pErr } = await db
        .from('user_ai_permissions')
        .upsert(permPayload, { onConflict: 'user_id' });
      if (pErr) throw pErr;

      const upsertBudget = async (period: 'monthly' | 'daily', budget: string) => {
        const val = budget.trim();
        if (!val) {
          await db
            .from('ai_budgets')
            .delete()
            .eq('scope', 'user')
            .eq('scope_id', user.user_id)
            .eq('period', period);
          return;
        }
        await db.from('ai_budgets').upsert(
          {
            scope: 'user',
            scope_id: user.user_id,
            period,
            budget_usd: Number(val),
            rpm: period === 'monthly' && rpm ? Number(rpm) : null,
            rpd: period === 'daily' && rpd ? Number(rpd) : null,
          },
          { onConflict: 'scope,scope_id,period' }
        );
      };
      await upsertBudget('monthly', monthlyBudget);
      await upsertBudget('daily', dailyBudget);

      await db.rpc('log_admin_action', {
        p_action: 'user.ai_config_update',
        p_target_type: 'approved_users',
        p_target_id: user.user_id,
        p_before: null,
        p_after: permPayload,
      });

      toast.success('AI config saved');
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configure AI access</SheetTitle>
          <SheetDescription>
            {user.name || user.email} — models, budgets, and rate limits
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <section>
              <h4 className="mb-2 text-sm font-medium">Allowed models</h4>
              <p className="mb-3 text-xs text-muted-foreground">
                If none are checked, all enabled models are allowed by default.
              </p>
              <div className="space-y-2">
                {models.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allowed.has(m.id)}
                      onCheckedChange={(v) => toggleModel(m.id, !!v)}
                    />
                    <span>{m.display_name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{m.code}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Default model</Label>
                <Select value={defaultModel} onValueChange={setDefaultModel}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Fallback model</Label>
                <Select value={fallbackModel} onValueChange={setFallbackModel}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-sm font-medium">Budgets & limits</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Monthly budget (USD)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(e.target.value)}
                    placeholder="e.g. 25.00"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Daily budget (USD)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    placeholder="e.g. 2.00"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Requests / min</Label>
                  <Input
                    type="number"
                    value={rpm}
                    onChange={(e) => setRpm(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Requests / day</Label>
                  <Input
                    type="number"
                    value={rpd}
                    onChange={(e) => setRpd(e.target.value)}
                    className="mt-1"
                  />
                </div>
              </div>
            </section>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
