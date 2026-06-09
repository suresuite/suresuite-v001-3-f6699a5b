-- Add simulation start and end date columns to projects table
ALTER TABLE public.projects 
ADD COLUMN simulation_start DATE,
ADD COLUMN simulation_end DATE;