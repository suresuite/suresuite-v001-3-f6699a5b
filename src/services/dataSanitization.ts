// Data sanitization service to protect sensitive information from being sent to OpenAI
export interface SanitizedData {
  [key: string]: any;
}

export class DataSanitizer {
  private static sensitivePatterns = [
    // Email patterns
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    // Phone patterns
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    // Credit card patterns
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    // SSN patterns
    /\b\d{3}-\d{2}-\d{4}\b/g,
  ];

  private static sensitiveFields = new Set([
    'email', 'phone', 'ssn', 'credit_card', 'password', 'token',
    'api_key', 'secret', 'personal_id', 'tax_id', 'bank_account',
    'latitude', 'longitude', 'lat', 'long', 'coordinates'
  ]);

  // Remove or anonymize PII from text
  static sanitizeText(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let sanitized = text;
    
    // Replace sensitive patterns
    this.sensitivePatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });

    return sanitized;
  }

  // Sanitize object by removing/anonymizing sensitive fields
  static sanitizeObject(obj: any): SanitizedData {
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: SanitizedData = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Skip sensitive fields entirely
      if (this.sensitiveFields.has(lowerKey)) {
        continue;
      }

      // Anonymize location data
      if (lowerKey.includes('location') && typeof value === 'string') {
        sanitized[key] = `[LOCATION_${Math.random().toString(36).substr(2, 6).toUpperCase()}]`;
        continue;
      }

      // Anonymize company/supplier names but keep structure
      if ((lowerKey.includes('name') || lowerKey.includes('supplier') || lowerKey.includes('customer')) && typeof value === 'string') {
        sanitized[key] = `[ENTITY_${Math.random().toString(36).substr(2, 6).toUpperCase()}]`;
        continue;
      }

      // Handle nested objects
      if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeText(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  // Create anonymized identifiers that are consistent within a session
  static createAnonymizedId(originalId: string, type: 'node' | 'supplier' | 'customer' | 'material' = 'node'): string {
    const hash = this.simpleHash(originalId);
    return `${type.toUpperCase()}_${hash.toString(36).toUpperCase()}`;
  }

  // Simple hash function for consistent anonymization
  private static simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // Sanitize financial data by abstracting to ranges
  static sanitizeFinancialData(value: number): string {
    if (value < 1000) return 'LOW_RANGE';
    if (value < 10000) return 'MEDIUM_RANGE';
    if (value < 100000) return 'HIGH_RANGE';
    return 'VERY_HIGH_RANGE';
  }
}
