// Documentation (/admin/docs) — who may read each section of the manual, and
// the questions and prepared answers on its Questions & answers page.
//
// Released SECTION BY SECTION (`20261001000002`, docsVisibility.ts):
//   Public        anyone, signed in or not
//   Internal      any signed-in user
//   Confidential  super admins, and users granted `docs_confidential`
// Every write goes through an admin_* function that asserts an active super
// admin and writes an admin_audit_logs row naming them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useCapabilities } from '@/hooks/useCapabilities';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { AdminSection, MonoChip, Segmented, SURFACE, TD, TH, ROW_HOVER, Toggle } from '@/components/admin/adminUi';
import { FROZEN_CELL, FROZEN_CELL_ON_TINT } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DOC_GROUPS, getPage } from '@/components/docs/registry';
import {
  DOCS_AUDIENCES, sectionAudience, type DocsAudience,
} from '@/lib/ui/docsVisibility';
import {
  adminDeleteFaq, adminListFaq, adminSaveFaq, adminSetSectionAudience,
  type DocsFaqAdminEntry, type DocsFaqDraft,
} from '@/lib/docs/docsReleasesApi';

interface Props { isCollapsed: boolean; setIsCollapsed: (v: boolean) => void; }

const AUDIENCE_OPTIONS = DOCS_AUDIENCES.map((a) => ({ value: a.value, label: a.label }));
const NO_SECTION = '';

const EMPTY_DRAFT: DocsFaqDraft = {
  id: null, question: '', answer: '', section_key: null, related_slugs: [], sort_order: 0, is_published: false,
};

function groupTitle(key: string | null) {
  if (!key) return 'General';
  return DOC_GROUPS.find((g) => g.key === key)?.group ?? key;
}

