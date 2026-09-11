// Landing point for orbit-mrp's OAuth consent redirect
// (src/lib/erp/orbitMrpOAuth.ts). Exchanges the code for a token, asks
// orbit-mrp which companies that token can see (never a hand-typed id —
// plan §6b rule 2), and hands both to the erp-sync-orbit-mrp Edge Function's
// `link` action to create the project_erp_links row.
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { handleOrbitMrpCallback } from "@/lib/erp/orbitMrpOAuth";
import { supabase } from "@/integrations/supabase/client";

interface Company {
  id: string;
  name: string;
  role: string;
}

export default function OrbitMrpCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setError("No authorization code returned by orbit-mrp");
      return;
    }
    handleOrbitMrpCallback(code)
      .then(async ({ projectId, accessToken }) => {
        setProjectId(projectId);
        setAccessToken(accessToken);
        const { data, error } = await supabase.functions.invoke("erp-sync-orbit-mrp", {
          body: { action: "list_companies", oauth_token: accessToken },
        });
        if (error) throw error;
        setCompanies(data.companies ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePick = async (company: Company) => {
    if (!projectId || !accessToken) return;
    setLinking(true);
    const { error } = await supabase.functions.invoke("erp-sync-orbit-mrp", {
      body: {
        action: "link",
        project_id: projectId,
        external_company_id: company.id,
        external_company_name: company.name,
        oauth_token: accessToken,
      },
    });
    setLinking(false);
    if (error) {
      setError(error.message ?? "Could not create the connection");
      return;
    }
    navigate(`/project-manager?project=${projectId}`);
  };

  return (
    <div className="flex items-center justify-center min-h-dvh p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Connect orbit-mrp</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && !companies && <p className="text-sm text-muted-foreground">Finishing sign-in…</p>}
          {companies && companies.length === 0 && (
            <p className="text-sm text-muted-foreground">
              This orbit-mrp account isn't a member of any company yet — nothing to connect.
            </p>
          )}
          {companies?.map((c) => (
            <Button key={c.id} variant="outline" className="w-full justify-start" disabled={linking} onClick={() => handlePick(c)}>
              {c.name} <span className="ml-2 text-xs text-muted-foreground">({c.role})</span>
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
