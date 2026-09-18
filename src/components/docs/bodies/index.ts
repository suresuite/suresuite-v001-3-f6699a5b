// slug → page body.
//
// The registry (`../registry.ts`) owns the site map; this file owns what each
// live page actually renders. The two are held together by `registry.test.ts`:
// every page marked `live` must have an entry here, and every entry here must
// be a page the registry knows about. A body with no registry entry is
// unreachable; a live page with no body is a blank screen. Neither can be
// committed.
//
// Later packages add a body and flip that page's `status` to "live" in the
// registry — two lines, in two files, and the nav, pager and search already
// know about the page.

import type { ComponentType } from "react";

import WhatSureSuiteIs from "./WhatSureSuiteIs";
import HowItIsDesigned from "./HowItIsDesigned";
import DataModelAtAGlance from "./DataModelAtAGlance";
import HowYourDataFlows from "./HowYourDataFlows";
import WhatHappensToYourData from "./WhatHappensToYourData";
import SystemBoundary from "./SystemBoundary";
import KnownLimits from "./KnownLimits";
import YourFirstProject from "./YourFirstProject";
import Projects from "./Projects";
import UploadingData from "./UploadingData";
import AllTables from "./AllTables";
import UnitsAndConventions from "./UnitsAndConventions";
import Glossary from "./Glossary";
import FieldIndex from "./FieldIndex";

// 3 · Input tables (WP 5.2b)
import InboundLogistics from "./InboundLogistics";
import OutboundLogistics from "./OutboundLogistics";
import BomSingleLevel from "./BomSingleLevel";
import BomMultiLevel from "./BomMultiLevel";
import Materials from "./Materials";
import Products from "./Products";
import Suppliers from "./Suppliers";
import NodeList from "./NodeList";
import DeepTierNodes from "./DeepTierNodes";
import DeepTierEdges from "./DeepTierEdges";
import MultiTierSuppliers from "./MultiTierSuppliers";
import UnitsAndTimePeriods from "./UnitsAndTimePeriods";

export const DOC_BODIES: Record<string, ComponentType> = {
  // 1 · Overview & architecture
  "what-suresuite-is": WhatSureSuiteIs,
  "how-suresuite-is-designed": HowItIsDesigned,
  "data-model": DataModelAtAGlance,
  "how-your-data-flows": HowYourDataFlows,
  "what-happens-to-your-data": WhatHappensToYourData,
  "system-boundary": SystemBoundary,
  "known-limits": KnownLimits,

  // 2 · Getting started
  "your-first-project": YourFirstProject,
  projects: Projects,
  "uploading-data": UploadingData,

  // 3 · Input tables
  "inbound-logistics": InboundLogistics,
  "outbound-logistics": OutboundLogistics,
  "bom-single-level": BomSingleLevel,
  "bom-multi-level": BomMultiLevel,
  materials: Materials,
  products: Products,
  suppliers: Suppliers,
  "node-list": NodeList,
  "deep-tier-nodes": DeepTierNodes,
  "deep-tier-edges": DeepTierEdges,
  "multi-tier-suppliers": MultiTierSuppliers,
  "units-and-time-periods": UnitsAndTimePeriods,

  // 15 · Reference
  "all-tables": AllTables,
  "units-and-conventions": UnitsAndConventions,
  glossary: Glossary,
  "field-index": FieldIndex,
};
