// Renders one documentation page body (by slug) inside the DocsLayout Outlet.
// Bodies live in DOC_BODIES (src/pages/help/docBodies.tsx); chrome lives in DocsLayout.

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { DOC_BODIES } from "@/pages/help/docBodies";
import { DEFAULT_SLUG, getPage } from "@/components/docs/registry";

export default function HelpPage({ slug: slugProp }: { slug?: string }) {
  const params = useParams();
  const slug = slugProp ?? params.slug ?? DEFAULT_SLUG;
  const page = getPage(slug);
  const Body = DOC_BODIES[slug];

  useEffect(() => {
    document.title = page ? `${page.title} · DSCT Docs` : "DSCT Docs";
  }, [page]);

  if (!Body) {
    return (
      <div className="py-10 max-w-prose">
        <h2 className="text-2xl font-semibold tracking-tight">Page not found</h2>
        <p className="text-muted-foreground mt-2">
          There is no documentation page for &ldquo;{slug}&rdquo;.
        </p>
      </div>
    );
  }
  return <Body />;
}
