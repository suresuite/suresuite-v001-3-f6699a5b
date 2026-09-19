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

// 5 · Policies, 6 · Verification (WP 5.2c)
import HowPoliciesWork from "./HowPoliciesWork";
import SupplierStage from "./SupplierStage";
import PlantStage from "./PlantStage";
import CustomerStage from "./CustomerStage";
import PolicyTypes from "./PolicyTypes";
import PolicyCatalog from "./PolicyCatalog";
import WhereANumberCameFrom from "./WhereANumberCameFrom";
import WhenAValueIsMissing from "./WhenAValueIsMissing";
import PolicyVersionsAndPresets from "./PolicyVersionsAndPresets";
import VerifyYourInputs from "./VerifyYourInputs";
import DataTrustReport from "./DataTrustReport";
import ModelValidation from "./ModelValidation";

// 8 · Networks, 9 · Project Intelligence (WP 5.2e)
import ProductLevelNetwork from "./ProductLevelNetwork";
import ProcessLevelNetwork from "./ProcessLevelNetwork";
import FirmLevelNetwork from "./FirmLevelNetwork";
import InteractiveNetworkSpace from "./InteractiveNetworkSpace";
import NetworkScienceMetrics from "./NetworkScienceMetrics";
import AiAssistant from "./AiAssistant";
import PlansAndProposals from "./PlansAndProposals";
import ProjectMemory from "./ProjectMemory";
import ModelsBudgetsLimits from "./ModelsBudgetsLimits";

// 4 · Computed tables, 12 · Exports & reproducibility (WP 5.2f)
import SupplyChainData from "./SupplyChainData";
import MultiTierData from "./MultiTierData";
import NetworkSummary from "./NetworkSummary";
import DatasetVersions from "./DatasetVersions";
import VerifiableExports from "./VerifiableExports";
import ReproducibilityRecord from "./ReproducibilityRecord";
import ExportingAndDeleting from "./ExportingAndDeleting";

// 7 · Experiments & scenarios, 11 · Results & statistics (WP 5.2d)
import SimulationLab from "./SimulationLab";
import Scenarios from "./Scenarios";
import Disruptions from "./Disruptions";
import RecoveryPlaybooks from "./RecoveryPlaybooks";
import ExperimentsAndComparison from "./ExperimentsAndComparison";
import SeedsReplicationsConfidence from "./SeedsReplicationsConfidence";
import StressTests from "./StressTests";
import ReadingYourResults from "./ReadingYourResults";
import KpisAndResilienceIndex from "./KpisAndResilienceIndex";
import PerItemTimeSeries from "./PerItemTimeSeries";
import PerformanceAndCaching from "./PerformanceAndCaching";
import ReportsAndFiles from "./ReportsAndFiles";

// 10 · Connectors, 13 · Access & administration, 14 · Developer API (WP 5.2g)
import ConnectingErp from "./ConnectingErp";
import ReviewingASync from "./ReviewingASync";
import CsvVsConnector from "./CsvVsConnector";
import OrganizationsAndMembers from "./OrganizationsAndMembers";
import RolesAndCapabilities from "./RolesAndCapabilities";
import ProjectAccess from "./ProjectAccess";
import WhoCanSeeYourData from "./WhoCanSeeYourData";
import AuditLog from "./AuditLog";
import AdminScreens from "./AdminScreens";
import AccountAndPassword from "./AccountAndPassword";
import GettingAnApiKey from "./GettingAnApiKey";
import EndpointsAndSchemas from "./EndpointsAndSchemas";
import RateLimitsAndIdempotency from "./RateLimitsAndIdempotency";
import RequestLog from "./RequestLog";

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

  // 4 · Computed tables
  "supply-chain-data": SupplyChainData,
  "multi-tier-data": MultiTierData,
  "network-summary": NetworkSummary,
  "dataset-versions": DatasetVersions,

  // 5 · Policies
  "how-policies-work": HowPoliciesWork,
  "supplier-stage": SupplierStage,
  "plant-stage": PlantStage,
  "customer-stage": CustomerStage,
  "policy-types": PolicyTypes,
  "policy-catalog": PolicyCatalog,
  "where-a-number-came-from": WhereANumberCameFrom,
  "when-a-value-is-missing": WhenAValueIsMissing,
  "policy-versions-and-presets": PolicyVersionsAndPresets,

  // 6 · Verification
  "verify-your-inputs": VerifyYourInputs,
  "data-trust-report": DataTrustReport,
  "model-validation": ModelValidation,

  // 7 · Experiments & scenarios
  "simulation-lab": SimulationLab,
  scenarios: Scenarios,
  disruptions: Disruptions,
  "recovery-playbooks": RecoveryPlaybooks,
  "experiments-and-comparison": ExperimentsAndComparison,
  "seeds-replications-confidence": SeedsReplicationsConfidence,
  "stress-tests": StressTests,

  // 8 · Networks
  "product-level-network": ProductLevelNetwork,
  "process-level-network": ProcessLevelNetwork,
  "firm-level-network": FirmLevelNetwork,
  "interactive-network-space": InteractiveNetworkSpace,
  "network-science-metrics": NetworkScienceMetrics,

  // 9 · Project Intelligence
  "ai-assistant": AiAssistant,
  "plans-and-proposals": PlansAndProposals,
  "project-memory": ProjectMemory,
  "models-budgets-limits": ModelsBudgetsLimits,

  // 10 · Connectors
  "connecting-erp": ConnectingErp,
  "reviewing-a-sync": ReviewingASync,
  "csv-vs-connector": CsvVsConnector,

  // 11 · Results & statistics
  "reading-your-results": ReadingYourResults,
  "kpis-and-resilience-index": KpisAndResilienceIndex,
  "per-item-time-series": PerItemTimeSeries,
  "performance-and-caching": PerformanceAndCaching,
  "reports-and-files": ReportsAndFiles,

  // 12 · Exports & reproducibility
  "verifiable-exports": VerifiableExports,
  "reproducibility-record": ReproducibilityRecord,
  "exporting-and-deleting": ExportingAndDeleting,

  // 13 · Access & administration
  "organizations-and-members": OrganizationsAndMembers,
  "roles-and-capabilities": RolesAndCapabilities,
  "project-access": ProjectAccess,
  "who-can-see-your-data": WhoCanSeeYourData,
  "audit-log": AuditLog,
  "admin-screens": AdminScreens,
  "account-and-password": AccountAndPassword,

  // 14 · Developer API
  "getting-an-api-key": GettingAnApiKey,
  "endpoints-and-schemas": EndpointsAndSchemas,
  "rate-limits-and-idempotency": RateLimitsAndIdempotency,
  "request-log": RequestLog,

  // 15 · Reference
  "all-tables": AllTables,
  "units-and-conventions": UnitsAndConventions,
  glossary: Glossary,
  "field-index": FieldIndex,
};
