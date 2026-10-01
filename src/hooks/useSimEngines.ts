// The engines a run may be dispatched to — the ACTIVE rows of `sim_engines`
// (WP 10.4 · §4 D245). A retired engine is never offered; dispatch would refuse
// it anyway. Phase 10 / WP 10.5: the Lab's Engine step.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SimEngine {
  id: string;
  slug: string;
  name: string;
  version: string | null;
  code_version: string | null;
  reported_at: string | null;
}

export function useSimEngines(): { engines: SimEngine[]; loading: boolean; failed: boolean } {
  const [engines, setEngines] = useState<SimEngine[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    void sb
      .from("sim_engines")
      .select("id,slug,name,version,code_version,reported_at")
      .eq("status", "active")
      .order("slug")
      .then(({ data, error }: { data: SimEngine[] | null; error: unknown }) => {
        if (!alive) return;
        // A database without the registry (the deploy window) has no rows to
        // offer: the step says so, and dispatch defaults to the single active one.
        setFailed(!!error);
        setEngines(error ? [] : data ?? []);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { engines, loading, failed };
}
