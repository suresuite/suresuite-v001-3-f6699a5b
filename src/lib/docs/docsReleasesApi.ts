/**
 * The manual's release settings and its Q&A, as the browser reaches them
 * (`20261001000002`).
 *
 * Readers: `docs_section_releases` is a table anyone may SELECT; the Q&A comes
 * only through `docs_list_faq`, which filters by audience in the database.
 * Super admins: the `admin_*` functions, each of which asserts an active super
 * admin and writes an `admin_audit_logs` row naming them. The actor is passed
 * explicitly because the browser calls as `anon` (§4 D155).
 */
import { supabase } from "@/integrations/supabase/client";
import { isDocsAudience, type DocsAudience, type DocsReleases } from "@/lib/ui/docsVisibility";

// The generated Supabase types predate these tables and functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function fetchDocsReleases(): Promise<DocsReleases> {
  const { data, error } = await db.from("docs_section_releases").select("section_key, audience");
  if (error) throw error;
  const out: DocsReleases = {};
  for (const row of (data ?? []) as { section_key: string; audience: unknown }[]) {
    if (isDocsAudience(row.audience)) out[row.section_key] = row.audience;
  }
  return out;
}

export type DocsFaqEntry = {
  id: string;
  question: string;
  answer: string;
  section_key: string | null;
  related_slugs: string[];
  sort_order: number;
  updated_at: string;
};

export type DocsFaqAdminEntry = DocsFaqEntry & {
  is_published: boolean;
  created_at: string;
  created_by: string | null;
  updated_by: string | null;
};

/** The answers this reader may see — published, and in sections open to them. */
export async function fetchDocsFaq(userId: string | null): Promise<DocsFaqEntry[]> {
  const { data, error } = await db.rpc("docs_list_faq", { p_user_id: userId });
  if (error) throw error;
  return (data ?? []) as DocsFaqEntry[];
}

export type Actor = { id: string; email: string };

export async function adminSetSectionAudience(actor: Actor, sectionKey: string, audience: DocsAudience) {
  const { error } = await db.rpc("admin_set_docs_section_audience", {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_section_key: sectionKey,
    p_audience: audience,
  });
  if (error) throw error;
}

export async function adminListFaq(actor: Actor): Promise<DocsFaqAdminEntry[]> {
  const { data, error } = await db.rpc("admin_list_docs_faq", {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
  });
  if (error) throw error;
  return (data ?? []) as DocsFaqAdminEntry[];
}

export type DocsFaqDraft = {
  id: string | null;
  question: string;
  answer: string;
  section_key: string | null;
  related_slugs: string[];
  sort_order: number;
  is_published: boolean;
};

export async function adminSaveFaq(actor: Actor, draft: DocsFaqDraft): Promise<string> {
  const { data, error } = await db.rpc("admin_save_docs_faq", {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_id: draft.id,
    p_question: draft.question,
    p_answer: draft.answer,
    p_section_key: draft.section_key,
    p_related_slugs: draft.related_slugs,
    p_sort_order: draft.sort_order,
    p_is_published: draft.is_published,
  });
  if (error) throw error;
  return data as string;
}

export async function adminDeleteFaq(actor: Actor, id: string) {
  const { error } = await db.rpc("admin_delete_docs_faq", {
    p_actor_id: actor.id,
    p_actor_email: actor.email,
    p_id: id,
  });
  if (error) throw error;
}
