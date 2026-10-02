-- Profile / §4 D276 — the ACCOUNT role is the ceiling and the PROJECT role is the grant; an
-- agent may not approve what its approver may not do by hand; and /admin/roles shows the
-- rule it is setting.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
--
-- The two-argument resolver (`capabilities_for_user(user, project)`) answered each key from
-- the FIRST layer with an opinion: person override → project role → organization → account
-- role → off. For the four keys the project layer decides (Run Simulations, Edit Input
-- Data, Edit Policies, Export) that made the project role a REPLACEMENT for the account
-- role, not a narrowing of it:
--
--   · a "User" account — whose /admin/roles column says Run Simulations and nothing else —
--     made Editor on a project held Edit Policies and Export there;
--   · the /admin/roles Features grid never said that four of its rows apply only where a
--     person holds no project role, so the switch an admin flipped was not the switch that
--     decided;
--   · `review_agent_proposal` and `agent-apply` read the ACCOUNT-wide answer
--     (`get_my_capabilities`), so a modeler who is a Viewer on a project could approve a
--     Policy Configurator bundle there — an edit the same person was refused by hand (the
--     gap D232 left open).
--
-- Asked for by the owner: "how could we reconcile the role in the project and feature
-- capability", then "approve your recommendation … make it strong and transparent in page
-- /admin/roles".
--
-- ── WHAT THIS CHANGES ────────────────────────────────────────────────────────
--
--   · `project_right_decide` — the RULE, as a pure function, so every reader applies the
--     same one: super admin → yes; a person override → its value; no project role → the
--     account's answer; otherwise project grant AND account answer. It also returns WHICH
--     of those decided, in words a page can show.
--   · `project_right_decisions(user, project)` — the rule's inputs for one person on one
--     project, per project-scoped key, plus its answer. The account's answer is the
--     organization layer (the PROJECT's organization, D231) and then the account role, as
--     before; it is now the CEILING rather than a fallback.
--   · `capabilities_for_user(user, project)` reads it for the project-scoped keys; every
--     other key is `20261001000004`'s chain, verbatim.
--   · `project_rights_for_user` returns `decisions` beside its answer, with the upload gate
--     and suspension named as deciders too, so /profile and the admin pages can say WHY.
--   · `agent_artifact_project_rights()` — which project right each agent artifact needs to
--     be approved (one VALUES list), and `agent_project_right_refusal` applies it.
--     `review_agent_proposal` refuses an approval the approver could not make by hand, and
--     `agent-apply` calls the same function before it executes.
--   · `get_role_access` returns, beside the account-role matrix: which keys are project
--     scoped, the project-role matrix, the EFFECTIVE matrix (account role × project role,
--     computed by `project_right_decide` — not re-authored in the page), the agent map,
--     the organization and person overrides on those keys, and every membership the
--     ceiling currently narrows.
--   · `admin_preview_role_capability` — before an admin flips an account-role switch on a
--     project-scoped key, the people and projects whose right would change.
--
-- ── WHAT IS NOT ──────────────────────────────────────────────────────────────
--
-- A person override on /admin/users/:userId still beats everything, project role included —
-- it is the one deliberate escape hatch, and /admin/roles now lists every one on these keys.
-- The project-role matrix stays a migration's to change (D232's shape), so the manual's role
-- table, generated from migrations, cannot drift from it; the page shows it read-only and
-- says so. The SERVER gates of D230 (`sim-command`, the policy and item-master RPCs) still
-- check no project role. The upload gate is unchanged.

-- ── 1 · the rule ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.project_right_decide(
  p_is_super      boolean,
  p_override      boolean,
  p_project_role  text,
  p_project_grant boolean,
  p_account       boolean)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_is_super, false)
      THEN jsonb_build_object('allowed', true,  'decided_by', 'super_admin')
    WHEN p_override IS NOT NULL
      THEN jsonb_build_object('allowed', p_override, 'decided_by', 'person_override')
    WHEN p_project_role IS NULL OR p_project_grant IS NULL
      THEN jsonb_build_object('allowed', COALESCE(p_account, false), 'decided_by', 'account_role')
    WHEN NOT p_project_grant
      THEN jsonb_build_object('allowed', false, 'decided_by', 'project_role')
    WHEN NOT COALESCE(p_account, false)
      THEN jsonb_build_object('allowed', false, 'decided_by', 'account_ceiling')
    ELSE jsonb_build_object('allowed', true,  'decided_by', 'project_role')
  END;
