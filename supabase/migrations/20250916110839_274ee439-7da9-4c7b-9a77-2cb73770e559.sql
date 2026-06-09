-- Fix organization mismatch: Update user's organization to match project organization
UPDATE public.approved_users 
SET organization = 'Company1', updated_at = now()
WHERE organization = 'default_org_2';