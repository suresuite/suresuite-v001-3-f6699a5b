// Who is reading the manual, for the page bodies that need to know.
//
// A context of its own rather than `useAuth`, because a body must render with
// no providers at all: `bodies.test.tsx` and `pageDepth.test.tsx` render every
// page to static markup in node, and `useAuth` pulls in the Supabase client,
// which needs a browser to load. DocsLayout provides the value; outside it a
// body sees an anonymous reader.
import { createContext, useContext } from "react";

export type DocsReader = { userId: string | null };

export const DocsReaderContext = createContext<DocsReader>({ userId: null });

export const useDocsReader = (): DocsReader => useContext(DocsReaderContext);
