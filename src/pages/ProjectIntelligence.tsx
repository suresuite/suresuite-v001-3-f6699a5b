// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import React, { useState, useEffect, useRef } from 'react';
import { PageLayout } from '@/components/shared/PageLayout';
import { PageHeader } from '@/components/shared/PageHeader';
import { ProjectSelector } from '@/components/shared/ProjectSelector';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain, Send, Loader2, Shield, MessageSquare, Trash2, Copy, Check, Activity } from 'lucide-react';
import { useGlobalProject } from '@/hooks/useGlobalProject';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ProjectIntelligenceProps {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean) => void;
}

const ProjectIntelligence: React.FC<ProjectIntelligenceProps> = ({
  isCollapsed,
  setIsCollapsed,
}) => {
  const { globalSelectedProjectId, selectedProject, setGlobalSelectedProjectId, setSelectedProject } = useGlobalProject();
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasConsented, setHasConsented] = useState(false);
  const [projectAbstract, setProjectAbstract] = useState<any>(null);
  const [safeQuestions, setSafeQuestions] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [aiHealth, setAiHealth] = useState<any>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load projects
  useEffect(() => {
    if (user) {
      loadProjects();
    }
  }, [user]);

  // Update selected project when globalSelectedProjectId changes
  useEffect(() => {
    if (globalSelectedProjectId && projects.length > 0) {
      const project = projects.find(p => p.id === globalSelectedProjectId);
      setSelectedProject(project || null);
    }
  }, [globalSelectedProjectId, projects, setSelectedProject]);

  const loadProjects = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase.rpc('list_projects', {
        p_user_id: user.id,
        p_user_email: user.email
      });

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error loading projects:', error);
      toast.error('Failed to load projects');
    }
  };

  const handleProjectSelect = (projectId: string) => {
    setGlobalSelectedProjectId(projectId);
  };

  const checkAIHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const { data, error } = await supabase.functions.invoke('project-ai-health');
      
      if (error) throw error;
      
      setAiHealth(data);
      toast.success(data.openaiConfigured ? 'AI is healthy' : 'AI needs configuration');
    } catch (error) {
      console.error('Health check failed:', error);
      toast.error('Health check failed');
      setAiHealth({ functionUp: false, openaiConfigured: false });
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const handleSendMessage = async (messageText?: string) => {
    const message = messageText || inputMessage.trim();
    if (!message || !globalSelectedProjectId || !hasConsented) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('project-ai-chat', {
        body: {
          projectId: globalSelectedProjectId,
          message,
          conversationHistory: messages.slice(-5), // Last 5 messages for context
          userId: user?.id,
          userEmail: user?.email,
        },
      });

      console.log('AI chat response received:', { data, error, hasResponse: !!data?.response });

      if (error) {
        console.error('AI chat error:', error);
        
        // Handle specific error types
        if (error.message?.includes('Edge Function returned a non-2xx status code')) {
          toast.error('AI service is temporarily unavailable. Please try again in a moment.');
        } else if (error.message?.includes('JWT') || error.message?.includes('token')) {
          toast.error('Authentication expired. Please refresh the page and try again.');
        } else {
          toast.error(error.message || 'AI request failed');
        }
        throw error;
      }

      // Handle privacy blocks (successful response with blocked flag)
      if (data?.blocked) {
        console.log('Query blocked for privacy reasons:', data.reason);
        toast.error('Privacy block: Query contains sensitive information');
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.message || 'I cannot answer that question as it requests sensitive information. Please ask about network structure, patterns, or insights instead.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
        return;
      }

      // Handle unauthorized access
      if (data?.type === 'UNAUTHORIZED') {
        console.log('Unauthorized access detected');
        toast.error('Unauthorized: Please check your access permissions');
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'I\'m sorry, but you don\'t have permission to access this project\'s data. Please contact your administrator for access.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
        return;
      }

      // Handle service unavailable
      if (data?.type === 'SERVICE_UNAVAILABLE') {
        console.log('AI service unavailable:', data.error);
        toast.error('AI service is temporarily unavailable');
        const errorMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'I\'m sorry, but the AI service is temporarily unavailable. Please try again in a few moments.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
        return;
      }

      // Handle empty response gracefully by surfacing suggestions instead of throwing
      if (!data?.response || String(data.response).trim() === '') {
        console.warn('No response received from AI service. Falling back to suggestions.', data);
        if (data?.projectAbstract) {
          setProjectAbstract(data.projectAbstract);
        }
        if (data?.safeQuestions) {
          setSafeQuestions(data.safeQuestions);
        }
        const fallbackMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'I could not generate a direct answer right now. Try one of the suggested questions on the right, or rephrase your query.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, fallbackMessage]);
        return;
      } else {
        console.log('Processing successful AI response');
      }

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      if (data.projectAbstract) {
        setProjectAbstract(data.projectAbstract);
      }
      
      if (data.safeQuestions) {
        setSafeQuestions(data.safeQuestions);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message. Please try again.');
      
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I apologize, but I encountered an error processing your request. Please try again or rephrase your question.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearConversation = () => {
    setMessages([]);
    setProjectAbstract(null);
    toast.success('Conversation cleared');
  };

  const handleCopyMessage = async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
      toast.success('Message copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy message');
    }
  };

  const handleQuestionSuggestion = (question: string) => {
    setInputMessage(question);
  };

  if (!globalSelectedProjectId) {
    return (
      <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
        <div className="px-12 py-6">
          <PageHeader
            title="Project Intelligence"
            subtitle="AI-powered insights for your supply chain project"
            rightContent={
              <div className="flex items-center space-x-3">
                <ProjectSelector
                  projects={projects}
                  selectedProjectId={globalSelectedProjectId}
                  onProjectSelect={handleProjectSelect}
                  placeholder="Select a project..."
                  className="min-w-[200px]"
                />
              </div>
            }
          />
          <Alert className="mt-6 mb-6">
            <Brain className="h-4 w-4" />
            <AlertDescription>
              Please select a project to start analyzing your supply chain data with AI.
            </AlertDescription>
          </Alert>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed}>
      <div className="px-12 py-6">
        <PageHeader
          title="Project Intelligence"
          subtitle={selectedProject ? `Analyzing ${selectedProject.name} - ${selectedProject.plant_name}` : "AI-powered insights for your supply chain project"}
          onRefresh={checkAIHealth}
          refreshLoading={isCheckingHealth}
          rightContent={
            <div className="flex items-center space-x-3">
              <ProjectSelector
                projects={projects}
                selectedProjectId={globalSelectedProjectId}
                onProjectSelect={handleProjectSelect}
                placeholder="Select a project..."
                className="min-w-[200px]"
              />
            </div>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Right Sidebar - Project Context */}
          <div className="lg:col-span-1 space-y-4">

            <Card className="h-fit">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  AI Health Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {aiHealth && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={aiHealth.functionUp ? "default" : "destructive"} className="text-xs">
                        Function: {aiHealth.functionUp ? "Up" : "Down"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={aiHealth.openaiConfigured ? "default" : "destructive"} className="text-xs">
                        OpenAI: {aiHealth.openaiConfigured ? "Ready" : "Not Configured"}
                      </Badge>
                    </div>
                    {aiHealth.model && (
                      <p className="text-xs text-muted-foreground">Model: {aiHealth.model}</p>
                    )}
                  </div>
                )}
                {!aiHealth && (
                  <p className="text-xs text-muted-foreground">Click refresh to check AI health</p>
                )}
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Project Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium">{selectedProject?.name}</p>
                  <p className="text-xs text-muted-foreground">{selectedProject?.plant_name}</p>
                </div>
                
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-xs">
                    {selectedProject?.supply_chain_model}
                  </Badge>
                  <Badge variant={selectedProject?.completed ? "default" : "secondary"} className="text-xs">
                    {selectedProject?.completed ? "Completed" : "In Progress"}
                  </Badge>
                </div>

                {projectAbstract && (
                  <div className="pt-3 border-t space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Network Overview</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>Nodes: <span className="font-medium">{projectAbstract.networkStructure?.totalNodes || 0}</span></div>
                      <div>Edges: <span className="font-medium">{projectAbstract.networkStructure?.totalEdges || 0}</span></div>
                      <div className="col-span-2">Critical Nodes: <span className="font-medium">{projectAbstract.networkStructure?.criticalNodeCount || 0}</span></div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Suggested Questions */}
            {safeQuestions.length > 0 && (
              <Card className="h-fit">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Suggested Questions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {safeQuestions.slice(0, 4).map((question, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      className="w-full text-left justify-start h-auto py-2 px-3 text-xs whitespace-normal"
                      onClick={() => handleQuestionSuggestion(question)}
                    >
                      {question}
                    </Button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Main Chat Interface */}
          <div className="lg:col-span-3">
            <Card className="h-[700px] flex flex-col">
              <CardHeader className="flex-shrink-0 border-b">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5" />
                      AI Assistant
                    </CardTitle>
                    <CardDescription>
                      Ask questions about your supply chain project structure and patterns
                    </CardDescription>
                  </div>
                  {messages.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearConversation}
                      className="flex items-center gap-2"
                    >
                      <Trash2 className="h-4 w-4" />
                      Clear
                    </Button>
                  )}
                </div>
              </CardHeader>

              {!hasConsented ? (
                <CardContent className="flex-1 flex items-center justify-center">
                  <div className="max-w-md text-center space-y-4">
                    <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                      <Shield className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                      <h3 className="font-semibold text-blue-900 dark:text-blue-100">Privacy Protection</h3>
                      <p className="text-sm text-blue-700 dark:text-blue-200 mt-2">
                        Your data is anonymized and aggregated before analysis. No sensitive information 
                        like company names, locations, or financial details are shared with AI services.
                      </p>
                    </div>
                    <Button onClick={() => setHasConsented(true)} className="w-full">
                      I Understand - Start Analysis
                    </Button>
                  </div>
                </CardContent>
              ) : (
                <>
                  <CardContent className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full pr-4">
                      <div className="space-y-4">
                        {messages.length === 0 && (
                          <div className="text-center text-muted-foreground py-8">
                            <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>Start a conversation about your supply chain project!</p>
                            <p className="text-sm mt-2">Ask about network structure, patterns, or insights.</p>
                          </div>
                        )}
                        
                        {messages.map((message) => (
                          <div
                            key={message.id}
                            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div className={`max-w-[80%] rounded-lg p-3 ${
                              message.role === 'user'
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-muted'
                            }`}>
                              <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                              <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                                <span className="text-xs opacity-70">
                                  {message.timestamp.toLocaleTimeString()}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => handleCopyMessage(message.content, message.id)}
                                >
                                  {copiedId === message.id ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                        
                        {isLoading && (
                          <div className="flex justify-start">
                            <div className="bg-muted rounded-lg p-3 flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-sm">Analyzing...</span>
                            </div>
                          </div>
                        )}
                        
                        <div ref={messagesEndRef} />
                      </div>
                    </ScrollArea>
                  </CardContent>

                  <Separator />

                  <CardContent className="flex-shrink-0 pt-4">
                    <div className="flex gap-2">
                      <Input
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder="Ask about your supply chain structure, patterns, or insights..."
                        onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSendMessage()}
                        disabled={isLoading}
                        className="flex-1"
                      />
                      <Button
                        onClick={() => handleSendMessage()}
                        disabled={isLoading || !inputMessage.trim()}
                        size="icon"
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      <span>All data is anonymized for privacy protection</span>
                    </div>
                  </CardContent>
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default ProjectIntelligence;