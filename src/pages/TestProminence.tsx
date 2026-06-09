// @ts-nocheck — schema mismatch: this file targets a supply-chain schema not yet migrated into this project. Remove once tables/RPCs are created.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TestProminence = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const testProminence = async () => {
    setIsLoading(true);
    setResult(null);
    
    try {
      console.log('Testing prominence calculation...');
      
      // Call the edge function directly
      const { data, error } = await supabase.functions.invoke('calculate-node-prominence', {
        body: {
          project_id: '1f0e0472-1556-4d75-be10-b1af2491d9be'
        }
      });

      if (error) {
        console.error('Edge function error:', error);
        toast.error(`Error: ${error.message}`);
        setResult({ error: error.message });
      } else {
        console.log('Edge function result:', data);
        toast.success('Prominence calculation completed!');
        setResult(data);
        
        // Check how many nodes now have prominence values
        const { data: nodeCheck } = await supabase
          .from('network_nodes')
          .select('prominence')
          .eq('project_id', '1f0e0472-1556-4d75-be10-b1af2491d9be')
          .not('prominence', 'is', null);
          
        console.log(`Nodes with prominence: ${nodeCheck?.length || 0}`);
      }
    } catch (error: any) {
      console.error('Test error:', error);
      toast.error(`Error: ${error.message}`);
      setResult({ error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle>Test Prominence Calculation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={testProminence}
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? 'Calculating...' : 'Test Prominence Calculation'}
          </Button>
          
          {result && (
            <div className="mt-4">
              <h3 className="text-lg font-semibold mb-2">Result:</h3>
              <pre className="bg-muted p-4 rounded-md overflow-auto text-sm">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TestProminence;