import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { runChat, type ChatTurn } from "./providers.ts";
import { makeToolContext } from "./tools.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ProjectContext {
  project: any;
  supplyChainData: any[];
  nodeList: any[];
  simulations: any[];
  inboundLogistics: any[];
  outboundLogistics: any[];
  bomData: any[];
}

// In-memory cache for project abstracts (5 minute TTL)
const projectCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Performance timing utilities
const performance = {
  now: () => Date.now(),
  mark: (label: string, startTime: number) => {
    const duration = Date.now() - startTime;
    console.log(`[TIMING] ${label}: ${duration}ms`);
    return duration;
  }
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { projectId, message, conversationHistory, userId, userEmail, mode, model } = await req.json();

    if (!projectId || !message || !userId || !userEmail) {
      throw new Error('Missing required parameters: projectId, message, userId, userEmail');
    }

    // === Tool-calling chat mode (multi-provider: Gemini, OpenAI, DeepSeek) ===
    if (mode === 'tools') {
      try {
        const history = Array.isArray(conversationHistory)
          ? (conversationHistory as ChatTurn[]).filter(
              (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
            )
          : [];
        const ctx = makeToolContext(projectId, userId);
        const result = await runChat(model, String(message).slice(0, 4000), history, ctx);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('tools-mode error:', err);
        const msg = err instanceof Error ? err.message : 'AI request failed.';
        const isConfig = /not configured/i.test(msg);
        // Return 200 with the real message in `error`: supabase-js `invoke` discards the
        // body of non-2xx responses, which would hide the cause behind a generic
        // "Edge Function returned a non-2xx status code". The client throws on `error`.
        return new Response(JSON.stringify({
          error: msg,
          type: isConfig ? 'SERVICE_UNAVAILABLE' : 'AI_ERROR',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    // === END tools branch ===

    console.log('Request received for project:', projectId, 'user:', userId);

    console.log('Request received for project:', projectId, 'user:', userId);

    // Simplified authentication - just verify the user exists and proceed
    const { data: userExists, error: userCheckError } = await supabaseClient.rpc('verify_user_exists', {
      p_user_id: userId,
      p_user_email: userEmail
    });
    
    console.log('User verification result:', userExists, 'error:', userCheckError);
    
    if (userCheckError || userExists !== true) {
      console.error('User verification failed');
      return new Response(JSON.stringify({
        error: 'User authentication failed',
        type: 'UNAUTHORIZED'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User verified successfully, proceeding with AI request');

    console.log('Starting AI chat for project:', projectId);

    // Validate query security
    const queryValidation = validateQuery(message);
    if (!queryValidation.isAllowed) {
      return new Response(JSON.stringify({
        blocked: true,
        message: 'I cannot answer that question as it requests sensitive information. Please ask about network structure, patterns, or insights instead.',
        reason: queryValidation.reason,
        type: 'PRIVACY_BLOCK'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Gather basic project context without complex RLS 
    const startContext = performance.now();
    const projectContext = await gatherBasicProjectContext(supabaseClient, projectId, userId);
    performance.mark('Context gathering', startContext);
    
    // Check cache first for project abstract
    const cacheKey = `abstract_${projectId}`;
    const cached = projectCache.get(cacheKey);
    let abstractContext;
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log('Using cached project abstract');
      abstractContext = cached.data;
    } else {
      const startAbstract = performance.now();
      abstractContext = createProjectAbstract(projectContext);
      performance.mark('Abstract creation', startAbstract);
      
      // Cache the result
      projectCache.set(cacheKey, { data: abstractContext, timestamp: Date.now() });
    }

    // Create AI messages with trimmed conversation history
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      return new Response(JSON.stringify({
        error: 'AI service is not properly configured. Please contact your administrator.',
        type: 'SERVICE_UNAVAILABLE'
      }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = createSystemPrompt(abstractContext);
    
    // Trim conversation history to last 3 entries and cap message length
    const trimmedHistory = (conversationHistory || [])
      .slice(-3)
      .map((msg: ChatMessage) => ({
        ...msg,
        content: msg.content.substring(0, 800) // Cap at 800 chars per message
      }));
    
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
      { role: 'user', content: queryValidation.sanitizedQuery || message }
    ];

    console.log('Calling OpenAI with sanitized context');

    // Call OpenAI API with timeout and retry logic
    const startOpenAI = performance.now();
    let aiResponse = '';
    let openAISuccess = false;
    
    // First attempt with GPT-5
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAIApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5-2025-08-07',
          messages,
          max_completion_tokens: 1000,
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        aiResponse = data.choices[0]?.message?.content || '';
        openAISuccess = true;
        performance.mark('OpenAI call (GPT-5)', startOpenAI);
      } else {
        const errorData = await response.text();
        console.log('GPT-5 failed, will retry with mini:', response.status, errorData);
      }
    } catch (error) {
      console.log('GPT-5 timeout/error, will retry with mini:', error.message);
    }
    
    // Retry with GPT-5-mini if first attempt failed
    if (!openAISuccess) {
      try {
        const startRetry = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout for mini
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openAIApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-5-mini-2025-08-07',
            messages,
            max_completion_tokens: 600, // Lower token limit for mini
          }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          aiResponse = data.choices[0]?.message?.content || '';
          openAISuccess = true;
          performance.mark('OpenAI retry (GPT-5-mini)', startRetry);
        } else {
          const errorData = await response.text();
          console.log('GPT-5-mini also failed:', response.status, errorData);
        }
      } catch (error) {
        console.log('GPT-5-mini also timeout/error:', error.message);
      }
    }
    
    // Generate deterministic fallback if both AI attempts failed or returned empty
    if (!openAISuccess || !aiResponse || aiResponse.trim().length === 0) {
      console.log('Generating fallback response due to AI failure or empty response');
      aiResponse = generateFallbackResponse(abstractContext);
    }

    // Validate and clean response
    const responseValidation = validateResponse(aiResponse);
    if (!responseValidation.isClean) {
      console.warn('Response contained sensitive data, cleaning...');
      aiResponse = responseValidation.cleanedResponse;
    }

    // Log interaction for audit (without sensitive data)
    console.log('AI interaction completed successfully');
    
    return new Response(JSON.stringify({
      response: aiResponse,
      projectAbstract: abstractContext,
      safeQuestions: generateSafeQuestions(abstractContext)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in project-ai-chat function:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to process chat request',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Gather project context with sanitization
async function gatherProjectContext(supabase: any, projectId: string): Promise<ProjectContext> {
  try {
    // Get project info
    const { data: project } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    // Get supply chain data (limited and sanitized)
    const { data: supplyChainData } = await supabase
      .from('supply_chain_data')
      .select('data_source, material_consumption_rate, sourcing_ratio, is_critical_node')
      .eq('project_id', projectId)
      .limit(100);

    // Get node list (limited and sanitized)
    const { data: nodeList } = await supabase
      .from('node_list')
      .select('node_type, node_group, is_critical_node, critical_node_score')
      .eq('project_id', projectId)
      .limit(100);

    // Get simulation results (metadata only)
    const { data: simulations } = await supabase
      .from('simulation_results')
      .select('status, started_at, completed_at')
      .eq('project_id', projectId)
      .limit(10);

    return {
      project: sanitizeObject(project || {}),
      supplyChainData: (supplyChainData || []).map(sanitizeObject),
      nodeList: (nodeList || []).map(sanitizeObject),
      simulations: (simulations || []).map(sanitizeObject),
      inboundLogistics: [],
      outboundLogistics: [],
      bomData: [],
    };
  } catch (error) {
    console.error('Error gathering project context:', error);
    return {
      project: {},
      supplyChainData: [],
      nodeList: [],
      simulations: [],
      inboundLogistics: [],
      outboundLogistics: [],
      bomData: [],
    };
  }
}

// Data sanitization functions
function sanitizeObject(obj: any): any {
  if (!obj) return obj;
  
  const sanitized = { ...obj };
  
  // Remove sensitive fields
  const sensitiveFields = ['email', 'phone', 'latitude', 'longitude', 'location_text', 'description_text'];
  sensitiveFields.forEach(field => {
    delete sanitized[field];
  });
  
  // Anonymize name-like fields
  if (sanitized.name) sanitized.name = '[ANONYMIZED]';
  if (sanitized.supplier_id) sanitized.supplier_id = '[SUPPLIER]';
  if (sanitized.customer_id) sanitized.customer_id = '[CUSTOMER]';
  if (sanitized.material_id) sanitized.material_id = '[MATERIAL]';
  if (sanitized.plant_name) sanitized.plant_name = '[PLANT]';
  
  return sanitized;
}

// Query validation
function validateQuery(query: string): { isAllowed: boolean; reason?: string; sanitizedQuery?: string } {
  const sensitivePatterns = [
    /\b(actual|real|specific|exact)\s+(names?|locations?|addresses?)/i,
    /\b(revenue|profit|cost|price|financial|money)/i,
    /\b(email|phone|address|contact)/i,
    /\b(latitude|longitude|coordinates)/i,
  ];

  const hasSensitive = sensitivePatterns.some(pattern => pattern.test(query));
  
  if (hasSensitive) {
    return {
      isAllowed: false,
      reason: 'Query requests sensitive information that cannot be shared for privacy protection'
    };
  }

  return {
    isAllowed: true,
    sanitizedQuery: query
  };
}

// Response validation to prevent sensitive data leaks
function validateResponse(response: string): { isClean: boolean; cleanedResponse?: string } {
  // Enhanced sensitive patterns for response validation
  const sensitivePatterns = [
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

  let cleaned = response;
  let hasLeaks = false;

  // Check for potential data leaks in response
  sensitivePatterns.forEach(pattern => {
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

// Enhanced project abstract creation with rich context
function createProjectAbstract(projectContext: ProjectContext): any {
  // Analyze supply chain data patterns
  const supplyChainAnalysis = analyzeSupplyChainData(projectContext.supplyChainData);
  const nodeAnalysis = analyzeNodeData(projectContext.nodeList);
  const simulationAnalysis = analyzeSimulationData(projectContext.simulations);
  
  return {
    project: {
      anonymizedName: '[PROJECT]',
      supplyChainModel: projectContext.project.supply_chain_model || 'Unknown',
      bomLevel: projectContext.project.bom_level || 'single',
      completed: Boolean(projectContext.project.completed),
    },
    networkStructure: {
      totalNodes: projectContext.nodeList.length,
      totalConnections: projectContext.supplyChainData.length,
      criticalNodeCount: projectContext.nodeList.filter(n => n.is_critical_node).length,
      nodeTypeDistribution: nodeAnalysis.nodeTypeDistribution,
      averageCriticalScore: nodeAnalysis.averageCriticalScore,
    },
    supplyChainMetrics: {
      dataSourceBreakdown: supplyChainAnalysis.dataSourceBreakdown,
      averageConsumptionRate: supplyChainAnalysis.averageConsumptionRate,
      criticalConnectionCount: supplyChainAnalysis.criticalConnectionCount,
      complexityIndicators: supplyChainAnalysis.complexityIndicators,
    },
    simulationInsights: {
      totalSimulations: projectContext.simulations.length,
      completedSimulations: simulationAnalysis.completedCount,
      recentActivity: simulationAnalysis.recentActivity,
      hasMetrics: simulationAnalysis.hasMetrics,
    },
    dataQuality: {
      bomRecords: projectContext.bomData.length,
      inboundRecords: projectContext.inboundLogistics.length,
      outboundRecords: projectContext.outboundLogistics.length,
      completeness: calculateDataCompleteness(projectContext),
    },
    statistics: {
      simulationCount: projectContext.simulations.length,
    }
  };
}

// Enhanced analysis functions
function analyzeSupplyChainData(supplyChainData: any[]): any {
  if (!supplyChainData.length) {
    return {
      dataSourceBreakdown: {},
      averageConsumptionRate: 0,
      criticalConnectionCount: 0,
      complexityIndicators: { low: true },
    };
  }
  
  const dataSourceBreakdown = supplyChainData.reduce((acc, item) => {
    acc[item.data_source] = (acc[item.data_source] || 0) + 1;
    return acc;
  }, {});
  
  const consumptionRates = supplyChainData
    .filter(item => item.material_consumption_rate)
    .map(item => item.material_consumption_rate);
  
  const averageConsumptionRate = consumptionRates.length > 0 
    ? consumptionRates.reduce((a, b) => a + b, 0) / consumptionRates.length 
    : 0;
  
  const criticalConnectionCount = supplyChainData.filter(item => item.is_critical_node).length;
  
  const complexityIndicators = {
    low: supplyChainData.length < 50,
    medium: supplyChainData.length >= 50 && supplyChainData.length < 200,
    high: supplyChainData.length >= 200,
    multiTier: Object.keys(dataSourceBreakdown).length > 2,
  };
  
  return {
    dataSourceBreakdown,
    averageConsumptionRate,
    criticalConnectionCount,
    complexityIndicators,
  };
}

function analyzeNodeData(nodeList: any[]): any {
  if (!nodeList.length) {
    return {
      nodeTypeDistribution: {},
      averageCriticalScore: 0,
    };
  }
  
  const nodeTypeDistribution = nodeList.reduce((acc, node) => {
    acc[node.node_type || 'unknown'] = (acc[node.node_type || 'unknown'] || 0) + 1;
    return acc;
  }, {});
  
  const criticalScores = nodeList
    .filter(node => node.critical_node_score)
    .map(node => node.critical_node_score);
  
  const averageCriticalScore = criticalScores.length > 0
    ? criticalScores.reduce((a, b) => a + b, 0) / criticalScores.length
    : 0;
  
  return {
    nodeTypeDistribution,
    averageCriticalScore,
  };
}

function analyzeSimulationData(simulations: any[]): any {
  if (!simulations.length) {
    return {
      completedCount: 0,
      recentActivity: false,
      hasMetrics: false,
    };
  }
  
  const completedCount = simulations.filter(sim => sim.status === 'completed').length;
  const recentActivity = simulations.some(sim => {
    const startDate = new Date(sim.started_at);
    const now = new Date();
    const daysDiff = (now.getTime() - startDate.getTime()) / (1000 * 3600 * 24);
    return daysDiff <= 30; // Recent activity within 30 days
  });
  
  const hasMetrics = simulations.some(sim => sim.has_metrics);
  
  return {
    completedCount,
    recentActivity,
    hasMetrics,
  };
}

function calculateDataCompleteness(projectContext: ProjectContext): string {
  const hasBom = projectContext.bomData.length > 0;
  const hasInbound = projectContext.inboundLogistics.length > 0;
  const hasOutbound = projectContext.outboundLogistics.length > 0;
  const hasSupplyChain = projectContext.supplyChainData.length > 0;
  
  const completenessScore = [hasBom, hasInbound, hasOutbound, hasSupplyChain].filter(Boolean).length;
  
  if (completenessScore >= 3) return 'high';
  if (completenessScore >= 2) return 'medium';
  return 'low';
}

// Enhanced system prompt with rich context
function createSystemPrompt(abstractContext: any): string {
  const networkSize = abstractContext.networkStructure?.totalNodes || 0;
  const connections = abstractContext.networkStructure?.totalConnections || 0;
  const criticalNodes = abstractContext.networkStructure?.criticalNodeCount || 0;
  const complexity = abstractContext.supplyChainMetrics?.complexityIndicators || {};
  const dataQuality = abstractContext.dataQuality?.completeness || 'unknown';
  
  let complexityLevel = 'Simple';
  if (complexity.high) complexityLevel = 'High';
  else if (complexity.medium) complexityLevel = 'Medium';
  
  return `You are an expert supply chain analysis assistant. You help users understand and optimize their supply chain networks through comprehensive data analysis.

IMPORTANT PRIVACY RULES:
- Never reveal specific company names, locations, or personal information
- Use anonymized references like "[SUPPLIER_1]", "[MATERIAL_A]", "[PLANT]"
- Focus on patterns, structures, and insights rather than specific identifiers
- All data has been anonymized for privacy protection

PROJECT ANALYSIS CONTEXT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 NETWORK OVERVIEW:
• Supply Chain Model: ${abstractContext.project?.supplyChainModel || 'Unknown'}
• BOM Configuration: ${abstractContext.project?.bomLevel || 'single'} level
• Project Status: ${abstractContext.project?.completed ? 'Completed ✓' : 'In Progress ⏳'}
• Network Complexity: ${complexityLevel}
• Data Quality: ${dataQuality.toUpperCase()}

🔗 NETWORK STRUCTURE:
• Total Nodes: ${networkSize}
• Total Connections: ${connections} 
• Critical Nodes Identified: ${criticalNodes}
${abstractContext.networkStructure?.nodeTypeDistribution ? 
`• Node Types: ${Object.entries(abstractContext.networkStructure.nodeTypeDistribution)
  .map(([type, count]) => `${type} (${count})`)
  .join(', ')}` : ''}

📈 SUPPLY CHAIN METRICS:
${abstractContext.supplyChainMetrics?.dataSourceBreakdown ? 
`• Data Sources: ${Object.entries(abstractContext.supplyChainMetrics.dataSourceBreakdown)
  .map(([source, count]) => `${source} (${count})`)
  .join(', ')}` : ''}
${abstractContext.supplyChainMetrics?.averageConsumptionRate ? 
`• Avg Consumption Rate: ${abstractContext.supplyChainMetrics.averageConsumptionRate.toFixed(2)}` : ''}
• Critical Connections: ${abstractContext.supplyChainMetrics?.criticalConnectionCount || 0}

🎯 SIMULATION INSIGHTS:
• Total Simulations: ${abstractContext.simulationInsights?.totalSimulations || 0}
• Completed: ${abstractContext.simulationInsights?.completedSimulations || 0}
• Recent Activity: ${abstractContext.simulationInsights?.recentActivity ? 'Yes ✓' : 'No'}
• Has Performance Metrics: ${abstractContext.simulationInsights?.hasMetrics ? 'Yes ✓' : 'No'}

📋 DATA COMPLETENESS:
• BOM Records: ${abstractContext.dataQuality?.bomRecords || 0}
• Inbound Logistics: ${abstractContext.dataQuality?.inboundRecords || 0}  
• Outbound Logistics: ${abstractContext.dataQuality?.outboundRecords || 0}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ANALYSIS CAPABILITIES:
✅ Network structure and topology analysis
✅ Risk assessment and critical node identification  
✅ Supply chain complexity evaluation
✅ Performance bottleneck identification
✅ Optimization opportunity recommendations
✅ Resilience and vulnerability assessment
✅ Data quality and completeness insights
✅ Simulation results interpretation

Provide insightful, actionable analysis while maintaining strict privacy protection. Focus on strategic insights, patterns, and recommendations that help optimize supply chain performance and resilience.`;
}

// Enhanced safe questions based on actual data context
function generateSafeQuestions(abstractContext: any): string[] {
  const baseQuestions = [
    "Analyze the overall structure and complexity of my supply chain network",
    "What are the key risk factors and vulnerabilities in my network?",
    "How can I improve the resilience of my supply chain?",
    "What optimization opportunities do you see in my network?",
  ];
  
  const contextualQuestions = [];
  
  // Add questions based on available data
  if (abstractContext.networkStructure?.criticalNodeCount > 0) {
    contextualQuestions.push("Tell me about the critical nodes in my network and their impact");
  }
  
  if (abstractContext.simulationInsights?.totalSimulations > 0) {
    contextualQuestions.push("What insights can you derive from my simulation results?");
  }
  
  if (abstractContext.supplyChainMetrics?.complexityIndicators?.high) {
    contextualQuestions.push("How can I manage the complexity of my supply chain network?");
  }
  
  if (abstractContext.dataQuality?.completeness === 'low') {
    contextualQuestions.push("What data gaps should I address to improve my supply chain analysis?");
  }
  
  if (abstractContext.networkStructure?.nodeTypeDistribution) {
    contextualQuestions.push("Analyze the distribution and balance of different node types in my network");
  }
  
  // Return a mix of base and contextual questions
  return [...baseQuestions, ...contextualQuestions].slice(0, 6);
}

// Enhanced project context gathering using secure RPC functions
async function gatherBasicProjectContext(supabase: any, projectId: string, userId: string) {
  try {
    console.log('Gathering enhanced project context for:', projectId);
    
    // Get project dataset counts using the new lightweight RPC function
    const { data: datasetCounts, error: countsError } = await supabase.rpc('get_project_dataset_counts', {
      p_project_id: projectId,
      p_user_id: userId,
      p_user_email: '' // We already verified the user
    });
    
    if (countsError) {
      console.warn('Error getting project dataset counts:', countsError);
    }
    
    // Get supply chain data using secure RPC function (limited)
    const { data: supplyChainData, error: supplyChainError } = await supabase.rpc('get_supply_chain_data', {
      p_project_id: projectId,
      p_plant_name: null, // Get all plants
      p_user_id: userId,  
      p_user_email: '' // We already verified the user
    });
    
    if (supplyChainError) {
      console.warn('Error getting supply chain data:', supplyChainError);
    }
    
    // Get node list data (limited)
    const { data: nodeListData } = await supabase
      .from('node_list')
      .select('node_type, node_group, is_critical_node, critical_node_score')
      .eq('project_id', projectId)
      .limit(100); // Reduced from 200
    
    // Get simulation results (limited)
    const { data: simulations } = await supabase
      .from('simulation_results')
      .select('status, started_at, completed_at, metrics')
      .eq('project_id', projectId)
      .limit(10); // Reduced from 20
    
    // Process and sanitize the data
    const counts = datasetCounts || {};
    const processedSupplyChain = (supplyChainData || []).slice(0, 300); // Reduced from 500
    const processedNodes = (nodeListData || []).slice(0, 100);
    const processedSimulations = (simulations || []).slice(0, 10);
    
    console.log(`Context gathered: ${processedSupplyChain.length} supply chain records, ${processedNodes.length} nodes, ${processedSimulations.length} simulations`);
    
    return {
      project: {
        id: projectId,
        bom_level: counts.bom_level || 'single',
        supply_chain_model: 'anonymized',
        completed: true, // Basic assumption
      },
      supplyChainData: processedSupplyChain.map(sanitizeSupplyChainRecord),
      nodeList: processedNodes.map(sanitizeNodeRecord),
      simulations: processedSimulations.map(sanitizeSimulationRecord),
      // Use counts instead of full data
      inboundLogistics: Array(counts.inbound_count || 0).fill({ count_placeholder: true }),
      outboundLogistics: Array(counts.outbound_count || 0).fill({ count_placeholder: true }),
      bomData: Array(counts.bom_count || 0).fill({ count_placeholder: true }),
    };
  } catch (error) {
    console.error('Error gathering enhanced project context:', error);
    return {
      project: { id: projectId },
      supplyChainData: [],
      nodeList: [],
      simulations: [],
      inboundLogistics: [],
      outboundLogistics: [],
      bomData: [],
    };
  }
}

// Generate deterministic fallback response when AI calls fail
function generateFallbackResponse(abstractContext: any): string {
  const networkSize = abstractContext.networkStructure?.totalNodes || 0;
  const connections = abstractContext.networkStructure?.totalConnections || 0;
  const criticalNodes = abstractContext.networkStructure?.criticalNodeCount || 0;
  const complexity = abstractContext.supplyChainMetrics?.complexityIndicators || {};
  
  let complexityLevel = 'Simple';
  if (complexity.high) complexityLevel = 'High';
  else if (complexity.medium) complexityLevel = 'Medium';
  
  const dataQuality = abstractContext.dataQuality?.completeness || 'unknown';
  
  return `Based on your supply chain network analysis:

**Network Overview:**
Your ${complexityLevel.toLowerCase()} supply chain network contains ${networkSize} nodes with ${connections} total connections. ${criticalNodes > 0 ? `We've identified ${criticalNodes} critical nodes that require special attention.` : 'No critical nodes have been specifically identified yet.'}

**Key Insights:**
• **Data Quality**: Your network has ${dataQuality} data completeness, ${dataQuality === 'high' ? 'providing a solid foundation for analysis' : 'which may limit some analytical capabilities'}
• **Network Structure**: ${networkSize > 100 ? 'Large-scale network requiring strategic management' : networkSize > 50 ? 'Medium-scale network with moderate complexity' : 'Smaller network allowing for detailed oversight'}
• **Resilience**: ${criticalNodes > 0 ? 'Focus on diversifying dependencies around critical nodes' : 'Consider identifying potential vulnerability points'}

**Recommended Next Steps:**
1. **Risk Assessment**: ${criticalNodes > 0 ? 'Develop contingency plans for identified critical nodes' : 'Conduct critical node analysis to identify vulnerabilities'}
2. **Optimization**: Look for opportunities to streamline connections and reduce unnecessary complexity
3. **Monitoring**: Implement tracking for key performance indicators across your network
${abstractContext.simulationInsights?.totalSimulations > 0 ? '4. **Simulation Insights**: Review your simulation results for performance optimization opportunities' : '4. **Scenario Planning**: Consider running simulations to test network resilience'}

This analysis helps ensure your supply chain remains efficient and resilient. Feel free to ask about specific aspects of your network structure or optimization strategies.`;
}

// Enhanced sanitization functions for different data types
function sanitizeSupplyChainRecord(record: any): any {
  return {
    data_source: record.data_source,
    material_consumption_rate: record.material_consumption_rate,
    sourcing_ratio: record.sourcing_ratio,
    weighted: record.weighted,
    is_critical_node: record.is_critical_node,
    critical_node_score: record.critical_node_score,
    // Remove specific location identifiers
    from_location_type: record.from_location ? 'supplier' : 'unknown',
    to_location_type: record.to_location ? 'customer' : 'unknown',
  };
}

function sanitizeNodeRecord(record: any): any {
  return {
    node_type: record.node_type,
    node_group: record.node_group,
    is_critical_node: record.is_critical_node,
    critical_node_score: record.critical_node_score,
  };
}

function sanitizeSimulationRecord(record: any): any {
  return {
    status: record.status,
    started_at: record.started_at,
    completed_at: record.completed_at,
    has_metrics: Boolean(record.metrics),
    metrics_keys: record.metrics ? Object.keys(record.metrics) : [],
  };
}