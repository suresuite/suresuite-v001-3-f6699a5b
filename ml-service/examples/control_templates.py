#!/usr/bin/env python3
"""
Simulation control templates for different types of supply chain analysis.
These templates provide pre-configured simulation scenarios for common use cases.
"""

from typing import Dict, List, Any
from dataclasses import dataclass
from enum import Enum

class SimulationType(Enum):
    RESILIENCE_ASSESSMENT = "resilience_assessment"
    COST_OPTIMIZATION = "cost_optimization"
    RISK_ANALYSIS = "risk_analysis"
    CAPACITY_PLANNING = "capacity_planning"
    DISRUPTION_RESPONSE = "disruption_response"

@dataclass
class SimulationTemplate:
    name: str
    description: str
    simulation_type: SimulationType
    parameters: Dict[str, Any]
    scenarios: List[Dict[str, Any]]
    expected_kpis: List[str]

class SimulationTemplates:
    """Collection of pre-defined simulation templates"""
    
    @staticmethod
    def supply_chain_resilience() -> SimulationTemplate:
        """Template for assessing supply chain resilience"""
        return SimulationTemplate(
            name="Supply Chain Resilience Assessment",
            description="Comprehensive analysis of supply chain ability to withstand and recover from disruptions",
            simulation_type=SimulationType.RESILIENCE_ASSESSMENT,
            parameters={
                "simulation_horizon_days": 90,
                "monte_carlo_runs": 1000,
                "volatility_factor": 0.15,
                "enable_cascade_effects": True,
                "recovery_modeling": True,
                "confidence_interval": 0.95
            },
            scenarios=[
                {
                    "scenario_name": "Major Supplier Disruption",
                    "description": "Complete shutdown of primary supplier",
                    "targets": [{"target_type": "node", "node_ids": ["primary_supplier"]}],
                    "effects": [
                        {
                            "effect_type": "capacity_reduction",
                            "magnitude": 100,
                            "unit": "percent",
                            "duration_days": 14
                        }
                    ],
                    "recovery_profile": "gradual",
                    "recovery_time_days": 30
                },
                {
                    "scenario_name": "Transportation Network Failure",
                    "description": "Major transportation route disruption",
                    "targets": [{"target_type": "edge", "edge_criteria": {"transport_mode": "road"}}],
                    "effects": [
                        {
                            "effect_type": "time_delay",
                            "magnitude": 5,
                            "unit": "days",
                            "duration_days": 21
                        }
                    ]
                },
                {
                    "scenario_name": "Demand Volatility Spike",
                    "description": "Sudden 300% increase in customer demand",
                    "targets": [{"target_type": "node", "node_type": "customer"}],
                    "effects": [
                        {
                            "effect_type": "demand_increase",
                            "magnitude": 300,
                            "unit": "percent",
                            "duration_days": 7
                        }
                    ]
                }
            ],
            expected_kpis=[
                "fill_rate", "delivery_on_time", "backlog", 
                "resilience_cost", "recovery_time", "cascading_impact"
            ]
        )
    
    @staticmethod
    def cost_optimization() -> SimulationTemplate:
        """Template for supply chain cost optimization analysis"""
        return SimulationTemplate(
            name="Supply Chain Cost Optimization",
            description="Analysis of cost reduction opportunities and trade-offs",
            simulation_type=SimulationType.COST_OPTIMIZATION,
            parameters={
                "simulation_horizon_days": 365,
                "monte_carlo_runs": 500,
                "volatility_factor": 0.1,
                "cost_optimization": True,
                "inventory_optimization": True
            },
            scenarios=[
                {
                    "scenario_name": "Lean Inventory Strategy",
                    "description": "Reduce inventory levels by 30%",
                    "targets": [{"target_type": "node", "node_type": "warehouse"}],
                    "effects": [
                        {
                            "effect_type": "inventory_reduction",
                            "magnitude": 30,
                            "unit": "percent"
                        }
                    ]
                },
                {
                    "scenario_name": "Supplier Consolidation",
                    "description": "Reduce supplier base by 40%",
                    "targets": [{"target_type": "node", "node_type": "supplier"}],
                    "effects": [
                        {
                            "effect_type": "supplier_reduction",
                            "magnitude": 40,
                            "unit": "percent"
                        }
                    ]
                }
            ],
            expected_kpis=[
                "total_cost", "inventory_cost", "transportation_cost",
                "procurement_cost", "service_level", "profit_margin"
            ]
        )
    
    @staticmethod
    def risk_analysis() -> SimulationTemplate:
        """Template for comprehensive risk analysis"""
        return SimulationTemplate(
            name="Supply Chain Risk Analysis",
            description="Identification and quantification of supply chain risks",
            simulation_type=SimulationType.RISK_ANALYSIS,
            parameters={
                "simulation_horizon_days": 180,
                "monte_carlo_runs": 2000,
                "volatility_factor": 0.2,
                "risk_modeling": True,
                "stress_testing": True
            },
            scenarios=[
                {
                    "scenario_name": "Geopolitical Risk",
                    "description": "Trade restrictions affect 25% of suppliers",
                    "targets": [{"target_type": "node", "selection_criteria": {"geography": "high_risk_region"}}],
                    "effects": [
                        {
                            "effect_type": "capacity_reduction",
                            "magnitude": 80,
                            "unit": "percent",
                            "probability": 0.15
                        }
                    ]
                },
                {
                    "scenario_name": "Natural Disaster",
                    "description": "Regional natural disaster affects multiple facilities",
                    "targets": [{"target_type": "region", "region_id": "disaster_zone"}],
                    "effects": [
                        {
                            "effect_type": "facility_shutdown",
                            "magnitude": 100,
                            "unit": "percent",
                            "duration_days": 45,
                            "probability": 0.05
                        }
                    ]
                },
                {
                    "scenario_name": "Cyber Attack",
                    "description": "IT systems compromised affecting visibility and operations",
                    "targets": [{"target_type": "system", "system_type": "IT_infrastructure"}],
                    "effects": [
                        {
                            "effect_type": "visibility_reduction",
                            "magnitude": 70,
                            "unit": "percent",
                            "duration_days": 10
                        }
                    ]
                }
            ],
            expected_kpis=[
                "value_at_risk", "expected_shortfall", "risk_adjusted_return",
                "probability_of_disruption", "maximum_loss", "diversification_index"
            ]
        )

