import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GeocodeResult {
  longitude: number;
  latitude: number;
  confidence: number;
  place_name: string;
}

interface ApiMetrics {
  apiCalls: number;
  cacheHits: number;
}

const inferLocationFromNodeId = (nodeId: string): string => {
  // Supplier nodes
  if (nodeId.startsWith('S')) {
    const supplierNumber = parseInt(nodeId.replace('S', '')) || 1;
    const sampleSuppliers = [
      'Shanghai, China', 'Mumbai, India', 'São Paulo, Brazil', 'Lagos, Nigeria',
      'Bangkok, Thailand', 'Istanbul, Turkey', 'Mexico City, Mexico', 'Jakarta, Indonesia',
      'Seoul, South Korea', 'Manila, Philippines', 'Karachi, Pakistan', 'Delhi, India',
      'Tokyo, Japan', 'Dhaka, Bangladesh', 'Moscow, Russia', 'Cairo, Egypt'
    ];
    return sampleSuppliers[supplierNumber % sampleSuppliers.length] || `Supplier Location ${supplierNumber}`;
  }
  
  // Customer nodes
  if (nodeId.startsWith('C')) {
    const customerNumber = parseInt(nodeId.replace('C', '')) || 1;
    const sampleCustomers = [
      'New York, USA', 'London, UK', 'Paris, France', 'Berlin, Germany',
      'Rome, Italy', 'Madrid, Spain', 'Amsterdam, Netherlands', 'Stockholm, Sweden',
      'Copenhagen, Denmark', 'Vienna, Austria', 'Zurich, Switzerland', 'Oslo, Norway',
      'Dublin, Ireland', 'Brussels, Belgium', 'Prague, Czech Republic'
    ];
    return sampleCustomers[customerNumber % sampleCustomers.length] || `Customer Location ${customerNumber}`;
  }
  
  return `Unknown Location`;
};