$$;
COMMENT ON FUNCTION public.project_right_decide(boolean, boolean, text, boolean, boolean) IS
  'D276 — the one rule for a project-scoped right: super admin → yes; a person override → '
  'its value; no project role → the account''s answer; otherwise the project grant AND the '
  'account''s answer (the account role is the ceiling). Returns {allowed, decided_by}. '
  'capabilities_for_user, project_rights_for_user, get_role_access and '
  'admin_preview_role_capability all read it.';

-- ── 2 · the rule's inputs for one person on one project ─────────────────────
CREATE OR REPLACE FUNCTION public.project_right_decisions(_user_id uuid, _project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role         text;
  v_org_id       uuid;
  v_is_super     boolean;
  v_project_role text;
  v_out          jsonb;
BEGIN
  SELECT au.role::text, au.organization_id INTO v_role, v_org_id
    FROM public.approved_users au WHERE au.id = _user_id;
  IF v_role IS NULL THEN RETURN '{}'::jsonb; END IF;
  -- D231 — the organization layer is the PROJECT's organization.
  SELECT COALESCE(p.organization_id, v_org_id) INTO v_org_id
    FROM public.projects p WHERE p.id = _project_id;
  v_is_super     := (v_role = 'super_admin');
  v_project_role := public.effective_project_role(_user_id, _project_id);

  SELECT COALESCE(jsonb_object_agg(k.key,
           jsonb_build_object(
             'project_role',    v_project_role,
             'project_grant',   x.grant_,
             'account_role',    v_role,
             'account_allows',  COALESCE(x.org_, x.role_, false),
             'account_source',  CASE WHEN x.org_ IS NOT NULL THEN 'organization'
                                     WHEN x.role_ IS NOT NULL THEN 'account_role'
                                     ELSE 'default' END,
             'person_override', x.user_)
           || public.project_right_decide(v_is_super, x.user_, v_project_role, x.grant_,
                                          COALESCE(x.org_, x.role_, false))), '{}'::jsonb)
    INTO v_out
    FROM (SELECT DISTINCT capability_key AS key FROM public.project_role_capabilities) k
    CROSS JOIN LATERAL (SELECT
      (SELECT uc.allowed  FROM public.user_capabilities uc
        WHERE uc.user_id = _user_id AND uc.capability_key = k.key)                AS user_,
      (SELECT prc.allowed FROM public.project_role_capabilities prc
        WHERE prc.project_role = v_project_role AND prc.capability_key = k.key)   AS grant_,
      (SELECT oc.allowed  FROM public.org_capabilities oc
        WHERE oc.org_id = v_org_id AND oc.capability_key = k.key)                 AS org_,
      (SELECT rc.allowed  FROM public.role_capabilities rc
        WHERE rc.role = v_role AND rc.capability_key = k.key)                     AS role_) x;
  RETURN v_out;
END; $$;
COMMENT ON FUNCTION public.project_right_decisions(uuid, uuid) IS
  'D276 — per project-scoped key, the inputs project_right_decide reads for one person on one '
  'project (project role and its grant, the account''s answer and where it came from, any '
  'person override) and its answer. Internal.';
REVOKE ALL ON FUNCTION public.project_right_decisions(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3 · the resolver reads the rule for the project-scoped keys ─────────────
CREATE OR REPLACE FUNCTION public.capabilities_for_user(_user_id uuid, _project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base         jsonb;
  v_role         text;
  v_org_id       uuid;
  v_is_super     boolean;
  v_project_role text;
  v_pages        jsonb;
  v_features     jsonb;
  v_decisions    jsonb;
BEGIN
  -- everything that is not project-scoped comes from the one-argument form, so
  -- the two can never drift on models, budgets or the empty-user case.
  v_base := public.capabilities_for_user(_user_id);
  IF (v_base ->> 'role') IS NULL THEN
    RETURN v_base || jsonb_build_object('project', jsonb_build_object(
      'project_id', _project_id, 'project_role', NULL, 'is_member', false));
  END IF;

  SELECT au.role::text, au.organization_id INTO v_role, v_org_id
    FROM public.approved_users au WHERE au.id = _user_id;
  -- D231 — the organization layer is the PROJECT's organization.
  SELECT COALESCE(p.organization_id, v_org_id) INTO v_org_id
    FROM public.projects p WHERE p.id = _project_id;
  v_is_super := (v_role = 'super_admin');
  v_project_role := public.effective_project_role(_user_id, _project_id);

  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_pages
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      WHEN c.key = '/profile' THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc
          WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT prc.allowed FROM public.project_role_capabilities prc
          WHERE prc.project_role = v_project_role AND prc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities oc
          WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        (SELECT rc.allowed FROM public.role_capabilities rc
          WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'page';

  SELECT COALESCE(jsonb_object_agg(c.key, x.eff), '{}'::jsonb) INTO v_features
  FROM public.capabilities c
  CROSS JOIN LATERAL (SELECT
    CASE
      WHEN v_is_super THEN true
      ELSE COALESCE(
        (SELECT uc.allowed FROM public.user_capabilities uc
          WHERE uc.user_id = _user_id AND uc.capability_key = c.key),
        (SELECT prc.allowed FROM public.project_role_capabilities prc
          WHERE prc.project_role = v_project_role AND prc.capability_key = c.key),
        (SELECT oc.allowed FROM public.org_capabilities oc
          WHERE oc.org_id = v_org_id AND oc.capability_key = c.key),
        (SELECT rc.allowed FROM public.role_capabilities rc
          WHERE rc.role = v_role AND rc.capability_key = c.key),
        false)
    END AS eff) x
  WHERE c.kind = 'feature';

  -- D276 — the keys the project layer decides follow `project_right_decide`: the project
  -- role grants, the account role caps.
  v_decisions := public.project_right_decisions(_user_id, _project_id);
  SELECT v_features || COALESCE(jsonb_object_agg(d.key, d.value -> 'allowed'), '{}'::jsonb)
    INTO v_features
    FROM jsonb_each(v_decisions) d;

  RETURN v_base
      || jsonb_build_object('pages', v_pages, 'features', v_features)
      || jsonb_build_object('project', jsonb_build_object(
           'project_id',   _project_id,
           'project_role', v_project_role,
           'is_member',    v_project_role IS NOT NULL));
END; $$;
REVOKE ALL ON FUNCTION public.capabilities_for_user(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capabilities_for_user(uuid, uuid) TO service_role;

-- ── 4 · the rights carry their reasons ──────────────────────────────────────
-- `20261001000017`'s live body, plus `decisions`.
CREATE OR REPLACE FUNCTION public.project_rights_for_user(p_user_id uuid, p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user      public.approved_users%ROWTYPE;
  v_project   public.projects%ROWTYPE;
  v_active    boolean;
  v_super     boolean;
  v_member    boolean;
  v_here      boolean;
  v_land      boolean;
  v_resolved  jsonb;
  v_caps      jsonb;
  v_decisions jsonb;
BEGIN
  SELECT * INTO v_user FROM public.approved_users WHERE id = p_user_id;
  SELECT * INTO v_project FROM public.projects WHERE id = p_project_id;
  IF v_user.id IS NULL OR v_project.id IS NULL THEN RETURN NULL; END IF;

  -- A suspended account cannot sign in (D205), so it holds nothing, whatever its role says.
  v_active := COALESCE(v_user.is_active, true);
  v_super  := (v_user.role = 'super_admin'::public.app_role);
  -- D231 — rights are stated as the account has them WHILE WORKING IN THE PROJECT'S
  -- ORGANIZATION.
  v_member := v_project.organization_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.organization_members om
                 WHERE om.org_id = v_project.organization_id AND om.user_id = v_user.id);
  v_here   := v_project.organization_id IS NOT NULL AND v_user.organization_id = v_project.organization_id;
  -- `has_project_access` — the gate `ingest_land_file` applies to every upload.
  v_land   := v_project.modeler_id = v_user.id OR v_user.role IN ('admin'::public.app_role, 'super_admin'::public.app_role);

  -- The resolver's project answer, for the keys its project layer has an opinion on.
  SELECT COALESCE(jsonb_object_agg(f.key, f.value), '{}'::jsonb) INTO v_resolved
    FROM jsonb_each(public.capabilities_for_user(v_user.id, v_project.id) -> 'features') f
   WHERE f.key IN (SELECT DISTINCT capability_key FROM public.project_role_capabilities);

  SELECT COALESCE(jsonb_object_agg(r.key,
           to_jsonb(v_active AND COALESCE((r.value #>> '{}')::boolean, false)
                    AND (r.key <> 'data_edit_inputs' OR v_land))), '{}'::jsonb)
    INTO v_caps
    FROM jsonb_each(v_resolved) r;

  -- D276 — why each right holds or not. The rule's own decider, then the two gates applied
  -- after it: suspension and, for Edit Input Data, the upload gate.
  SELECT COALESCE(jsonb_object_agg(d.key,
           d.value || jsonb_build_object(
             'allowed', COALESCE((v_caps ->> d.key)::boolean, false),
             'decided_by', CASE
               WHEN NOT v_active THEN 'suspended'
               WHEN d.key = 'data_edit_inputs' AND (d.value ->> 'allowed')::boolean AND NOT v_land
                 THEN 'upload_gate'
               ELSE d.value ->> 'decided_by' END)), '{}'::jsonb)
    INTO v_decisions
    FROM jsonb_each(public.project_right_decisions(v_user.id, v_project.id)) d;

  RETURN jsonb_build_object(
    'account_active',        v_active,
    'visible',               v_active AND (v_super OR v_member),
    'can_edit_project',      v_active AND (v_super OR (v_member AND (v_project.modeler_id = v_user.id
                                                                     OR v_user.role IN ('admin'::public.app_role, 'super_admin'::public.app_role)))),
    'working_in_project_org', v_here,
    'may_land_uploads',      v_active AND v_land,
    'capabilities',          v_caps,
    'resolved_capabilities', v_resolved,
    'decisions',             v_decisions);
END; $$;
COMMENT ON FUNCTION public.project_rights_for_user(uuid, uuid) IS
  'D230, D231, D276 — one person''s rights on one project, as the app applies them while the '
  'person works in the project''s organization: visible, working_in_project_org, '
  'can_edit_project, may_land_uploads, capabilities (project_right_decide''s answer, refused '
  'to a suspended account, and data_edit_inputs also requiring the upload gate), '
  'resolved_capabilities (the rule before those gates) and decisions (each right''s inputs and '
  'what decided it). Internal: project_access_read, admin_get_user_memberships and '
  'get_my_project_rights read it; no role may call it.';
REVOKE ALL ON FUNCTION public.project_rights_for_user(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 5 · an agent approval needs the right the manual action needs ───────────
CREATE OR REPLACE FUNCTION public.agent_artifact_project_rights()
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  -- One row per `proposals_artifact_type_check` value. NULL: the artifact changes nothing
  -- in the project (an explanation), so no project right is asked of its approver.
  SELECT jsonb_object_agg(t.artifact_type, t.capability_key)
    FROM (VALUES
      ('item_master_diff',   'data_edit_inputs'),
      ('parameter_estimate', 'data_edit_inputs'),
      ('network_map_diff',   'data_edit_inputs'),
      ('policy_bundle_diff', 'data_edit_policies'),
      ('model_card_draft',   'data_edit_policies'),
      ('experiment_spec',    'simulation_lab'),
      ('risk_alert',         'simulation_lab'),
      ('decision_report',    'export'),
      ('trace_explanation',  NULL)
    ) AS t(artifact_type, capability_key);
$$;
COMMENT ON FUNCTION public.agent_artifact_project_rights() IS
  'D276 — the project right an approver must hold on the proposal''s project for each agent '
  'artifact type: the right the same change needs by hand. Read by agent_project_right_refusal '
  '(review_agent_proposal, agent-apply) and shown on /admin/roles.';
GRANT EXECUTE ON FUNCTION public.agent_artifact_project_rights() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agent_project_right_refusal(
  p_user_id uuid, p_project_id uuid, p_artifact_type text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_map    jsonb := public.agent_artifact_project_rights();
  v_key    text;
  v_rights jsonb;
  v_label  text;
BEGIN
  IF NOT (v_map ? p_artifact_type) THEN
    RETURN format('forbidden: no project right is declared for artifact %s', p_artifact_type);
  END IF;
  v_key := v_map ->> p_artifact_type;
  IF v_key IS NULL THEN RETURN NULL; END IF;
  IF p_project_id IS NULL THEN
    RETURN format('forbidden: this proposal names no project, so %s cannot be checked', v_key);
  END IF;
  v_rights := public.project_rights_for_user(p_user_id, p_project_id);
  IF COALESCE((v_rights -> 'capabilities' ->> v_key)::boolean, false) THEN RETURN NULL; END IF;
  SELECT label INTO v_label FROM public.capabilities WHERE key = v_key;
  RETURN format('forbidden: approving this proposal needs %s on its project (decided by %s)',
                COALESCE(v_label, v_key),
                COALESCE(v_rights -> 'decisions' -> v_key ->> 'decided_by', 'no project access'));
END; $$;
COMMENT ON FUNCTION public.agent_project_right_refusal(uuid, uuid, text) IS
  'D276 — NULL when the user holds, on the project, the right agent_artifact_project_rights '
  'names for the artifact; otherwise the refusal. Fails closed on an undeclared artifact type.';
REVOKE ALL ON FUNCTION public.agent_project_right_refusal(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_project_right_refusal(uuid, uuid, text) TO service_role;

-- `20260723000001`'s live body; the approve branch also asks the project right.
CREATE OR REPLACE FUNCTION public.review_agent_proposal(
  p_proposal_id uuid,
  p_action      text,            -- 'approve' | 'reject' | 'propose'
  p_user_id     uuid DEFAULT NULL,
  p_user_email  text DEFAULT NULL,
  p_note        text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_row     public.proposals%ROWTYPE;
  v_caps    jsonb;
  v_ok      boolean;
  v_refusal text;
BEGIN
  SELECT * INTO v_row FROM public.proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'proposal % not found', p_proposal_id; END IF;

  -- §13.2 checkpoint 4 (fail closed): resolve grants for the asserted user.
  -- 'propose' is the agent completing its own draft (service context) and
  -- carries no user grant.
  IF p_action IN ('approve', 'reject') THEN
    v_caps := public.get_my_capabilities(p_user_id);
    IF COALESCE((v_caps->>'is_super_admin')::boolean, false) THEN
      v_ok := true;
    ELSIF p_action = 'reject' THEN
      v_ok := COALESCE((v_caps->'features'->>'agent_proposals')::boolean, false);
      IF NOT v_ok THEN
        RAISE EXCEPTION 'forbidden: reject requires the agent_proposals capability';
      END IF;
    ELSIF v_row.artifact_type = 'decision_report' THEN
      -- §13.3: decision_report apply = agent_proposals + reports; rendering
      -- mutates no project state, so agent_apply is deliberately NOT demanded.
      v_ok := COALESCE((v_caps->'features'->>'agent_proposals')::boolean, false)
          AND COALESCE((v_caps->'features'->>'reports')::boolean, false);
      IF NOT v_ok THEN
        RAISE EXCEPTION 'forbidden: approve requires the agent_proposals and reports capabilities';
      END IF;
    ELSE
      v_ok := COALESCE((v_caps->'features'->>'agent_apply')::boolean, false);
      IF NOT v_ok THEN
        RAISE EXCEPTION 'forbidden: approve requires the agent_apply capability';
      END IF;
    END IF;

    -- D276 — approving is never more than the approver could do by hand on this project.
    IF p_action = 'approve' AND NOT COALESCE((v_caps->>'is_super_admin')::boolean, false) THEN
      v_refusal := public.agent_project_right_refusal(p_user_id, v_row.project_id, v_row.artifact_type);
      IF v_refusal IS NOT NULL THEN RAISE EXCEPTION '%', v_refusal; END IF;
    END IF;
  END IF;

  IF p_action = 'approve' THEN
    IF v_row.status <> 'proposed' THEN RAISE EXCEPTION 'approve requires status=proposed (is %)', v_row.status; END IF;
    UPDATE public.proposals SET status='approved', reviewed_by=p_user_id,
      reviewed_at=now(), status_reason=p_note WHERE id=p_proposal_id;
  ELSIF p_action = 'reject' THEN
    IF v_row.status NOT IN ('proposed','approved') THEN RAISE EXCEPTION 'reject requires proposed|approved (is %)', v_row.status; END IF;
    UPDATE public.proposals SET status='rejected', reviewed_by=p_user_id,
      reviewed_at=now(), status_reason=p_note WHERE id=p_proposal_id;
  ELSIF p_action = 'propose' THEN
    IF v_row.status <> 'draft' THEN RAISE EXCEPTION 'propose requires status=draft (is %)', v_row.status; END IF;
    UPDATE public.proposals SET status='proposed' WHERE id=p_proposal_id;
  ELSE
    RAISE EXCEPTION 'unknown action %', p_action;
  END IF;

  -- §4.2 side effects: the review events, id-attributed only (§7.5).
  IF p_action IN ('approve', 'reject') THEN
    INSERT INTO public.ai_chat_events (
      user_id, project_id, thread_id, agent_id, model_code, provider_code,
      event_kind, proposal_id, payload
    ) VALUES (
      p_user_id, v_row.project_id, v_row.thread_id, v_row.agent_id,
      v_row.model_code, v_row.provider_code,
      CASE WHEN p_action = 'approve' THEN 'proposal.approved' ELSE 'proposal.rejected' END,
      v_row.id,
      jsonb_build_object('artifact_type', v_row.artifact_type,
                         'provenance', v_row.provenance,
                         'status_reason', p_note)
    );
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.review_agent_proposal(uuid,text,uuid,text,text)
  TO anon, authenticated, service_role;

-- ── 6 · /admin/roles reads the whole rule ───────────────────────────────────
-- Every membership the rule applies to: an active, non-super account holding an effective
-- role on a project (owner, member or live delegation). Internal.
CREATE OR REPLACE FUNCTION public.project_role_holdings()
RETURNS TABLE (user_id uuid, project_id uuid, account_role text, project_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pairs AS (
    SELECT p.modeler_id AS user_id, p.id AS project_id FROM public.projects p WHERE p.modeler_id IS NOT NULL
    UNION
    SELECT pm.user_id, pm.project_id FROM public.project_members pm
    UNION
    SELECT dg.grantee_user_id, dg.project_id FROM public.delegation_grants dg
     WHERE dg.revoked_at IS NULL AND dg.expires_at > now()
  )
  SELECT x.user_id, x.project_id, x.account_role, x.project_role
    FROM (SELECT pr.user_id, pr.project_id, u.role::text AS account_role,
                 public.effective_project_role(pr.user_id, pr.project_id) AS project_role
            FROM pairs pr
            JOIN public.approved_users u ON u.id = pr.user_id
           WHERE COALESCE(u.is_active, true)
             AND u.role <> 'super_admin'::public.app_role) x
   WHERE x.project_role IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.project_role_holdings() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_role_access(p_actor_id uuid, p_actor_email text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scoped  jsonb;
  v_prm     jsonb;
  v_eff     jsonb;
  v_hold    jsonb;
  v_capped  jsonb;
  v_orgov   jsonb;
  v_userov  jsonb;
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT capability_key ORDER BY capability_key), '[]'::jsonb)
    INTO v_scoped FROM public.project_role_capabilities;

  SELECT COALESCE(jsonb_object_agg(r.project_role, r.caps), '{}'::jsonb) INTO v_prm
    FROM (SELECT prc.project_role, jsonb_object_agg(prc.capability_key, prc.allowed) AS caps
            FROM public.project_role_capabilities prc GROUP BY prc.project_role) r;

  -- account role × project role ('none' = no project role) × key, by the rule itself, from
  -- the role defaults alone (organization and person overrides are listed separately).
  SELECT COALESCE(jsonb_object_agg(a.account_role, a.by_prole), '{}'::jsonb) INTO v_eff
    FROM (
      SELECT ar.account_role, jsonb_object_agg(pr.project_role, pr.by_key) AS by_prole
        FROM (VALUES ('user'), ('modeler'), ('admin'), ('super_admin')) ar(account_role)
        CROSS JOIN LATERAL (
          SELECT prl.project_role, jsonb_object_agg(k.key, public.project_right_decide(
                   ar.account_role = 'super_admin', NULL,
                   NULLIF(prl.project_role, 'none'),
                   (SELECT prc.allowed FROM public.project_role_capabilities prc
                     WHERE prc.project_role = prl.project_role AND prc.capability_key = k.key),
                   COALESCE((SELECT rc.allowed FROM public.role_capabilities rc
                              WHERE rc.role = ar.account_role AND rc.capability_key = k.key), false))) AS by_key
            FROM (VALUES ('none'), ('viewer'), ('analyst'), ('editor'), ('owner')) prl(project_role)
            CROSS JOIN (SELECT DISTINCT capability_key AS key FROM public.project_role_capabilities) k
           GROUP BY prl.project_role) pr
       GROUP BY ar.account_role) a;

  -- How many memberships sit in each (account role, project role) cell today.
  SELECT COALESCE(jsonb_object_agg(h.account_role, h.by_prole), '{}'::jsonb) INTO v_hold
    FROM (SELECT x.account_role, jsonb_object_agg(x.project_role, x.n) AS by_prole
            FROM (SELECT account_role, project_role, count(*) AS n
                    FROM public.project_role_holdings() GROUP BY 1, 2) x
           GROUP BY x.account_role) h;

  -- Every membership whose project role grants a right the account role caps.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', h.user_id, 'name', COALESCE(u.name, u.email), 'account_role', h.account_role,
           'project_id', h.project_id, 'project_name', p.name, 'project_role', h.project_role,
           'capability_key', d.key, 'account_source', d.value ->> 'account_source')
           ORDER BY lower(COALESCE(u.name, u.email, '')), p.name, d.key), '[]'::jsonb)
    INTO v_capped
    FROM public.project_role_holdings() h
    JOIN public.approved_users u ON u.id = h.user_id
    JOIN public.projects p ON p.id = h.project_id
    CROSS JOIN LATERAL jsonb_each(public.project_right_decisions(h.user_id, h.project_id)) d
   WHERE d.value ->> 'decided_by' = 'account_ceiling';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'org_id', oc.org_id, 'org_name', o.name, 'capability_key', oc.capability_key,
           'allowed', oc.allowed) ORDER BY o.name, oc.capability_key), '[]'::jsonb)
    INTO v_orgov
    FROM public.org_capabilities oc
    LEFT JOIN public.organizations o ON o.id = oc.org_id
   WHERE oc.capability_key IN (SELECT capability_key FROM public.project_role_capabilities);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', uc.user_id, 'name', COALESCE(u.name, u.email), 'capability_key', uc.capability_key,
           'allowed', uc.allowed) ORDER BY lower(COALESCE(u.name, u.email, '')), uc.capability_key), '[]'::jsonb)
    INTO v_userov
    FROM public.user_capabilities uc
    LEFT JOIN public.approved_users u ON u.id = uc.user_id
   WHERE uc.capability_key IN (SELECT capability_key FROM public.project_role_capabilities);

  RETURN jsonb_build_object(
    'capabilities', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'key', c.key, 'kind', c.kind, 'label', c.label,
        'description', c.description, 'sort_order', c.sort_order)
        ORDER BY c.kind, c.sort_order, c.key), '[]'::jsonb) FROM public.capabilities c),
    'roles', (SELECT jsonb_object_agg(role, caps) FROM (
        SELECT rc.role, jsonb_object_agg(rc.capability_key, rc.allowed) AS caps
        FROM public.role_capabilities rc GROUP BY rc.role) r),
    -- D276
    'project_scoped',     v_scoped,
    'project_roles',      v_prm,
    'effective',          v_eff,
    'holdings',           v_hold,
    'capped',             v_capped,
    'org_overrides',      v_orgov,
    'person_overrides',   v_userov,
    'agent_rights',       public.agent_artifact_project_rights());
