-- Phase 1 / WP 1.3 / D9 — `inbound_logistics.lead_time_unit`.
--
-- The engine has read this field since the scsim bridge was written:
--   · sim-worker/sim_worker/datamap.py builds SupplyArc(lead_time_unit=r.get(...))
--   · scsim/scsim/io/project_map.py::_map_supply passes it to _duration_to_weeks
--
-- No column supplied it. `r.get("lead_time_unit")` on a row that has no such key
-- returns None, `_duration_to_weeks` falls back to a 7-day basis, and the value is
-- taken as WEEKS verbatim. So a user who enters a lead time in days gets it read
-- as weeks — seven times too long — with no warning anywhere, because nothing in
-- the chain knows a unit was ever expected.
--
-- NULL keeps meaning WEEKS. That is not a new default; it is the behaviour
-- project_map.py already has, now written down instead of emerging from a missing
-- dictionary key.
--
-- `time_unit` is NOT this column. `time_unit` is the period `volume` is quoted
-- over and has never applied to `lead_time`; conflating them is how a project can
-- have a yearly volume and a 4-week lead time on the same row.

ALTER TABLE public.inbound_logistics
  ADD COLUMN IF NOT EXISTS lead_time_unit text;

COMMENT ON COLUMN public.inbound_logistics.lead_time_unit IS
  'The period `lead_time` is quoted in — day, week, month, quarter, year. NULL '
  'means weeks, matching project_map.py::_duration_to_weeks. Distinct from '
  '`time_unit`, which is the period `volume` is quoted over.';

-- Only the units the one unit table knows (public.unit_days, WP 1.3/D10). A value
-- it does not recognise would be silently read as weeks, which is the failure this
-- column exists to end, so it is rejected at write time instead.
ALTER TABLE public.inbound_logistics
  DROP CONSTRAINT IF EXISTS inbound_logistics_lead_time_unit_known;

ALTER TABLE public.inbound_logistics
  ADD CONSTRAINT inbound_logistics_lead_time_unit_known
  CHECK (lead_time_unit IS NULL OR public.unit_days(lead_time_unit) IS NOT NULL);

-- THROWAWAY. Phase 1 / WP 1.4's gap check: a scratch column that no sidecar
-- describes must make CI red. This branch and its PR exist only to prove that,
-- and are deleted once the run is recorded in PLAN.md §16.
ALTER TABLE public.inbound_logistics ADD COLUMN IF NOT EXISTS scratch_column text;
