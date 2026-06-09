-- Clear coordinates for a few supplier and customer nodes to test geocoding
UPDATE public.node_list 
SET latitude = NULL, longitude = NULL, location_text = NULL 
WHERE project_id = 'c1048e6b-bbe2-4cab-9870-d6ddffddaaf9' 
  AND node_type IN ('supplier', 'customer')
  AND node_id IN ('S0001', 'S0002', 'C0001', 'C0002');