export default function AdminDocs({ isCollapsed, setIsCollapsed }: Props) {
  const { user: actor } = useAuth();
  const { docs } = useCapabilities();
  const [faq, setFaq] = useState<DocsFaqAdminEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DocsFaqDraft | null>(null);
  const [relatedText, setRelatedText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<DocsFaqAdminEntry | null>(null);

  const load = useCallback(async () => {
    if (!actor?.id) return;
    setLoading(true); setError(null);
    try {
      const [rows] = await Promise.all([
        adminListFaq({ id: actor.id, email: actor.email }),
        docs.refresh(),
      ]);
      setFaq(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- docs.refresh is stable
  }, [actor?.id, actor?.email]);
  useEffect(() => { load(); }, [load]);

  const setAudience = async (sectionKey: string, audience: DocsAudience) => {
    if (!actor?.id) return;
    setSavingKey(sectionKey);
    try {
      await adminSetSectionAudience({ id: actor.id, email: actor.email }, sectionKey, audience);
      await docs.refresh();
      const label = DOCS_AUDIENCES.find((a) => a.value === audience)?.label ?? audience;
      toast.success(`${groupTitle(sectionKey)}: ${label}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  const openEditor = (entry: DocsFaqAdminEntry | null) => {
    const d: DocsFaqDraft = entry
      ? {
          id: entry.id, question: entry.question, answer: entry.answer, section_key: entry.section_key,
          related_slugs: entry.related_slugs ?? [], sort_order: entry.sort_order, is_published: entry.is_published,
        }
      : { ...EMPTY_DRAFT, sort_order: (faq.at(-1)?.sort_order ?? 0) + 10 };
    setDraft(d);
    setRelatedText(d.related_slugs.join(', '));
  };

  const relatedSlugs = useMemo(
    () => relatedText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    [relatedText],
  );
  const unknownSlugs = relatedSlugs.filter((s) => !getPage(s));

  const save = async () => {
    if (!actor?.id || !draft) return;
    if (!draft.question.trim() || !draft.answer.trim()) {
      toast.error('A question and an answer are both required.');
      return;
    }
    setSaving(true);
    try {
      await adminSaveFaq({ id: actor.id, email: actor.email }, { ...draft, related_slugs: relatedSlugs });
      toast.success(draft.id ? 'Answer updated' : 'Question added');
      setDraft(null);
      setFaq(await adminListFaq({ id: actor.id, email: actor.email }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const togglePublished = async (entry: DocsFaqAdminEntry, published: boolean) => {
    if (!actor?.id) return;
    setFaq((rows) => rows.map((r) => (r.id === entry.id ? { ...r, is_published: published } : r)));
    try {
      await adminSaveFaq({ id: actor.id, email: actor.email }, {
        id: entry.id, question: entry.question, answer: entry.answer, section_key: entry.section_key,
        related_slugs: entry.related_slugs ?? [], sort_order: entry.sort_order, is_published: published,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      load();
    }
  };

  const confirmDelete = async () => {
    if (!actor?.id || !deleting) return;
    try {
      await adminDeleteFaq({ id: actor.id, email: actor.email }, deleting.id);
      setFaq((rows) => rows.filter((r) => r.id !== deleting.id));
      toast.success('Question deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<DocsAudience, number> = { public: 0, internal: 0, confidential: 0 };
    for (const g of DOC_GROUPS) c[sectionAudience(docs.releases, g.key)]++;
    return c;
  }, [docs.releases]);

  return (
    <AdminLayout
      isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} title="Documentation"
      onRefresh={load} refreshLoading={loading}
    >
      {loading ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="rounded-sm border border-[#bf2330]/40 bg-[#bf2330]/10 p-4 text-sm text-[#bf2330]">{error}</div>
      ) : (
        <div className="space-y-5">
          <AdminSection
            title="Who can read each section"
            badge={`${counts.public} public · ${counts.internal} internal · ${counts.confidential} confidential`}
          >
            <div className="mb-3 space-y-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {DOCS_AUDIENCES.map((a) => (
                <p key={a.value}><span className="font-medium text-foreground">{a.label}</span> — {a.description}</p>
              ))}
              <p>
                Grant Confidential access to a role on{' '}
                <Link to="/admin/roles" className="text-primary hover:underline">Role Defaults</Link>{' '}
                (feature <span className="font-mono">Confidential Documentation</span>), or to one person on their page under{' '}
                <Link to="/admin/users" className="text-primary hover:underline">Users</Link>.
                Page text ships with the app, so an audience decides what a reader is shown, not what can be downloaded.
              </p>
            </div>
            <div className={`${SURFACE} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead><tr>
                    <th className={`${TH} ${FROZEN_CELL_ON_TINT} w-[52%]`}>Section</th>
                    <th className={TH}>Pages</th>
                    <th className={TH}>Audience</th>
                  </tr></thead>
                  <tbody>
                    {DOC_GROUPS.map((g) => {
                      const audience = sectionAudience(docs.releases, g.key);
                      const first = g.pages.find((p) => p.status === 'live') ?? g.pages[0];
                      return (
                        <tr key={g.key} className={ROW_HOVER}>
                          <td className={`${TD} ${FROZEN_CELL}`}>
                            <div className="flex items-center gap-1.5 text-[13px] font-medium">
                              <span className="tabular-nums text-muted-foreground">{g.section}</span>
                              {g.group}
                              <Link to={`/docs/${first.slug}`} target="_blank" aria-label={`Open ${g.group}`} className="text-muted-foreground hover:text-foreground">
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                            </div>
                            <div className="text-[11.5px] text-muted-foreground">{g.blurb}</div>
                          </td>
                          <td className={`${TD} text-[12.5px] tabular-nums text-muted-foreground`}>{g.pages.length}</td>
                          <td className={TD}>
                            <div className="flex items-center gap-2">
                              <Segmented
                                value={audience}
                                options={AUDIENCE_OPTIONS}
                                onChange={(v) => v !== audience && setAudience(g.key, v as DocsAudience)}
                              />
                              {savingKey === g.key && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Questions & answers" badge={`${faq.filter((f) => f.is_published).length} of ${faq.length} published`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                Shown on <Link to="/docs/questions" className="text-primary hover:underline">/docs/questions</Link> to
                whoever may read the Questions &amp; answers section. An answer tied to a section is shown only to readers
                of that section too. Answers are Markdown; link to the page that owns a fact
                (<span className="font-mono">[Known limits](/docs/known-limits)</span>) rather than copying it, so the answer
                cannot fall out of date with the page.
              </p>
              <Button size="sm" onClick={() => openEditor(null)}><Plus className="mr-1 h-3.5 w-3.5" /> Add question</Button>
            </div>
            <div className={`${SURFACE} overflow-hidden`}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead><tr>
                    <th className={`${TH} ${FROZEN_CELL_ON_TINT} w-[56%]`}>Question</th>
                    <th className={TH}>About</th>
                    <th className={`${TH} text-center`}>Published</th>
                    <th className={TH}><span className="sr-only">Actions</span></th>
                  </tr></thead>
                  <tbody>
                    {faq.length === 0 && (
                      <tr><td colSpan={4} className={`${TD} text-center text-[12.5px] text-muted-foreground`}>No questions yet.</td></tr>
                    )}
                    {faq.map((f) => (
                      <tr key={f.id} className={ROW_HOVER}>
                        <td className={`${TD} ${FROZEN_CELL} text-[13px]`}>{f.question}</td>
                        <td className={TD}>
                          <MonoChip>{groupTitle(f.section_key)}</MonoChip>
                        </td>
                        <td className={`${TD} text-center`}>
                          <div className="flex justify-center">
                            <Toggle checked={f.is_published} onCheckedChange={(v) => togglePublished(f, v)} />
                          </div>
                        </td>
                        <td className={`${TD} whitespace-nowrap text-right`}>
                          <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" aria-label="Edit" onClick={() => openEditor(f)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-11 w-11 md:h-8 md:w-8" aria-label="Delete" onClick={() => setDeleting(f)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </AdminSection>
        </div>
      )}

      <Dialog open={draft != null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit question' : 'Add question'}</DialogTitle>
            <DialogDescription>Readers see the question and its answer on the Questions &amp; answers page.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="faq-question">Question</Label>
                <Input id="faq-question" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="faq-answer">Answer (Markdown)</Label>
                <Textarea id="faq-answer" rows={7} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="faq-section">About section</Label>
                  <select
                    id="faq-section"
                    className="h-11 w-full rounded-sm border border-input bg-background px-2 text-sm md:h-9"
                    value={draft.section_key ?? NO_SECTION}
                    onChange={(e) => setDraft({ ...draft, section_key: e.target.value || null })}
                  >
                    <option value={NO_SECTION}>General — no particular section</option>
                    {DOC_GROUPS.filter((g) => g.key !== 'questions').map((g) => (
                      <option key={g.key} value={g.key}>{g.section}. {g.group}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="faq-order">Order</Label>
                  <Input id="faq-order" type="number" value={draft.sort_order}
                    onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="faq-related">Related pages (slugs, comma-separated)</Label>
                <Input id="faq-related" value={relatedText} placeholder="known-limits, your-first-project"
                  onChange={(e) => setRelatedText(e.target.value)} />
                {unknownSlugs.length > 0 && (
                  <p className="text-[11.5px] text-[#bf2330]">No manual page is called: {unknownSlugs.join(', ')}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Toggle checked={draft.is_published} onCheckedChange={(v) => setDraft({ ...draft, is_published: v })} />
                <span className="text-[13px]">{draft.is_published ? 'Published' : 'Draft — only super admins see it here'}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting != null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this question?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.question} — this cannot be undone. Unpublishing it instead keeps the answer for later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