class SimulationController:
    """Controller for managing and executing simulation templates"""
    
    def __init__(self, service_url: str, api_key: str):
        self.service_url = service_url
        self.api_key = api_key
        self.templates = {
            SimulationType.RESILIENCE_ASSESSMENT: SimulationTemplates.supply_chain_resilience(),
            SimulationType.COST_OPTIMIZATION: SimulationTemplates.cost_optimization(),
            SimulationType.RISK_ANALYSIS: SimulationTemplates.risk_analysis()
        }
    
    def get_template(self, simulation_type: SimulationType) -> SimulationTemplate:
        """Get a simulation template by type"""
        return self.templates.get(simulation_type)
    
    def customize_template(self, template: SimulationTemplate, **kwargs) -> Dict[str, Any]:
        """Customize a template with specific parameters"""
        
        # Start with template parameters
        parameters = template.parameters.copy()
        
        # Update with custom parameters
        for key, value in kwargs.items():
            if key in parameters:
                parameters[key] = value
        
        return {
            "template_name": template.name,
            "simulation_type": template.simulation_type.value,
            "parameters": parameters,
            "scenarios": template.scenarios,
            "expected_kpis": template.expected_kpis
        }
    
    async def run_template_simulation(self, project_id: str, template: SimulationTemplate, **customizations):
        """Execute a simulation using a template"""
        
        # Customize the template
        simulation_config = self.customize_template(template, **customizations)
        
        # Prepare the request
        request = {
            "project_id": project_id,
            "template_config": simulation_config,
            "simulation_parameters": simulation_config["parameters"],
            "scenarios": simulation_config["scenarios"]
        }
        
        print(f"🚀 Running {template.name}")
        print(f"📊 Expected KPIs: {', '.join(template.expected_kpis)}")
        print(f"🎯 Scenarios: {len(template.scenarios)}")
        
        return request

# Example usage functions
def create_custom_resilience_analysis(project_id: str, monte_carlo_runs: int = 1000):
    """Create a custom resilience analysis"""
    controller = SimulationController("http://localhost:8000", "your-api-key")
    template = controller.get_template(SimulationType.RESILIENCE_ASSESSMENT)
    
    return controller.customize_template(
        template,
        monte_carlo_runs=monte_carlo_runs,
        simulation_horizon_days=60,
        confidence_interval=0.99
    )

def create_quick_risk_assessment(project_id: str):
    """Create a quick risk assessment with reduced parameters"""
    controller = SimulationController("http://localhost:8000", "your-api-key")
    template = controller.get_template(SimulationType.RISK_ANALYSIS)
    
    return controller.customize_template(
        template,
        simulation_horizon_days=30,
        monte_carlo_runs=100,
        stress_testing=False
    )

# Configuration examples
SIMULATION_CONFIGS = {
    "quick_test": {
        "simulation_horizon_days": 7,
        "monte_carlo_runs": 10,
        "volatility_factor": 0.05
    },
    "standard_analysis": {
        "simulation_horizon_days": 30,
        "monte_carlo_runs": 500,
        "volatility_factor": 0.1
    },
    "comprehensive_study": {
        "simulation_horizon_days": 180,
        "monte_carlo_runs": 2000,
        "volatility_factor": 0.15
    },
    "high_precision": {
        "simulation_horizon_days": 365,
        "monte_carlo_runs": 5000,
        "volatility_factor": 0.2,
        "confidence_interval": 0.99
    }
}

if __name__ == "__main__":
    # Example: Create and display templates
    resilience_template = SimulationTemplates.supply_chain_resilience()
    print(f"Template: {resilience_template.name}")
    print(f"Scenarios: {len(resilience_template.scenarios)}")
    print(f"KPIs: {resilience_template.expected_kpis}")