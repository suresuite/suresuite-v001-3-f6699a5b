-- Add plant location fields to projects table
ALTER TABLE public.projects 
ADD COLUMN plant_latitude NUMERIC,
ADD COLUMN plant_longitude NUMERIC,
ADD COLUMN plant_location_text TEXT;