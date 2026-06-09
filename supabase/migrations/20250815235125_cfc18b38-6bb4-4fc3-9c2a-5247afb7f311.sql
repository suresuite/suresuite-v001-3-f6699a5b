-- Create table for storing uploaded data
CREATE TABLE public.supply_chain_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  plant TEXT NOT NULL UNIQUE,
  weighted DECIMAL(10,4),
  material_consumption_rate DECIMAL(10,4),
  sourcing_ratio DECIMAL(5,4),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.supply_chain_data ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view all supply chain data" 
ON public.supply_chain_data 
FOR SELECT 
TO authenticated
USING (true);

CREATE POLICY "Users can insert supply chain data" 
ON public.supply_chain_data 
FOR INSERT 
TO authenticated
WITH CHECK (true);

CREATE POLICY "Users can update supply chain data" 
ON public.supply_chain_data 
FOR UPDATE 
TO authenticated
USING (true);

CREATE POLICY "Users can delete supply chain data" 
ON public.supply_chain_data 
FOR DELETE 
TO authenticated
USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_supply_chain_data_updated_at
BEFORE UPDATE ON public.supply_chain_data
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();