-- Phase 6 / WP 6.4 / §13: the disruption plane, audited.
--
-- `audit-actor` (G4) says every tier transition writes an audit row naming the
-- actor. `dataPlaneAudit.test.ts` scopes that rule to tables IN THE CONTRACT, so
-- a DEFERRED tier-4 table's writes are unaudited with nothing to notice — that
-- is D54, and describing a table is what brings its writers inside the rule.
--
-- These five are the disruption plane: the 2025-08-26 single-row shape
-- (`disruption_scenarios`) and the 2025-08-27 normalised redesign
-- (`_profiles` + `_targets` + `_effects` + `_settings`). Both are live and
-- neither reads the other, which the sidecars now say out loud.
--
-- Statement grain, not row grain, exactly as `20260916000001` chose for the
-- data plane: a profile DELETE cascades into three child tables, and an audit
-- log nobody can read is no audit log.
--
-- Tier 4 throughout. These rows are DECISIONS — what a person chose — as
-- against the dataset they chose it over (tier 2) and the result it produced
-- (tier 5). `result-binding` (I8) is the invariant that needs all three.


-- disruption_scenarios (tier 4)
DROP TRIGGER IF EXISTS audit_disruption_scenarios_insert ON public.disruption_scenarios;
CREATE TRIGGER audit_disruption_scenarios_insert AFTER INSERT ON public.disruption_scenarios
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenarios_update ON public.disruption_scenarios;
CREATE TRIGGER audit_disruption_scenarios_update AFTER UPDATE ON public.disruption_scenarios
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenarios_delete ON public.disruption_scenarios;
CREATE TRIGGER audit_disruption_scenarios_delete AFTER DELETE ON public.disruption_scenarios
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- disruption_scenario_profiles (tier 4)
DROP TRIGGER IF EXISTS audit_disruption_scenario_profiles_insert ON public.disruption_scenario_profiles;
CREATE TRIGGER audit_disruption_scenario_profiles_insert AFTER INSERT ON public.disruption_scenario_profiles
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_profiles_update ON public.disruption_scenario_profiles;
CREATE TRIGGER audit_disruption_scenario_profiles_update AFTER UPDATE ON public.disruption_scenario_profiles
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_profiles_delete ON public.disruption_scenario_profiles;
CREATE TRIGGER audit_disruption_scenario_profiles_delete AFTER DELETE ON public.disruption_scenario_profiles
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- disruption_scenario_targets (tier 4)
DROP TRIGGER IF EXISTS audit_disruption_scenario_targets_insert ON public.disruption_scenario_targets;
CREATE TRIGGER audit_disruption_scenario_targets_insert AFTER INSERT ON public.disruption_scenario_targets
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_targets_update ON public.disruption_scenario_targets;
CREATE TRIGGER audit_disruption_scenario_targets_update AFTER UPDATE ON public.disruption_scenario_targets
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_targets_delete ON public.disruption_scenario_targets;
CREATE TRIGGER audit_disruption_scenario_targets_delete AFTER DELETE ON public.disruption_scenario_targets
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- disruption_scenario_effects (tier 4)
DROP TRIGGER IF EXISTS audit_disruption_scenario_effects_insert ON public.disruption_scenario_effects;
CREATE TRIGGER audit_disruption_scenario_effects_insert AFTER INSERT ON public.disruption_scenario_effects
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_effects_update ON public.disruption_scenario_effects;
CREATE TRIGGER audit_disruption_scenario_effects_update AFTER UPDATE ON public.disruption_scenario_effects
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_effects_delete ON public.disruption_scenario_effects;
CREATE TRIGGER audit_disruption_scenario_effects_delete AFTER DELETE ON public.disruption_scenario_effects
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');

-- disruption_scenario_settings (tier 4)
DROP TRIGGER IF EXISTS audit_disruption_scenario_settings_insert ON public.disruption_scenario_settings;
CREATE TRIGGER audit_disruption_scenario_settings_insert AFTER INSERT ON public.disruption_scenario_settings
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_settings_update ON public.disruption_scenario_settings;
CREATE TRIGGER audit_disruption_scenario_settings_update AFTER UPDATE ON public.disruption_scenario_settings
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
DROP TRIGGER IF EXISTS audit_disruption_scenario_settings_delete ON public.disruption_scenario_settings;
CREATE TRIGGER audit_disruption_scenario_settings_delete AFTER DELETE ON public.disruption_scenario_settings
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_tier_write('4');
