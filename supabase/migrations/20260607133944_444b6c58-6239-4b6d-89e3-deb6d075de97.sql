-- Add demand family + fulfillment_strategy to policy_defaults.
ALTER TABLE public.policy_defaults
  ADD COLUMN IF NOT EXISTS demand jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fulfillment_strategy text NOT NULL DEFAULT 'make_to_stock',
  ADD COLUMN IF NOT EXISTS active_preset text,
  ADD COLUMN IF NOT EXISTS preset_applied_at timestamptz;

-- Constrain strategy enum (textual to keep migration simple + forward-compatible).
ALTER TABLE public.policy_defaults
  DROP CONSTRAINT IF EXISTS policy_defaults_strategy_chk;
ALTER TABLE public.policy_defaults
  ADD CONSTRAINT policy_defaults_strategy_chk
  CHECK (fulfillment_strategy IN ('make_to_stock','make_to_order','assemble_to_order','engineer_to_order','configure_to_order'));

-- Allow 'demand' as a valid family on overrides.
ALTER TABLE public.policy_overrides
  DROP CONSTRAINT IF EXISTS policy_overrides_family_chk;
ALTER TABLE public.policy_overrides
  ADD CONSTRAINT policy_overrides_family_chk
  CHECK (family IN ('sourcing','inventory','transport','fulfillment','production','recovery','demand'));