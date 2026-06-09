import json
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

import structlog
from supabase import create_client, Client

from app.config import settings
from app.models.data_models import CombinedSimulationResults

logger = structlog.get_logger(__name__)

class DatabaseService:
    """Handles all database operations with Supabase"""
    
    def __init__(self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None):
        self.supabase_url = supabase_url or settings.supabase_url
        self.supabase_key = supabase_key or settings.supabase_service_role_key
        self.client: Optional[Client] = None
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Supabase URL and service role key must be provided")
    
    async def initialize(self):
        """Initialize database connection"""
        try:
            self.client = create_client(self.supabase_url, self.supabase_key)
            
            # Test connection
            await self.health_check()
            
            logger.info("Database service initialized successfully")
            
        except Exception as e:
            logger.error("Failed to initialize database service", error=str(e))
            raise
    
    async def close(self):
        """Close database connection"""
        if self.client:
            # Supabase client doesn't need explicit closing
            self.client = None
            logger.info("Database service closed")
    
    async def health_check(self):
        """Check database connectivity"""
        if not self.client:
            raise Exception("Database client not initialized")
        
        try:
            # Simple health check query
            result = self.client.table("projects").select("id").limit(1).execute()
            if result.data is None:
                raise Exception("Database query returned None")
                
        except Exception as e:
            logger.error("Database health check failed", error=str(e))
            raise
    
    async def get_supply_chain_data(
        self, project_id: str, plant_name: str, user_id: str, user_email: str
    ) -> List[Dict[str, Any]]:
        """Get supply chain data for a project"""
        try:
            # Set user context for RLS
            await self._set_user_context(user_id, user_email)
            
            # Call the existing function
            result = self.client.rpc(
                'get_supply_chain_data',
                {
                    'p_project_id': project_id,
                    'p_plant_name': plant_name,
                    'p_user_id': user_id,
                    'p_user_email': user_email
                }
            ).execute()
            
            if result.data is None:
                logger.warning("No supply chain data found", 
                             project_id=project_id,
                             plant_name=plant_name)
                return []
            
            return result.data
            
        except Exception as e:
            logger.error("Failed to get supply chain data", 
                        project_id=project_id, 
                        error=str(e))
            raise
    
    async def get_node_info(self, project_id: str, node_id: str) -> Dict[str, Any]:
        """Get detailed node information"""
        try:
            result = self.client.table("node_list").select("*").eq(
                "project_id", project_id
            ).eq("node_id", node_id).execute()
            
            if result.data and len(result.data) > 0:
                return result.data[0]
            else:
                # Return default node info if not found
                return {
                    'node_type': 'unknown',
                    'node_group': None,
                    'location_text': None,
                    'description_text': None,
                    'latitude': None,
                    'longitude': None,
                    'is_critical_node': False,
                    'critical_node_score': None,
                    'prediction_timestamp': None
                }
                
        except Exception as e:
            logger.error("Failed to get node info", 
                        project_id=project_id,
                        node_id=node_id,
                        error=str(e))
            return {}
    
    async def get_disruption_scenario(
        self, scenario_id: str, user_id: str, user_email: str
    ) -> Optional[Dict[str, Any]]:
        """Get disruption scenario with all related data"""
        try:
            # Set user context
            await self._set_user_context(user_id, user_email)
            
            # Get scenario profile
            profile_result = self.client.table("disruption_scenario_profiles").select(
                "*, disruption_scenario_targets(*), disruption_scenario_effects(*), disruption_scenario_settings(*)"
            ).eq("id", scenario_id).execute()
            
            if not profile_result.data or len(profile_result.data) == 0:
                return None
            
            profile_data = profile_result.data[0]
            
            # Process the scenario data
            scenario_data = {
                'scenario_id': scenario_id,
                'scenario_name': profile_data['scenario_name'],
                'description': profile_data.get('description'),
                'affected_nodes': [],
                'effects': [],
                'capacity_reduction_percent': 0,
                'time_delay_days': 0
            }
            
            # Extract affected nodes from targets
            for target in profile_data.get('disruption_scenario_targets', []):
                if target.get('node_ids'):
                    scenario_data['affected_nodes'].extend(target['node_ids'])
            
            # Extract effects
            for effect in profile_data.get('disruption_scenario_effects', []):
                effect_data = {
                    'effect_type': effect['effect_type'],
                    'magnitude': effect['magnitude'],
                    'unit': effect['unit']
                }
                scenario_data['effects'].append(effect_data)
                
                # Also set legacy fields for backward compatibility
                if effect['effect_type'] == 'capacity_reduction':
                    scenario_data['capacity_reduction_percent'] = effect['magnitude']
                elif effect['effect_type'] == 'time_delay':
                    scenario_data['time_delay_days'] = effect['magnitude']
            
            return scenario_data
            
        except Exception as e:
            logger.error("Failed to get disruption scenario", 
                        scenario_id=scenario_id,
                        error=str(e))
            raise
    
    async def save_simulation_results(self, results: CombinedSimulationResults) -> str:
        """Save simulation results to database"""
        try:
            # Prepare data for insertion
            result_data = {
                'project_id': results.project_id,
                'plant_name': results.plant_name,
                'status': 'completed',
                'scenario_ids': [scenario.scenario_id for scenario in results.scenarios],
                'started_at': results.generated_at - timedelta(seconds=results.execution_time_seconds),
                'completed_at': results.generated_at,
                'metrics': {
                    'baseline': results.baseline.dict() if results.baseline else None,
                    'scenarios': [scenario.dict() for scenario in results.scenarios],
                    'simulation_period': {
                        'start_day': 0,
                        'end_day': results.simulation_parameters.simulation_horizon_days
                    },
                    'available_kpis': results.simulation_parameters.enabled_kpis,
                    'scenario_comparison': results.scenario_comparison,
                    'risk_assessment': results.risk_assessment
                },
                'result_data': {
                    'simulation_parameters': results.simulation_parameters.dict(),
                    'execution_time_seconds': results.execution_time_seconds,
                    'generated_at': results.generated_at.isoformat()
                }
            }
            
            # Insert into simulation_results table
            insert_result = self.client.table("simulation_results").insert(result_data).execute()
            
            if not insert_result.data or len(insert_result.data) == 0:
                raise Exception("Failed to insert simulation results")
            
            result_id = insert_result.data[0]['id']
            
            logger.info("Simulation results saved successfully", result_id=result_id)
            return result_id
            
        except Exception as e:
            logger.error("Failed to save simulation results", error=str(e))
            raise
    
    async def save_job(self, job_data: Dict[str, Any]):
        """Save job to database"""
        try:
            # Convert priority enum to integer for database storage
            priority_value = job_data.get('priority', 'normal')
            if hasattr(priority_value, 'value'):
                priority_value = priority_value.value
            
            # Map priority strings to integers
            priority_map = {'low': 1, 'normal': 2, 'high': 3, 'urgent': 4}
            priority_int = priority_map.get(priority_value, 2) if isinstance(priority_value, str) else priority_value
            
            # Map fields to database schema
            db_data = {
                'job_id': job_data['job_id'],  # Use job_id instead of id
                'project_id': job_data['project_id'],
                'status': job_data['status'],
                'job_type': job_data['job_type'],
                'priority': priority_int,
                'config': job_data['config'],
                'progress': job_data.get('progress', 0),
                'created_at': job_data['created_at'],
                'queued_at': job_data['created_at']  # Set queued_at to created_at initially
            }
            
            result = self.client.table("simulation_jobs").insert(db_data).execute()
            
            if not result.data:
                raise Exception("Failed to insert job")
                
        except Exception as e:
            logger.error("Failed to save job", job_id=job_data.get('job_id'), error=str(e))
            raise
    
    async def update_job(self, job_data: Dict[str, Any]):
        """Update job in database"""
        try:
            job_id = job_data['job_id']
            
            # Prepare update data (only non-None values)
            update_data = {}
            
            field_mappings = {
                'status': 'status',
                'progress': 'progress',
                'current_stage': 'current_stage',
                'started_at': 'started_at',
                'completed_at': 'completed_at',
                'simulation_result_id': 'simulation_result_id',
                'error_message': 'error_message',
                'error_details': 'error_details'
            }
            
            for job_field, db_field in field_mappings.items():
                if job_field in job_data and job_data[job_field] is not None:
                    update_data[db_field] = job_data[job_field]
            
            # Handle performance metrics
            if job_data.get('performance_metrics'):
                # Store performance metrics in separate table
                await self._save_performance_metrics(job_id, job_data['performance_metrics'])
            
            if update_data:
                result = self.client.table("simulation_jobs").update(update_data).eq('job_id', job_id).execute()
                
                if not result.data:
                    logger.warning("Job update returned no data", job_id=job_id)
                    
        except Exception as e:
            logger.error("Failed to update job", job_id=job_data.get('job_id'), error=str(e))
            raise
    
    async def update_job_progress(self, job_id: str, progress: float, stage: str):
        """Update job progress"""
        try:
            update_data = {
                'progress': progress,
                'updated_at': datetime.now().isoformat()
            }
            
            if stage:
                # Store current stage in partial_results for now
                update_data['partial_results'] = {'current_stage': stage}
            
            result = self.client.table("simulation_jobs").update(update_data).eq('id', job_id).execute()
            
        except Exception as e:
            logger.warning("Failed to update job progress", job_id=job_id, error=str(e))
    
    async def get_job_by_id(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job by ID"""
        try:
            result = self.client.table("simulation_jobs").select("*").eq('id', job_id).execute()
            
            if result.data and len(result.data) > 0:
                return result.data[0]
            else:
                return None
                
        except Exception as e:
            logger.error("Failed to get job by ID", job_id=job_id, error=str(e))
            return None
    
    async def get_active_jobs(self) -> List[Dict[str, Any]]:
        """Get all active (non-completed) jobs"""
        try:
            result = self.client.table("simulation_jobs").select("*").in_(
                'status', ['pending', 'queued', 'running']
            ).execute()
            
            return result.data or []
            
        except Exception as e:
            logger.error("Failed to get active jobs", error=str(e))
            return []
    
    async def list_jobs(
        self,
        project_id: Optional[str] = None,
        status_filter: Optional[List[str]] = None,
        limit: int = 10,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """List jobs with filtering"""
        try:
            query = self.client.table("simulation_jobs").select("*")
            
            if project_id:
                query = query.eq('project_id', project_id)
            
            if status_filter:
                query = query.in_('status', status_filter)
            
            result = query.order('created_at', desc=True).range(offset, offset + limit - 1).execute()
            
            return result.data or []
            
        except Exception as e:
            logger.error("Failed to list jobs", error=str(e))
            return []
    
    async def count_jobs(
        self,
        project_id: Optional[str] = None,
        status_filter: Optional[List[str]] = None
    ) -> int:
        """Count jobs matching filters"""
        try:
            query = self.client.table("simulation_jobs").select("id", count="exact")
            
            if project_id:
                query = query.eq('project_id', project_id)
            
            if status_filter:
                query = query.in_('status', status_filter)
            
            result = query.execute()
            
            return result.count or 0
            
        except Exception as e:
            logger.error("Failed to count jobs", error=str(e))
            return 0
    
    async def count_recent_jobs(self, status: str, hours: int = 24) -> int:
        """Count recent jobs with specific status"""
        try:
            cutoff_time = datetime.now() - timedelta(hours=hours)
            
            result = self.client.table("simulation_jobs").select("id", count="exact").eq(
                'status', status
            ).gte('created_at', cutoff_time.isoformat()).execute()
            
            return result.count or 0
            
        except Exception as e:
            logger.error("Failed to count recent jobs", status=status, error=str(e))
            return 0
    
    async def _save_performance_metrics(self, job_id: str, metrics: Dict[str, Any]):
        """Save performance metrics to separate table"""
        try:
            # Get project_id from the job
            job_result = self.client.table("simulation_jobs").select("project_id").eq('id', job_id).execute()
            
            if not job_result.data or len(job_result.data) == 0:
                logger.warning("Job not found for performance metrics", job_id=job_id)
                return
            
            project_id = job_result.data[0]['project_id']
            
            # Prepare performance data
            perf_data = {
                'simulation_job_id': job_id,
                'project_id': project_id,
                **metrics  # Spread all metrics
            }
            
            result = self.client.table("simulation_performance_metrics").insert(perf_data).execute()
            
        except Exception as e:
            logger.warning("Failed to save performance metrics", job_id=job_id, error=str(e))
    
    async def _set_user_context(self, user_id: str, user_email: str):
        """Set user context for RLS policies"""
        try:
            result = self.client.rpc(
                'set_current_user_context',
                {
                    'user_id': user_id,
                    'user_email': user_email
                }
            ).execute()
            
        except Exception as e:
            logger.warning("Failed to set user context", 
                          user_id=user_id,
                          error=str(e))