const geocodeLocation = async (
  locationText: string,
  mapboxToken: string,
  cache: Map<string, GeocodeResult | null>,
  metrics: ApiMetrics
): Promise<GeocodeResult | null> => {
  if (!locationText || locationText.trim().length === 0) {
    console.log('No location text provided');
    return null;
  }

  const cached = cache.get(locationText);
  if (cached !== undefined) {
    metrics.cacheHits++;
    return cached;
  }

  try {
    const encodedLocation = encodeURIComponent(locationText.trim());
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedLocation}.json?access_token=${mapboxToken}&limit=1&types=place,locality,region,country`;

    console.log('Making geocoding request to:', url);
    metrics.apiCalls++;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Geocoding API error: ${response.status} ${response.statusText}`);
      throw new Error(`Geocoding API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Geocoding API response:', data);

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const [longitude, latitude] = feature.center;

      const result = {
        longitude,
        latitude,
        confidence: feature.relevance || 0,
        place_name: feature.place_name || locationText
      };
      cache.set(locationText, result);
      return result;
    }

    console.log('No geocoding results found for:', locationText);
    cache.set(locationText, null);
    return null;
  } catch (error) {
    console.error('Geocoding error for location:', locationText, error);
    cache.set(locationText, null);
    return null;
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log('=== GEOCODING FUNCTION START ===');
    
    // Use service role key to bypass RLS for geocoding operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    console.log('Environment check:', {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!serviceRoleKey,
      urlPrefix: supabaseUrl?.substring(0, 20)
    });
    
    const supabaseClient = createClient(
      supabaseUrl ?? '',
      serviceRoleKey ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { projectId, userId } = await req.json()
    
    console.log('Request params:', { projectId, userId });
    
    if (!projectId || !userId) {
      console.log('Missing params, returning error');
      return new Response(
        JSON.stringify({ error: 'Missing projectId or userId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const mapboxToken = Deno.env.get('MAPBOX_PUBLIC_TOKEN')
    console.log('Mapbox token exists:', !!mapboxToken, 'length:', mapboxToken?.length);
    
    if (!mapboxToken) {
      console.log('No mapbox token, returning error');
      return new Response(
        JSON.stringify({ error: 'MAPBOX_PUBLIC_TOKEN not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get only Supplier and Customer nodes for the project
    console.log('Fetching nodes for project:', projectId);
    const { data: nodes, error: nodesError } = await supabaseClient
      .from('node_list')
      .select('id, node_id, node_type, node_group, location_text, latitude, longitude')
      .eq('project_id', projectId)
      .in('node_type', ['supplier','customer']);

    console.log('Node fetch result:', { 
      nodesCount: nodes?.length || 0, 
      hasError: !!nodesError,
      error: nodesError?.message
    });
    
    if (nodes && nodes.length > 0) {
      console.log('Sample nodes:', nodes.slice(0, 2));
    }

    if (nodesError) {
      console.error('Error fetching nodes:', nodesError);
      throw nodesError
    }

    const cache = new Map<string, GeocodeResult | null>();
    const metrics: ApiMetrics = { apiCalls: 0, cacheHits: 0 };
    let processed = 0;
    const concurrency = parseInt(Deno.env.get('GEOCODE_CONCURRENCY') ?? '5');

    const runWithConcurrency = async <T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> => {
      const results: T[] = new Array(tasks.length);
      let index = 0;
      async function worker() {
        while (index < tasks.length) {
          const current = index++;
          try {
            results[current] = await tasks[current]();
          } catch (err) {
            console.error('Worker error:', err);
            results[current] = null as unknown as T;
          }
        }
      }
      const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
      await Promise.allSettled(workers);
      return results;
    };

    if (nodes && nodes.length > 0) {
      console.log('Processing', nodes.length, 'nodes with concurrency', concurrency);

      const tasks = nodes.map((node, idx) => async () => {
        console.log(`Node ${idx + 1}:`, {
          id: node.node_id,
          hasLat: !!node.latitude,
          hasLng: !!node.longitude,
          locationText: node.location_text
        });

        if (node.latitude && node.longitude) {
          console.log(`Skipping ${node.node_id} - already has coordinates`);
          return null;
        }

        const locationText = node.location_text || inferLocationFromNodeId(node.node_id);
        console.log(`Geocoding ${node.node_id} with text: "${locationText}"`);

        const coordinates = await geocodeLocation(locationText, mapboxToken, cache, metrics);
        console.log(`Geocoding result for ${node.node_id}:`, coordinates);

        if (coordinates) {
          return {
            id: node.id,
            location_text: locationText,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude
          };
        }

        return null;
      });

      const updates = (await runWithConcurrency(tasks, concurrency)).filter(update => update !== null);
      console.log('Valid updates:', updates.length);

      for (const update of updates) {
        console.log('Updating database for node:', update!.id);
        const { error: updateError } = await supabaseClient
          .from('node_list')
          .update({
            location_text: update!.location_text,
            latitude: update!.latitude,
            longitude: update!.longitude
          })
          .eq('id', update!.id);

        if (updateError) {
          console.error('Update error:', updateError);
        } else {
          console.log('Successfully updated node');
          processed++;
        }
      }
    } else {
      console.log('No nodes to process');
    }

    // Optionally geocode plant location if missing
    let plantProcessed = false;
    console.log('Checking plant geocoding...');
    const { data: project, error: projError } = await supabaseClient
      .from('projects')
      .select('id, plant_name, plant_location_text, plant_latitude, plant_longitude')
      .eq('id', projectId)
      .single();

    console.log('Plant fetch result:', { 
      hasProject: !!project, 
      hasError: !!projError,
      error: projError?.message
    });

    if (!projError && project) {
      const hasPlantCoords = !!(project.plant_latitude && project.plant_longitude);
      const plantLocationText = project.plant_location_text || project.plant_name;
      console.log('Plant status:', { hasPlantCoords, plantLocationText });
      
      if (!hasPlantCoords && plantLocationText) {
        console.log('Geocoding plant:', plantLocationText);
        const plantCoords = await geocodeLocation(plantLocationText, mapboxToken, cache, metrics);
        console.log('Plant geocoding result:', plantCoords);
        
        if (plantCoords) {
          const { error: plantUpdateErr } = await supabaseClient
            .from('projects')
            .update({
              plant_location_text: plantLocationText,
              plant_latitude: plantCoords.latitude,
              plant_longitude: plantCoords.longitude
            })
            .eq('id', projectId);
          
          if (plantUpdateErr) {
            console.error('Plant update error:', plantUpdateErr);
          } else {
            console.log('Successfully updated plant coordinates');
            plantProcessed = true;
          }
        }
      }
    }

    console.log('=== GEOCODING FUNCTION END ===');
    console.log('Final result:', { processed, plantProcessed });
    console.log('API metrics:', metrics);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        total: nodes?.length || 0,
        plantProcessed,
        metrics,
        message: `Geocoded ${processed} nodes${plantProcessed ? ' + plant' : ''}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('=== GEOCODING FUNCTION ERROR ===');
    console.error('Error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})