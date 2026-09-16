-- Phase 3 / WP 3.0 / §8.3 — `admin_org_file_usage` (D38, view 6 of 6).
--
-- THE ONE THAT NEEDED A POLICY FIRST, and the reason a single migration
-- flipping all six would have been wrong.
--
-- The view rolls up `user_files` per organization and `AdminUsage.tsx` reads it
-- as `authenticated`. `user_files` has exactly one policy —
-- `user_files_owner_read: user_id = get_current_user_id()`. Flip
-- `security_invoker` on alone and the admin usage page stops reporting the
-- organization's files and starts reporting the ADMIN'S OWN files, under
-- headings that say "org". Not an error, not an empty state: a wrong number
-- with a confident label, which is the §5 T1 failure this plan exists to end.
--
-- So the policy comes first. A super admin may read every file row — which is
-- what the page has been doing all along THROUGH the view, unstated. Writing it
-- as a policy makes the same access a declared rule on the table instead of an
-- accident of who owns the view.
DROP POLICY IF EXISTS user_files_super_read ON public.user_files;
CREATE POLICY user_files_super_read ON public.user_files
  FOR SELECT USING (public.current_is_super_admin());

-- AND THE GRANT GOES. `20260723000001` granted SELECT on this view to `anon`,
-- so an unauthenticated caller could read every organization's file count and
-- byte totals — organization NAMES included, through the join. With
-- `security_invoker` the grant is already inert (no policy admits `anon` to
-- `user_files`), and removing it says so rather than leaving a permission that
-- only fails at the second gate. This is not a change to D28: the seven tables
-- D28 names are untouched.
REVOKE SELECT ON public.admin_org_file_usage FROM anon;

ALTER VIEW public.admin_org_file_usage SET (security_invoker = true);
