interface GeocodeResult {
  longitude: number;
  latitude: number;
  confidence: number;
  place_name: string;
}

interface GeocodingMetrics {
  totalRequests: number;
  cacheHits: number;
  apiCalls: number;
  startTime: number;
  endTime?: number;
}

export interface LocationData {
  nodeId: string;
  locationText: string;
  coordinates?: GeocodeResult;
}

export class GeocodingService {
  private mapboxToken: string;
  private baseUrl = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
  private cache = new Map<string, GeocodeResult | null>();
  private metrics: GeocodingMetrics = {
    totalRequests: 0,
    cacheHits: 0,
    apiCalls: 0,
    startTime: 0
  };

  constructor(token: string) {
    this.mapboxToken = token;
  }

  async geocodeLocation(locationText: string): Promise<GeocodeResult | null> {
    if (!locationText || locationText.trim().length === 0) {
      return null;
    }

    this.metrics.totalRequests++;
    const cached = this.cache.get(locationText);
    if (cached !== undefined) {
      this.metrics.cacheHits++;
      return cached;
    }

    try {
      const encodedLocation = encodeURIComponent(locationText.trim());
      const url = `${this.baseUrl}/${encodedLocation}.json?access_token=${this.mapboxToken}&limit=1&types=place,locality,region,country`;
      
      this.metrics.apiCalls++;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Geocoding API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.features && data.features.length > 0) {
        const feature = data.features[0];
        const [longitude, latitude] = feature.center;

        const result = {
          longitude,
          latitude,
          confidence: feature.relevance || 0,
          place_name: feature.place_name || locationText
        };
        this.cache.set(locationText, result);
        return result;
      }

      this.cache.set(locationText, null);
      return null;
    } catch (error) {
      console.error('Geocoding error for location:', locationText, error);
      this.cache.set(locationText, null);
      return null;
    }
  }
  async geocodeBatch(locations: LocationData[], concurrency = 5): Promise<LocationData[]> {
    this.metrics = {
      totalRequests: 0,
      cacheHits: 0,
      apiCalls: 0,
      startTime: Date.now()
    };

    const tasks = locations.map((location) => async () => {
      const coordinates = await this.geocodeLocation(location.locationText);
      return { ...location, coordinates };
    });

    const results: LocationData[] = new Array(locations.length);
    let index = 0;

    async function worker() {
      while (index < tasks.length) {
        const current = index++;
        results[current] = await tasks[current]();
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, tasks.length) },
      () => worker()
    );
    await Promise.allSettled(workers);

    this.metrics.endTime = Date.now();
    return results;
  }

  getMetrics(): GeocodingMetrics {
    return { ...this.metrics };
  }
  // Helper method to infer location from node ID
  static inferLocationFromNodeId(nodeId: string): string {
    // Supplier nodes - try to extract meaningful location info
    if (nodeId.startsWith('S')) {
      const supplierNumber = parseInt(nodeId.replace('S', '')) || 1;
      
      // Sample supplier locations for demo
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
    
    // Product nodes - typically manufacturing centers
    if (nodeId.startsWith('P')) {
      const productNumber = parseInt(nodeId.replace('P', '')) || 1;
      
      const manufacturingCenters = [
        'Detroit, USA', 'Stuttgart, Germany', 'Turin, Italy', 'Yokohama, Japan',
        'Guangzhou, China', 'Chennai, India', 'São José dos Campos, Brazil',
        'Puebla, Mexico', 'Cologne, Germany', 'Birmingham, UK'
      ];
      
      return manufacturingCenters[productNumber % manufacturingCenters.length] || `Manufacturing Center ${productNumber}`;
    }
    
    // Material nodes - less geographic, return generic
    return `Material Processing Facility`;
  }

  // Validate coordinate bounds
  static isValidCoordinate(longitude: number, latitude: number): boolean {
    return (
      longitude >= -180 && longitude <= 180 &&
      latitude >= -90 && latitude <= 90
    );
  }
}

export default GeocodingService;