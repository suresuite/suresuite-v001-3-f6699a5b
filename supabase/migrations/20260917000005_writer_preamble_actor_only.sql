-- =====================================================================
-- WP 4.1 — the writer preamble carries the ACTOR and not a role
--                                                    (Phase 4 / G4 / §11)
--
-- `20260917000003`'s `assert_writer_may_act` did three things: refuse a NULL
-- actor, set `app.current_user_id` LOCAL, and refuse a caller below project
-- role `editor`. The first two are D36. **The third was a live narrowing that
-- no exit check asked for, and it comes out.**
--
-- WHY, precisely, because "it seemed safer" is how a regression ships:
--
--   * `effective_project_role` grants `owner` to a SUPER admin and to nobody
--     else by role — `is_super_admin` reads `role = 'super_admin'`. An
--     ORGANIZATION admin (`role = 'admin'`) who is not a member of the project
--     resolves to NULL, which ranks below `viewer`.
--   * `combine-project` has always permitted exactly that user: its own check
--     is `modeler_id = user_id OR role = 'admin'`. So the role gate would have
--     refused the ETL, from the DataManager button, for a class of user who can
--     run it today — silently, as a `insufficient_privilege` from a function
--     they have never heard of.
--   * The one precedent for this exact class of fix added no gate.
--     `assign_material_supplier` (`20260916000021`) is the sibling /policies
--     writer WP 3.3 closed for D36: it sets the GUC and checks no role.
--   * The role gate on `ingest_apply_run` is not a counter-example. §10 asked
--     for it in as many words — "promotion by an analyst is refused" — and
--     WP 3.4 REPLACED `has_project_access` with it rather than adding a second
--     authority, because two authorities for one question is `single-source`
--     broken in the governance plane. §11 asks for no such check here, and
--     adding one on TOP of each function's existing authorization is precisely
--     the second authority WP 3.4 declined to create.
--
-- SO THE RPCs AUTHENTICATE AND DO NOT AUTHORIZE, and each caller keeps the
-- authorization it already had. That is not a claim that the current
-- authorization is right: it is D66 — `min_project_role` is declared on all 37
-- tables and read by nothing, and the live answer to "may this person touch
-- this project" is still a reachability test in RLS beside a membership rank
-- used almost nowhere. Enforcing it is WP 6.2's, per table, with tests. An
-- ad-hoc partial enforcement on four RPCs would have been one more divergence
-- in the plane whose divergences that package exists to close.
--
-- ITS OWN MIGRATION because `20260917000003` is APPLIED — see
-- `20260917000004`'s header for why an edit would have gone unnoticed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.assert_writer_may_act(
  _fn            text,
  _project_id    uuid,
  _actor_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- `audit-actor` (G4) as a CONSTRAINT rather than an intention. A write that
  -- cannot name who made it is refused here rather than recorded as
  -- `actor_known: false` downstream.
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION '%: this write must name its actor (invariant audit-actor)', _fn
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF _project_id IS NULL THEN
    RAISE EXCEPTION '%: this write must name its project', _fn
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- LOCAL — `true` — so it belongs to THIS transaction and cannot leak onto the
  -- next caller of a pooled connection. It is also what makes
  -- `has_project_access()` answer for the named actor rather than for whoever
  -- the connection last belonged to, so the RLS the callers already rely on is
  -- evaluated against the right person.
  PERFORM set_config('app.current_user_id', _actor_user_id::text, true);
END; $fn$;

REVOKE ALL ON FUNCTION public.assert_writer_may_act(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_writer_may_act(text,uuid,uuid) TO service_role;

SELECT pg_notify('pgrst', 'reload schema');
