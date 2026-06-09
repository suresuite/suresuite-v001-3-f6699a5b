import logging
import structlog
from app.config import settings

def setup_logging():
    """Configure structured logging"""
    
    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=None,
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
    )
    
    # Configure structlog
    processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.dev.set_exc_info,
    ]
    
    if settings.structured_logging:
        processors.extend([
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer()
        ])
    else:
        processors.extend([
            structlog.dev.ConsoleRenderer()
        ])
    
    structlog.configure(
        processors=processors,
        logger_factory=structlog.WriteLoggerFactory(),
        cache_logger_on_first_use=True,
    )