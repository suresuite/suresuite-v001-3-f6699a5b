// Isolated visual QA of production page components. No session, database or API calls.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import YourFirstProject from "../../src/components/docs/bodies/YourFirstProject";
import UploadingData from "../../src/components/docs/bodies/UploadingData";
import HowYourDataFlows from "../../src/components/docs/bodies/HowYourDataFlows";
import "../../src/index.css";
const pages = {"your-first-project": YourFirstProject, "uploading-data": UploadingData, "how-your-data-flows": HowYourDataFlows};
const query = new URLSearchParams(location.search);
const slug = query.get("page") ?? "your-first-project";
const Body = pages[slug as keyof typeof pages] ?? YourFirstProject;
document.documentElement.classList.toggle("dark", query.get("theme") === "dark");
createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={[`/docs/${slug}`]}>
  <main className="mx-auto max-w-4xl space-y-8 px-5 py-8 md:px-8">
    <p className="text-xs text-muted-foreground">Local documentation preview · production page component · no signed-in session</p>
    <Body />
  </main>
</MemoryRouter>);
