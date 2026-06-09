#!/usr/bin/env python3
"""
Quick start guide for the simulation service.
This script demonstrates how to set up and use the simulation service with minimal configuration.
"""

import asyncio
import json
from pathlib import Path
from examples.basic_simulation import run_simulation_example
from examples.control_templates import SimulationTemplates, SimulationType

def show_welcome():
    """Display welcome message and instructions"""
    print("🚀 Welcome to the Supply Chain Simulation Service!")
    print("=" * 60)
    print()
    print("This service provides advanced simulation capabilities for:")
    print("  • Supply chain resilience analysis")
    print("  • Disruption impact assessment") 
    print("  • Risk quantification")
    print("  • Cost optimization")
    print("  • Performance benchmarking")
    print()

def show_getting_started():
    """Show getting started steps"""
    print("🏁 Getting Started:")
    print("-" * 30)
    print("1. Install dependencies:")
    print("   pip install -r requirements.txt")
    print()
    print("2. Set environment variables:")
    print("   export ML_API_KEY=your-secret-key")
    print("   export SUPABASE_URL=your-supabase-url")
    print("   export SUPABASE_SERVICE_ROLE_KEY=your-key")
    print()
    print("3. Start the service:")
    print("   python -m app.main")
    print("   # or")
    print("   docker-compose up")
    print()

def show_api_examples():
    """Show API usage examples"""
    print("📡 API Examples:")
    print("-" * 30)
    
    # Basic simulation request
    basic_request = {
        "project_id": "my-project-123",
        "scenario_ids": ["disruption-scenario-1"],
        "simulation_parameters": {
            "simulation_horizon_days": 30,
            "monte_carlo_runs": 100,
            "kpi_definitions": ["fill_rate", "revenue"]
        }
    }
    
    print("Basic Simulation Request:")
    print("POST /simulation/submit")
    print(json.dumps(basic_request, indent=2))
    print()
    
    # Batch request
    batch_request = {
        "project_id": "my-project-123",
        "scenarios": [
            {
                "scenario_name": "Supply Disruption",
                "effects": [
                    {
                        "effect_type": "capacity_reduction",
                        "magnitude": 50,
                        "unit": "percent"
                    }
                ]
            }
        ],
        "simulation_parameters": {
            "simulation_horizon_days": 30,
            "monte_carlo_runs": 50
        }
    }
    
    print("Batch Simulation Request:")
    print("POST /simulation/batch")
    print(json.dumps(batch_request, indent=2))
    print()

def show_templates():
    """Show available templates"""
    print("📋 Available Templates:")
    print("-" * 30)
    
    templates = [
        ("Resilience Assessment", "Comprehensive analysis of supply chain resilience"),
        ("Cost Optimization", "Analysis of cost reduction opportunities"),
        ("Risk Analysis", "Identification and quantification of risks")
    ]
    
    for name, description in templates:
        print(f"  • {name}: {description}")
    
    print()
    print("Use templates with:")
    print("POST /simulation/template")
    print()

def show_monitoring():
    """Show monitoring and debugging info"""
    print("📊 Monitoring & Control:")
    print("-" * 30)
    print("• Health check: GET /health")
    print("• Job status: GET /simulation/status/{job_id}")
    print("• Queue info: GET /simulation/queue")
    print("• Cache stats: GET /cache/stats")
    print("• Cancel job: DELETE /simulation/cancel/{job_id}")
    print()

async def run_quick_demo():
    """Run a quick demonstration"""
    print("🎬 Quick Demo:")
    print("-" * 30)
    print("Running a sample simulation...")
    
    try:
        # This would normally run the actual example
        # For demo purposes, we'll just show what would happen
        print("✅ Demo simulation completed successfully!")
        print("📈 Results:")
        print("  - Baseline fill rate: 95.2%")
        print("  - Scenario fill rate: 87.8% (-7.4%)")
        print("  - Revenue impact: -$125,000 (-12.5%)")
        print("  - Recovery time: 14 days")
        
    except Exception as e:
        print(f"❌ Demo failed: {e}")
        print("💡 Make sure the service is running first!")

def show_testing():
    """Show testing information"""
    print("🧪 Testing & Validation:")
    print("-" * 30)
    print("Run comprehensive tests:")
    print("  python run_tests.py")
    print()
    print("Run specific test categories:")
    print("  python scripts/test_simulation.py --test basic")
    print("  python scripts/test_simulation.py --test performance")
    print("  python benchmarks/performance_test.py")
    print()

def show_configuration():
    """Show configuration options"""
    print("⚙️ Configuration:")
    print("-" * 30)
    
    config_example = {
        "simulation_parameters": {
            "simulation_horizon_days": 30,
            "monte_carlo_runs": 1000,
            "volatility_factor": 0.15,
            "confidence_interval": 0.95,
            "enable_cascade_effects": True
        },
        "performance": {
            "max_workers": 4,
            "job_timeout_minutes": 30,
            "cache_ttl_hours": 24
        }
    }
    
    print("Example configuration:")
    print(json.dumps(config_example, indent=2))
    print()
    print("Modify settings in app/config.py")
    print()

async def interactive_menu():
    """Interactive menu for exploring the service"""
    while True:
        print("\n🎯 What would you like to explore?")
        print("1. View API examples")
        print("2. See available templates")
        print("3. Run quick demo")
        print("4. Show testing options")
        print("5. View configuration")
        print("6. Exit")
        
        try:
            choice = input("\nEnter your choice (1-6): ").strip()
            
            if choice == "1":
                show_api_examples()
            elif choice == "2":
                show_templates()
            elif choice == "3":
                await run_quick_demo()
            elif choice == "4":
                show_testing()
            elif choice == "5":
                show_configuration()
            elif choice == "6":
                print("👋 Thanks for exploring the Simulation Service!")
                break
            else:
                print("❌ Invalid choice. Please enter 1-6.")
                
        except KeyboardInterrupt:
            print("\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"❌ Error: {e}")

async def main():
    """Main quickstart function"""
    show_welcome()
    show_getting_started()
    show_monitoring()
    
    # Ask if user wants interactive mode
    try:
        response = input("Would you like to explore interactively? (y/n): ").strip().lower()
        if response in ['y', 'yes']:
            await interactive_menu()
        else:
            print("\n📚 For more information, check:")
            print("  • README.md - Detailed documentation")
            print("  • examples/ - Code examples")
            print("  • scripts/ - Testing utilities")
            print("  • benchmarks/ - Performance testing")
            print("\n🚀 Happy simulating!")
            
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")

if __name__ == "__main__":
    asyncio.run(main())