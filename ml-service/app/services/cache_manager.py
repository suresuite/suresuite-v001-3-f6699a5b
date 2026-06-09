import json
import hashlib
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta

import structlog
try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

from app.models.request_models import CacheRequest
from app.models.response_models import CacheResponse, CacheStats

logger = structlog.get_logger(__name__)

class CacheManager:
    """Manages caching for simulation data and results"""
    
    def __init__(
        self,
        redis_url: Optional[str] = None,
        redis_host: str = "localhost",
        redis_port: int = 6379,
        redis_db: int = 0,
        default_ttl_hours: int = 24
    ):
        self.redis_url = redis_url
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.redis_db = redis_db
        self.default_ttl_hours = default_ttl_hours
        
        # Redis client
        self.redis_client: Optional[redis.Redis] = None
        
        # In-memory fallback cache
        self.memory_cache: Dict[str, Dict[str, Any]] = {}
        self.cache_metadata: Dict[str, Dict[str, Any]] = {}
        
        # Cache statistics
        self.stats = {
            'hits': 0,
            'misses': 0,
            'sets': 0,
            'deletes': 0
        }
        
        self.use_redis = REDIS_AVAILABLE and (redis_url or redis_host)
        
        logger.info("CacheManager initialized", 
                   use_redis=self.use_redis,
                   default_ttl_hours=default_ttl_hours)
    
    async def initialize(self):
        """Initialize cache connections"""
        if self.use_redis:
            try:
                if self.redis_url:
                    self.redis_client = redis.from_url(self.redis_url)
                else:
                    self.redis_client = redis.Redis(
                        host=self.redis_host,
                        port=self.redis_port,
                        db=self.redis_db,
                        decode_responses=True
                    )
                
                # Test connection
                await self.redis_client.ping()
                
                logger.info("Redis cache initialized successfully")
                
            except Exception as e:
                logger.warning("Failed to initialize Redis, falling back to memory cache", error=str(e))
                self.use_redis = False
                self.redis_client = None
        else:
            logger.info("Using in-memory cache (Redis not available)")
    
    async def close(self):
        """Close cache connections"""
        if self.redis_client:
            await self.redis_client.aclose()
            logger.info("Redis cache connection closed")
    
    async def health_check(self):
        """Check cache health"""
        if self.use_redis and self.redis_client:
            try:
                await self.redis_client.ping()
            except Exception as e:
                raise Exception(f"Redis health check failed: {str(e)}")
        else:
            # Memory cache is always healthy
            pass
    
    async def get(
        self, 
        cache_key: str, 
        cache_type: str = "general"
    ) -> Optional[Dict[str, Any]]:
        """Get data from cache"""
        try:
            full_key = f"{cache_type}:{cache_key}"
            
            if self.use_redis and self.redis_client:
                # Get from Redis
                data = await self.redis_client.get(full_key)
                if data:
                    self.stats['hits'] += 1
                    return json.loads(data)
                else:
                    self.stats['misses'] += 1
                    return None
            else:
                # Get from memory cache
                if full_key in self.memory_cache:
                    # Check expiration
                    metadata = self.cache_metadata.get(full_key, {})
                    expires_at = metadata.get('expires_at')
                    
                    if expires_at and datetime.now() > expires_at:
                        # Expired, remove it
                        del self.memory_cache[full_key]
                        del self.cache_metadata[full_key]
                        self.stats['misses'] += 1
                        return None
                    
                    # Update access info
                    metadata['access_count'] = metadata.get('access_count', 0) + 1
                    metadata['last_accessed_at'] = datetime.now()
                    
                    self.stats['hits'] += 1
                    return self.memory_cache[full_key]
                else:
                    self.stats['misses'] += 1
                    return None
                    
        except Exception as e:
            logger.warning("Cache get failed", cache_key=cache_key, error=str(e))
            self.stats['misses'] += 1
            return None
    
    async def set(
        self,
        cache_key: str,
        data: Dict[str, Any],
        ttl_hours: Optional[int] = None,
        cache_type: str = "general"
    ) -> bool:
        """Set data in cache"""
        try:
            full_key = f"{cache_type}:{cache_key}"
            ttl_hours = ttl_hours or self.default_ttl_hours
            expires_at = datetime.now() + timedelta(hours=ttl_hours)
            
            if self.use_redis and self.redis_client:
                # Set in Redis with TTL
                ttl_seconds = ttl_hours * 3600
                await self.redis_client.setex(
                    full_key, 
                    ttl_seconds, 
                    json.dumps(data, default=str)
                )
            else:
                # Set in memory cache
                self.memory_cache[full_key] = data
                self.cache_metadata[full_key] = {
                    'created_at': datetime.now(),
                    'expires_at': expires_at,
                    'access_count': 0,
                    'cache_type': cache_type,
                    'data_hash': self._generate_data_hash(data)
                }
            
            self.stats['sets'] += 1
            return True
            
        except Exception as e:
            logger.warning("Cache set failed", cache_key=cache_key, error=str(e))
            return False
    
    async def delete(
        self,
        cache_key: str = None,
        cache_type: str = "general",
        pattern: str = None
    ) -> int:
        """Delete data from cache"""
        try:
            deleted_count = 0
            
            if self.use_redis and self.redis_client:
                if pattern:
                    # Delete by pattern
                    keys = await self.redis_client.keys(pattern)
                    if keys:
                        deleted_count = await self.redis_client.delete(*keys)
                elif cache_key:
                    # Delete specific key
                    full_key = f"{cache_type}:{cache_key}"
                    deleted_count = await self.redis_client.delete(full_key)
                else:
                    # Delete all keys for cache type
                    keys = await self.redis_client.keys(f"{cache_type}:*")
                    if keys:
                        deleted_count = await self.redis_client.delete(*keys)
            else:
                # Delete from memory cache
                if pattern:
                    # Simple pattern matching for memory cache
                    keys_to_delete = [
                        key for key in self.memory_cache.keys()
                        if pattern.replace('*', '') in key
                    ]
                    for key in keys_to_delete:
                        del self.memory_cache[key]
                        if key in self.cache_metadata:
                            del self.cache_metadata[key]
                        deleted_count += 1
                elif cache_key:
                    # Delete specific key
                    full_key = f"{cache_type}:{cache_key}"
                    if full_key in self.memory_cache:
                        del self.memory_cache[full_key]
                        if full_key in self.cache_metadata:
                            del self.cache_metadata[full_key]
                        deleted_count = 1
                else:
                    # Delete all keys for cache type
                    keys_to_delete = [
                        key for key in self.memory_cache.keys()
                        if key.startswith(f"{cache_type}:")
                    ]
                    for key in keys_to_delete:
                        del self.memory_cache[key]
                        if key in self.cache_metadata:
                            del self.cache_metadata[key]
                        deleted_count += 1
            
            self.stats['deletes'] += deleted_count
            return deleted_count
            
        except Exception as e:
            logger.warning("Cache delete failed", cache_key=cache_key, error=str(e))
            return 0
    
    async def get_stats(self, cache_type: Optional[str] = None) -> CacheStats:
        """Get cache statistics"""
        try:
            if self.use_redis and self.redis_client:
                # Get Redis info
                info = await self.redis_client.info('memory')
                
                # Count keys by type if specified
                cache_types = {}
                if cache_type:
                    keys = await self.redis_client.keys(f"{cache_type}:*")
                    cache_types[cache_type] = len(keys)
                else:
                    # Get all cache types (this is expensive, use carefully)
                    all_keys = await self.redis_client.keys("*")
                    for key in all_keys:
                        key_type = key.split(':', 1)[0] if ':' in key else 'unknown'
                        cache_types[key_type] = cache_types.get(key_type, 0) + 1
                
                total_entries = sum(cache_types.values())
                total_size_mb = info.get('used_memory', 0) / (1024 * 1024)
                
                # Calculate hit rate
                total_requests = self.stats['hits'] + self.stats['misses']
                hit_rate = (self.stats['hits'] / total_requests * 100) if total_requests > 0 else 0
                
                return CacheStats(
                    total_entries=total_entries,
                    active_entries=total_entries,  # Redis auto-expires
                    expired_entries=0,
                    total_size_mb=total_size_mb,
                    hit_rate_percent=hit_rate,
                    cache_types=cache_types
                )
            else:
                # Memory cache stats
                now = datetime.now()
                active_entries = 0
                expired_entries = 0
                cache_types = {}
                
                for key, metadata in self.cache_metadata.items():
                    key_type = metadata.get('cache_type', 'unknown')
                    cache_types[key_type] = cache_types.get(key_type, 0) + 1
                    
                    if metadata.get('expires_at') and now > metadata['expires_at']:
                        expired_entries += 1
                    else:
                        active_entries += 1
                
                # Rough size calculation for memory cache
                total_size_mb = len(json.dumps(self.memory_cache, default=str)) / (1024 * 1024)
                
                # Calculate hit rate
                total_requests = self.stats['hits'] + self.stats['misses']
                hit_rate = (self.stats['hits'] / total_requests * 100) if total_requests > 0 else 0
                
                return CacheStats(
                    total_entries=len(self.memory_cache),
                    active_entries=active_entries,
                    expired_entries=expired_entries,
                    total_size_mb=total_size_mb,
                    hit_rate_percent=hit_rate,
                    cache_types=cache_types
                )
                
        except Exception as e:
            logger.warning("Failed to get cache stats", error=str(e))
            return CacheStats()
    
    async def cleanup_expired(self, cache_type: Optional[str] = None) -> int:
        """Clean up expired cache entries"""
        try:
            if self.use_redis and self.redis_client:
                # Redis handles expiration automatically
                return 0
            else:
                # Clean up memory cache
                now = datetime.now()
                keys_to_delete = []
                
                for key, metadata in self.cache_metadata.items():
                    if cache_type and not key.startswith(f"{cache_type}:"):
                        continue
                        
                    if metadata.get('expires_at') and now > metadata['expires_at']:
                        keys_to_delete.append(key)
                
                # Delete expired entries
                for key in keys_to_delete:
                    if key in self.memory_cache:
                        del self.memory_cache[key]
                    if key in self.cache_metadata:
                        del self.cache_metadata[key]
                
                return len(keys_to_delete)
                
        except Exception as e:
            logger.warning("Failed to cleanup expired cache", error=str(e))
            return 0
    
    async def handle_request(self, request: CacheRequest) -> CacheResponse:
        """Handle cache request from API"""
        try:
            action = request.action.lower()
            
            if action == "get":
                data = await self.get(request.cache_key, request.cache_type)
                return CacheResponse(
                    action=action,
                    success=data is not None,
                    data=data,
                    message="Data retrieved" if data else "Data not found"
                )
            
            elif action == "set":
                if not request.data:
                    raise ValueError("Data is required for set operation")
                
                success = await self.set(
                    request.cache_key,
                    request.data,
                    request.ttl_hours,
                    request.cache_type
                )
                
                expires_at = datetime.now() + timedelta(hours=request.ttl_hours or self.default_ttl_hours)
                
                return CacheResponse(
                    action=action,
                    success=success,
                    cache_id=request.cache_key,
                    expires_at=expires_at,
                    message="Data cached successfully" if success else "Failed to cache data"
                )
            
            elif action == "invalidate":
                deleted_count = await self.delete(
                    cache_key=request.cache_key,
                    cache_type=request.cache_type
                )
                
                return CacheResponse(
                    action=action,
                    success=True,
                    message=f"Invalidated {deleted_count} cache entries"
                )
            
            elif action == "stats":
                stats = await self.get_stats(request.cache_type)
                
                return CacheResponse(
                    action=action,
                    success=True,
                    stats=stats,
                    message="Cache statistics retrieved"
                )
            
            elif action == "cleanup":
                cleaned_count = await self.cleanup_expired(request.cache_type)
                
                return CacheResponse(
                    action=action,
                    success=True,
                    message=f"Cleaned up {cleaned_count} expired entries"
                )
            
            else:
                raise ValueError(f"Unknown cache action: {action}")
                
        except Exception as e:
            logger.error("Cache request failed", action=request.action, error=str(e))
            return CacheResponse(
                action=request.action,
                success=False,
                message=f"Cache operation failed: {str(e)}"
            )
    
    def _generate_data_hash(self, data: Dict[str, Any]) -> str:
        """Generate hash for cache data validation"""
        try:
            data_str = json.dumps(data, sort_keys=True, default=str)
            return hashlib.md5(data_str.encode()).hexdigest()
        except Exception:
            return "unknown"