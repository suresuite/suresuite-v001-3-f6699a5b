-- Populate demo geolocations with the correct data format
-- 1) Ensure node_list is (re)built and classified for all projects
DO $$
DECLARE pid uuid;
BEGIN
  FOR pid IN SELECT id FROM public.projects LOOP
    PERFORM public.refresh_node_list_for_project(pid);
  END LOOP;
END $$;

-- 2) Set sample coordinates for Suppliers
UPDATE public.node_list
SET 
  location_text = COALESCE(location_text, 'Shanghai, China'),
  latitude = 31.2304,
  longitude = 121.4737
WHERE lower(COALESCE(node_type, '')) = 'supplier';

-- 3) Set sample coordinates for Customers
UPDATE public.node_list
SET 
  location_text = COALESCE(location_text, 'New York, USA'),
  latitude = 40.7128,
  longitude = -74.0060
WHERE lower(COALESCE(node_type, '')) = 'customer';

-- 4) Set plant coordinates for all projects (if missing)
UPDATE public.projects
SET 
  plant_location_text = COALESCE(plant_location_text, 'Berlin, Germany'),
  plant_latitude = COALESCE(plant_latitude, 52.52),
  plant_longitude = COALESCE(plant_longitude, 13.4050)
WHERE plant_latitude IS NULL OR plant_longitude IS NULL;