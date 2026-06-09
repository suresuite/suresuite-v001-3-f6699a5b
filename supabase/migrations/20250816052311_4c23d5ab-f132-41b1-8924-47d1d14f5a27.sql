-- Add uploaded_by field to supply_chain_data to track which user uploaded each record
ALTER TABLE public.supply_chain_data 
ADD COLUMN uploaded_by UUID REFERENCES public.approved_users(id);

-- Create user_plant_access table for fine-grained plant permissions
CREATE TABLE public.user_plant_access (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.approved_users(id) ON DELETE CASCADE,
  plant TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT true,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, plant)
);

-- Enable RLS on user_plant_access
ALTER TABLE public.user_plant_access ENABLE ROW LEVEL SECURITY;

-- Users can only see their own plant access records
CREATE POLICY "Users can view their own plant access" 
ON public.user_plant_access 
FOR SELECT 
USING (user_id = (SELECT id FROM public.approved_users WHERE email = auth.jwt() ->> 'email'));

-- Users can manage their own plant access
CREATE POLICY "Users can manage their own plant access" 
ON public.user_plant_access 
FOR ALL
USING (user_id = (SELECT id FROM public.approved_users WHERE email = auth.jwt() ->> 'email'));

-- Update RLS policies for supply_chain_data to include user access control
DROP POLICY IF EXISTS "Anyone can view supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Anyone can delete supply chain data" ON public.supply_chain_data;
DROP POLICY IF EXISTS "Anyone can update supply chain data" ON public.supply_chain_data;

-- New policy: Users can view data they uploaded or plants they have access to
CREATE POLICY "Users can view accessible supply chain data" 
ON public.supply_chain_data 
FOR SELECT 
USING (
  uploaded_by = (SELECT id FROM public.approved_users WHERE email = auth.jwt() ->> 'email')
  OR 
  (SELECT role FROM public.approved_users WHERE email = auth.jwt() ->> 'email') = 'admin'
  OR
  plant IN (
    SELECT plant FROM public.user_plant_access 
    WHERE user_id = (SELECT id FROM public.approved_users WHERE email = auth.jwt() ->> 'email')
    AND can_view = true
  )
);

-- Users can only delete data they uploaded
CREATE POLICY "Users can delete their own supply chain data" 
ON public.supply_chain_data 
FOR DELETE 
USING (
  uploaded_by = (SELECT id FROM public.approved_users WHERE email = auth.jwt() ->> 'email')
  OR 
  (SELECT role FROM public.approved_users WHERE email = auth.jwt() ->> 'email') = 'admin'
);

-- Users can only update data they uploaded
CREATE POLICY "Users can update their own supply chain data" 
ON public.supply_chain_data 
FOR UPDATE 
USING (
  uploaded_by = (SELECT id FROM public.approved_users WHERE email = auth.jwt() ->> 'email')
  OR 
  (SELECT role FROM public.approved_users WHERE email = auth.jwt() ->> 'email') = 'admin'
);

-- Add trigger for updated_at on user_plant_access
CREATE TRIGGER update_user_plant_access_updated_at
BEFORE UPDATE ON public.user_plant_access
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for performance
CREATE INDEX idx_supply_chain_data_uploaded_by ON public.supply_chain_data(uploaded_by);
CREATE INDEX idx_supply_chain_data_plant ON public.supply_chain_data(plant);
CREATE INDEX idx_user_plant_access_user_plant ON public.user_plant_access(user_id, plant);