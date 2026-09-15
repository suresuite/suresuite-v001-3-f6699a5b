// The redirect component for /help/:slug. The map itself lives in
// `legacySlugs.ts` so that this file exports a component and nothing else.

import { Navigate, useParams } from "react-router-dom";
import { DEFAULT_SLUG } from "@/components/docs/registry";
import { LEGACY_SLUGS } from "@/components/docs/legacySlugs";

export default function HelpSlugRedirect() {
  const { slug } = useParams();
  const target = (slug && LEGACY_SLUGS[slug]) || DEFAULT_SLUG;
  return <Navigate to={`/docs/${target}`} replace />;
}