END; $$;
REVOKE ALL ON FUNCTION public.get_role_access(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_role_access(uuid, text) TO anon, authenticated;

-- ── 7 · what an account-role switch would change, before it is flipped ──────
CREATE OR REPLACE FUNCTION public.admin_preview_role_capability(
  p_actor_id uuid, p_actor_email text, p_role text, p_capability_key text, p_allowed boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_changes jsonb;
  v_scoped  boolean;
BEGIN
  PERFORM public.set_current_user_context(p_actor_id, p_actor_email);
  IF NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_scoped := EXISTS (SELECT 1 FROM public.project_role_capabilities WHERE capability_key = p_capability_key);
  IF NOT v_scoped THEN
    RETURN jsonb_build_object('project_scoped', false, 'changes', '[]'::jsonb);
  END IF;

  -- Each membership whose account role is p_role, re-decided with the switch flipped. Only a
  -- right whose account answer comes from the account role moves: an organization or person
  -- override already decides it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', h.user_id, 'name', COALESCE(u.name, u.email), 'project_id', h.project_id,
           'project_name', p.name, 'project_role', h.project_role,
           'before', (d.value ->> 'allowed')::boolean, 'after', (n.v ->> 'allowed')::boolean)
           ORDER BY lower(COALESCE(u.name, u.email, '')), p.name), '[]'::jsonb)
    INTO v_changes
    FROM public.project_role_holdings() h
    JOIN public.approved_users u ON u.id = h.user_id
    JOIN public.projects p ON p.id = h.project_id
    CROSS JOIN LATERAL (SELECT public.project_right_decisions(h.user_id, h.project_id) -> p_capability_key AS value) d
    CROSS JOIN LATERAL (SELECT public.project_right_decide(
                          false, (d.value ->> 'person_override')::boolean, h.project_role,
                          (d.value ->> 'project_grant')::boolean,
                          CASE WHEN d.value ->> 'account_source' = 'organization'
                               THEN (d.value ->> 'account_allows')::boolean
                               ELSE COALESCE(p_allowed, false) END) AS v) n
   WHERE h.account_role = p_role
     AND (d.value ->> 'allowed')::boolean IS DISTINCT FROM (n.v ->> 'allowed')::boolean;

  RETURN jsonb_build_object('project_scoped', true, 'changes', v_changes);
END; $$;
COMMENT ON FUNCTION public.admin_preview_role_capability(uuid, text, text, text, boolean) IS
  'D276 — the memberships whose project right would change if the account role''s switch for '
  'a project-scoped key were set to p_allowed, re-decided by project_right_decide. Read-only.';
REVOKE ALL ON FUNCTION public.admin_preview_role_capability(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_preview_role_capability(uuid, text, text, text, boolean) TO anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
