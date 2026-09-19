-- Phase 6 / WP 6.4 / §13 — the decision plane's remaining six, audited
--
-- Six sidecars land with this migration and the triggers land with them, in one
-- commit, for the reason D54 states: `dataPlaneAudit.test.ts` scopes the audit rule
-- to tables IN THE CONTRACT, so describing a table without its triggers creates a
-- described tier-4 table whose writes are unaudited — and now visibly so, where
-- before it was a deferral nobody could see.
--
-- WHAT THESE SIX ARE. The DECISION plane: what a person or an agent chose, as
-- against the dataset they chose it over (tier 2) and the result it produced
-- (tier 3). `result-binding` (I8) needs all three, and of the six only
-- `policy_versions` is bound to a result today.
--
-- STATEMENT GRAIN, not row grain, and the difference is the whole design: one audit
-- row per STATEMENT naming the actor, not one per row. A bulk update of forty
-- scenarios is one decision and is recorded as one. `audit_tier_write('4')` reads
-- the transition tables, so the row carries the counts without carrying the rows.
--
-- TWO OF THE SIX HAVE NO WRITER AT ALL, and the triggers are not wasted on them.
-- `policy_presets` is read by nothing and written by nothing (§4 D126);
-- `scenario_templates` is changed only by a migration. A trigger on a table only a
-- migration touches is exactly the case worth auditing — a change to the shipped
-- catalog is the kind nobody notices.


-- policy_versions (tier 4)
DROP TRIGGER IF EXISTS audit_policy_versions_insert ON public.policy_versions;
CREATE TRIGGER audit_policy_versions_insert AFTER INSERT ON public.policy_versions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_versions_update ON public.policy_versions;
CREATE TRIGGER audit_policy_versions_update AFTER UPDATE ON public.policy_versions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_versions_delete ON public.policy_versions;
CREATE TRIGGER audit_policy_versions_delete AFTER DELETE ON public.policy_versions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- policy_presets (tier 4)
DROP TRIGGER IF EXISTS audit_policy_presets_insert ON public.policy_presets;
CREATE TRIGGER audit_policy_presets_insert AFTER INSERT ON public.policy_presets
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_presets_update ON public.policy_presets;
CREATE TRIGGER audit_policy_presets_update AFTER UPDATE ON public.policy_presets
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_policy_presets_delete ON public.policy_presets;
CREATE TRIGGER audit_policy_presets_delete AFTER DELETE ON public.policy_presets
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- scenarios (tier 4)
DROP TRIGGER IF EXISTS audit_scenarios_insert ON public.scenarios;
CREATE TRIGGER audit_scenarios_insert AFTER INSERT ON public.scenarios
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_scenarios_update ON public.scenarios;
CREATE TRIGGER audit_scenarios_update AFTER UPDATE ON public.scenarios
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_scenarios_delete ON public.scenarios;
CREATE TRIGGER audit_scenarios_delete AFTER DELETE ON public.scenarios
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- scenario_templates (tier 4)
DROP TRIGGER IF EXISTS audit_scenario_templates_insert ON public.scenario_templates;
CREATE TRIGGER audit_scenario_templates_insert AFTER INSERT ON public.scenario_templates
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_scenario_templates_update ON public.scenario_templates;
CREATE TRIGGER audit_scenario_templates_update AFTER UPDATE ON public.scenario_templates
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_scenario_templates_delete ON public.scenario_templates;
CREATE TRIGGER audit_scenario_templates_delete AFTER DELETE ON public.scenario_templates
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- recovery_playbooks (tier 4)
DROP TRIGGER IF EXISTS audit_recovery_playbooks_insert ON public.recovery_playbooks;
CREATE TRIGGER audit_recovery_playbooks_insert AFTER INSERT ON public.recovery_playbooks
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_recovery_playbooks_update ON public.recovery_playbooks;
CREATE TRIGGER audit_recovery_playbooks_update AFTER UPDATE ON public.recovery_playbooks
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_recovery_playbooks_delete ON public.recovery_playbooks;
CREATE TRIGGER audit_recovery_playbooks_delete AFTER DELETE ON public.recovery_playbooks
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- external_evidence (tier 4)
DROP TRIGGER IF EXISTS audit_external_evidence_insert ON public.external_evidence;
CREATE TRIGGER audit_external_evidence_insert AFTER INSERT ON public.external_evidence
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_external_evidence_update ON public.external_evidence;
CREATE TRIGGER audit_external_evidence_update AFTER UPDATE ON public.external_evidence
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_external_evidence_delete ON public.external_evidence;
CREATE TRIGGER audit_external_evidence_delete AFTER DELETE ON public.external_evidence
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
