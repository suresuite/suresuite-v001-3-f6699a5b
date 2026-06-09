interface SupplyChainData {
  id: string;
  plant_name: string;
  from_location: string;
  to_location: string;
  material_consumption_rate: number;
  sourcing_ratio: number;
  weighted: number;
  data_source?: string;
}

interface SupplierMetrics {
  supplierDiversity: number;
  singleSourceRisk: string;
}

interface MaterialMetrics {
  materialDiversity: number;
  materialConcentrationRisk: string;
}

export const calculateSupplierMetrics = (data: SupplyChainData[]): SupplierMetrics => {
  // Get unique suppliers from inbound data
  const suppliers = new Set(
    data
      .filter(d => d.data_source === 'inbound')
      .map(d => d.from_location)
  );
  
  // Get materials and their supplier counts
  const materialSupplierMap = new Map<string, Set<string>>();
  
  data
    .filter(d => d.data_source === 'inbound')
    .forEach(d => {
      if (!materialSupplierMap.has(d.to_location)) {
        materialSupplierMap.set(d.to_location, new Set());
      }
      materialSupplierMap.get(d.to_location)!.add(d.from_location);
    });
  
  // Calculate single source risk
  const materialsWithSingleSupplier = Array.from(materialSupplierMap.values())
    .filter(suppliers => suppliers.size === 1).length;
  
  const totalMaterials = materialSupplierMap.size;
  const singleSourceRisk = totalMaterials > 0 
    ? ((materialsWithSingleSupplier / totalMaterials) * 100).toFixed(1) + '%'
    : '0%';
  
  return {
    supplierDiversity: suppliers.size,
    singleSourceRisk,
  };
};

export const calculateMaterialMetrics = (data: SupplyChainData[]): MaterialMetrics => {
  // Get unique materials from inbound data
  const materials = new Set(
    data
      .filter(d => d.data_source === 'inbound')
      .map(d => d.to_location)
  );
  
  // Calculate material concentration risk (>70% from single supplier)
  const materialSupplierVolumes = new Map<string, Map<string, number>>();
  
  data
    .filter(d => d.data_source === 'inbound' && d.weighted > 0)
    .forEach(d => {
      if (!materialSupplierVolumes.has(d.to_location)) {
        materialSupplierVolumes.set(d.to_location, new Map());
      }
      const supplierMap = materialSupplierVolumes.get(d.to_location)!;
      supplierMap.set(d.from_location, (supplierMap.get(d.from_location) || 0) + d.weighted);
    });
  
  let concentratedMaterials = 0;
  let totalMaterialsWithVolume = 0;
  
  materialSupplierVolumes.forEach((supplierMap, material) => {
    const volumes = Array.from(supplierMap.values());
    const totalVolume = volumes.reduce((sum, vol) => sum + vol, 0);
    
    if (totalVolume > 0) {
      totalMaterialsWithVolume++;
      const maxVolume = Math.max(...volumes);
      const concentration = maxVolume / totalVolume;
      
      if (concentration > 0.7) {
        concentratedMaterials++;
      }
    }
  });
  
  const materialConcentrationRisk = totalMaterialsWithVolume > 0
    ? ((concentratedMaterials / totalMaterialsWithVolume) * 100).toFixed(1) + '%'
    : '0%';
  
  return {
    materialDiversity: materials.size,
    materialConcentrationRisk,
  };
};