// Context abstraction service to provide meaningful insights without sensitive data
import { DataSanitizer } from './dataSanitization';

export interface ProjectAbstract {
  project: {
    id: string;
    anonymizedName: string;
    plantType: string;
    supplyChainModel: string;
    bomLevel: string;
    completed: boolean;
    deepTierEnabled: boolean;
  };
  networkStructure: {
    totalNodes: number;
    totalEdges: number;
    nodeTypes: Record<string, number>;
    networkDepth: number;
    criticalNodeCount: number;
  };
  dataQuality: {
    hasInboundData: boolean;
    hasOutboundData: boolean;
    hasBomData: boolean;
    hasMultiTierData: boolean;
    completionPercentage: number;
  };
  insights: {
    supplyChainComplexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    riskExposure: 'LOW' | 'MEDIUM' | 'HIGH';
    dataMaturity: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED';
  };
  statistics: {
    totalSuppliers: number;
    totalCustomers: number;
    totalMaterials: number;
    totalProducts: number;
    averageConsumptionRate: number;
    simulationCount: number;
  };
}

export class ContextAbstraction {
  // Convert raw project data to abstract insights
  static createProjectAbstract(projectData: any): ProjectAbstract {
    const sanitizedProject = DataSanitizer.sanitizeObject(projectData.project || {});
    const supplyChainData = projectData.supplyChainData || [];
    const nodeList = projectData.nodeList || [];
    const simulations = projectData.simulations || [];

    // Calculate network structure metrics
    const nodeTypes = this.analyzeNodeTypes(nodeList);
    const criticalNodes = nodeList.filter((node: any) => node.is_critical_node);
    
    // Calculate data quality metrics
    const dataQuality = this.assessDataQuality(projectData);
    
    // Generate insights
    const insights = this.generateInsights(supplyChainData, nodeList, dataQuality);
    
    // Calculate statistics (anonymized)
    const statistics = this.calculateStatistics(supplyChainData, nodeList, simulations);

    return {
      project: {
        id: sanitizedProject.id || 'unknown',
        anonymizedName: DataSanitizer.createAnonymizedId(sanitizedProject.name || 'project', 'node'),
        plantType: sanitizedProject.plant_name ? 'MANUFACTURING_PLANT' : 'UNKNOWN',
        supplyChainModel: sanitizedProject.supply_chain_model || 'UNKNOWN',
        bomLevel: sanitizedProject.bom_level || 'single',
        completed: Boolean(sanitizedProject.completed),
        deepTierEnabled: Boolean(sanitizedProject.deep_tier_enabled),
      },
      networkStructure: {
        totalNodes: nodeList.length,
        totalEdges: supplyChainData.length,
        nodeTypes,
        networkDepth: this.calculateNetworkDepth(supplyChainData),
        criticalNodeCount: criticalNodes.length,
      },
      dataQuality,
      insights,
      statistics,
    };
  }

  private static analyzeNodeTypes(nodeList: any[]): Record<string, number> {
    const types: Record<string, number> = {};
    nodeList.forEach(node => {
      const type = node.node_type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    });
    return types;
  }

  private static assessDataQuality(projectData: any) {
    const hasInboundData = (projectData.inboundLogistics?.length || 0) > 0;
    const hasOutboundData = (projectData.outboundLogistics?.length || 0) > 0;
    const hasBomData = (projectData.bomData?.length || 0) > 0;
    const hasMultiTierData = (projectData.multiTierData?.length || 0) > 0;
    
    const completionMetrics = [hasInboundData, hasOutboundData, hasBomData].filter(Boolean).length;
    const completionPercentage = Math.round((completionMetrics / 3) * 100);

    return {
      hasInboundData,
      hasOutboundData,
      hasBomData,
      hasMultiTierData,
      completionPercentage,
    };
  }

  private static generateInsights(supplyChainData: any[], nodeList: any[], dataQuality: any) {
    // Supply chain complexity based on network size and structure
    const totalConnections = supplyChainData.length;
    const totalNodes = nodeList.length;
    
    let complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' = 'LOW';
    if (totalNodes > 100 && totalConnections > 200) complexity = 'VERY_HIGH';
    else if (totalNodes > 50 && totalConnections > 100) complexity = 'HIGH';
    else if (totalNodes > 20 && totalConnections > 40) complexity = 'MEDIUM';

    // Risk exposure based on critical nodes and network structure
    const criticalNodeRatio = nodeList.filter(n => n.is_critical_node).length / Math.max(totalNodes, 1);
    let riskExposure: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (criticalNodeRatio > 0.3) riskExposure = 'HIGH';
    else if (criticalNodeRatio > 0.15) riskExposure = 'MEDIUM';

    // Data maturity based on completion and quality
    let dataMaturity: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED' = 'BASIC';
    if (dataQuality.completionPercentage >= 80 && dataQuality.hasMultiTierData) {
      dataMaturity = 'ADVANCED';
    } else if (dataQuality.completionPercentage >= 60) {
      dataMaturity = 'INTERMEDIATE';
    }

    return {
      supplyChainComplexity: complexity,
      riskExposure,
      dataMaturity,
    };
  }

  private static calculateStatistics(supplyChainData: any[], nodeList: any[], simulations: any[]) {
    const nodeTypes = this.analyzeNodeTypes(nodeList);
    
    return {
      totalSuppliers: nodeTypes.supplier || 0,
      totalCustomers: nodeTypes.customer || 0,
      totalMaterials: nodeTypes.material || 0,
      totalProducts: nodeTypes.product || 0,
      averageConsumptionRate: this.calculateAverageConsumption(supplyChainData),
      simulationCount: simulations.length,
    };
  }

  private static calculateNetworkDepth(supplyChainData: any[]): number {
    // Simplified depth calculation - in a real implementation you'd do proper graph traversal
    const bomData = supplyChainData.filter(d => d.data_source === 'bom');
    if (bomData.length === 0) return 1;
    
    const levels = bomData.map(d => d.level || 1);
    return Math.max(...levels, 1);
  }

  private static calculateAverageConsumption(supplyChainData: any[]): number {
    const consumptionRates = supplyChainData
      .map(d => d.material_consumption_rate)
      .filter(rate => rate && !isNaN(rate));
    
    if (consumptionRates.length === 0) return 0;
    
    const sum = consumptionRates.reduce((acc, rate) => acc + rate, 0);
    return Math.round(sum / consumptionRates.length * 100) / 100;
  }
}