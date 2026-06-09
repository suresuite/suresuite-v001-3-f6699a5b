// Query security service to validate and filter user queries before sending to OpenAI
export interface QueryValidationResult {
  isAllowed: boolean;
  reason?: string;
  sanitizedQuery?: string;
}

export class QuerySecurity {
  // Patterns that indicate requests for sensitive information
  private static sensitivePatterns = [
    // Direct data requests
    /\b(show|list|give|tell)\s+(me\s+)?(all\s+)?(actual|real|specific|exact)\s+(names?|emails?|addresses?|locations?)/i,
    /\b(what\s+(are|is)\s+the\s+)?(actual|real|specific|exact)\s+(company|supplier|customer|location|address)/i,
    
    // Financial information
    /\b(revenue|profit|cost|price|financial|money|dollar|budget|expense|income)/i,
    
    // Personal information
    /\b(email|phone|address|contact|personal|private|confidential|ssn|social|credit)/i,
    
    // Geographic coordinates
    /\b(latitude|longitude|coordinates|gps|location\s+data)/i,
    
    // System information
    /\b(database|sql|table|schema|password|token|key|secret|api)/i,
  ];

  // Safe analytical terms that are allowed
  private static safeAnalyticalTerms = [
    'analyze', 'summarize', 'overview', 'structure', 'pattern', 'trend',
    'count', 'total', 'average', 'distribution', 'relationship', 'connection',
    'network', 'flow', 'dependency', 'critical', 'risk', 'impact',
    'complexity', 'efficiency', 'optimization', 'simulation', 'scenario'
  ];

  // Whitelist of explicitly safe question patterns
  private static safeQuestionPatterns = [
    /how many (nodes|suppliers|customers|materials|products)/i,
    /what (is|are) the (structure|complexity|depth|size) of/i,
    /analyze the (network|supply chain|relationships|connections)/i,
    /summarize (my|the) (project|network|data|structure)/i,
    /what (can you tell me|do you know) about (my|the) (project|network)/i,
    /how (complex|large|deep) is (my|the) (network|supply chain)/i,
    /what are the (main|key|important) (components|elements|parts)/i,
    /show me (statistics|metrics|summary|overview)/i,
    /what (insights|patterns|trends) do you see/i,
  ];

  static validateQuery(query: string): QueryValidationResult {
    if (!query || query.trim().length === 0) {
      return {
        isAllowed: false,
        reason: 'Empty query not allowed'
      };
    }

    const normalizedQuery = query.toLowerCase().trim();

    // Check for explicitly safe patterns first
    const isSafePattern = this.safeQuestionPatterns.some(pattern => 
      pattern.test(normalizedQuery)
    );

    if (isSafePattern) {
      return {
        isAllowed: true,
        sanitizedQuery: query
      };
    }

    // Check for sensitive patterns
    const hasSensitiveContent = this.sensitivePatterns.some(pattern => 
      pattern.test(normalizedQuery)
    );

    if (hasSensitiveContent) {
      return {
        isAllowed: false,
        reason: 'Query requests sensitive information that cannot be shared for privacy protection'
      };
    }

    // Check if query contains only safe analytical terms
    const words = normalizedQuery.split(/\s+/);
    const hasAnalyticalIntent = words.some(word => 
      this.safeAnalyticalTerms.some(term => word.includes(term))
    );

    if (!hasAnalyticalIntent) {
      return {
        isAllowed: false,
        reason: 'Query must be analytical in nature. Ask about patterns, structures, or insights rather than specific data.'
      };
    }

    // Additional validation for query length and complexity
    if (query.length > 500) {
      return {
        isAllowed: false,
        reason: 'Query too long. Please keep questions concise and focused.'
      };
    }

    return {
      isAllowed: true,
      sanitizedQuery: this.sanitizeQuery(query)
    };
  }

  // Sanitize query by removing potentially sensitive terms
  private static sanitizeQuery(query: string): string {
    let sanitized = query;
    
    // Replace specific data requests with general ones
    sanitized = sanitized.replace(/\b(actual|real|specific|exact)\s+/gi, '');
    sanitized = sanitized.replace(/\b(show|list|give)\s+me\s+(all\s+)?/gi, 'analyze ');
    
    return sanitized.trim();
  }

  // Generate safe example questions based on project context
  static generateSafeQuestions(projectAbstract: any): string[] {
    const questions = [
      "How many nodes are in my supply chain network?",
      "What is the complexity level of my supply chain?",
      "Analyze the structure of my network",
      "What insights can you provide about my project?",
      "How complete is my project data?",
      "What are the main components of my supply chain?",
    ];

    // Add context-specific questions
    if (projectAbstract?.networkStructure?.criticalNodeCount > 0) {
      questions.push("How many critical nodes are identified in my network?");
    }

    if (projectAbstract?.statistics?.simulationCount > 0) {
      questions.push("Tell me about the simulation results");
    }

    if (projectAbstract?.project?.deepTierEnabled) {
      questions.push("Analyze my multi-tier supply chain structure");
    }

    return questions;
  }

  // Validate AI response to ensure no sensitive data leaked
  static validateResponse(response: string): { isClean: boolean; cleanedResponse?: string } {
    let cleaned = response;
    let hasLeaks = false;

    // Check for potential data leaks in response
    this.sensitivePatterns.forEach(pattern => {
      if (pattern.test(response)) {
        hasLeaks = true;
        cleaned = cleaned.replace(pattern, '[REDACTED FOR PRIVACY]');
      }
    });

    // Remove any accidentally included specific identifiers
    cleaned = cleaned.replace(/\b[A-Z0-9]{8,}\b/g, '[ID]');
    cleaned = cleaned.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]');

    return {
      isClean: !hasLeaks,
      cleanedResponse: cleaned
    };
  }
}