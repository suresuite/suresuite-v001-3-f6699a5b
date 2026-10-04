import { PageTitle, Section, P, Key, Callout, Defs, Bullets, DocLink, Term, AppLink, Steps } from "@/components/docs/prose";
import { DocFigure } from "@/components/docs/DocFigure";

export default function UploadingData() {
  return <>
    <PageTitle lead="Load a CSV into the right dataset, review its changes, and confirm which rows reached your project.">Uploading data</PageTitle>
    <Section id="where" title="Choose the project before the file">
      <P>Open <AppLink to="/project-manager">Project Manager</AppLink>, select the intended project and open its upload wizard. Choose the dataset explicitly; the filename does not select it for you. Check the project name again before proceeding, especially when you have several projects open.</P>
      <Key>For the described CSV datasets, preview, Upload and Promote are three different steps. Only promotion writes the accepted project rows.</Key>
      <DocFigure id="upload-review-promote" />
      <P>To practise without touching real data, use the seven downloads in <DocLink to="your-first-project">Your first project</DocLink>. Project roles and capabilities can restrict upload, promotion and subsequent edits separately. An unavailable control is a reason to check access with the owner; it is not a reason to change IDs in a request.</P>
    </Section>
    <Section id="start-with-the-template" title="Start with the dataset's current template">
      <P>Download the template from the wizard. Use comma-separated UTF-8 CSV, with decimal points in numeric cells. Export spreadsheets as CSV; renaming an XLSX extension does not convert the file. Semicolon-, tab- and pipe-separated files are not accepted as comma-separated CSV. Quote text containing commas and double any quotation mark inside a quoted field.</P>
      <P>Keep identifier columns as text when editing in a spreadsheet so leading zeroes survive. Header spelling matters. Some columns are optional: a master file can contain only its required identifier, but that does not mean the model has enough economics, demand or capacity data for the question you want to answer.</P>
      <Callout title="Blank is not zero"><p>Use a blank only when you mean that the value is missing. Zero is an explicit number and is accepted only where that column's rule permits it. For example, a BOM consumption rate must be positive, while opening inventory can be zero. Do not fill every blank with zero to make the file look complete.</p></Callout>
    </Section>
    <Section id="what-you-can-upload" title="Which datasets do you need?">
      <Defs items={[
        {term: "BOM and logistics", def: "The project completion indicator checks the selected BOM shape, inbound logistics and outbound logistics. The single-level BOM joins product_id to material_id through consumption_rate. Inbound joins supplier_id to material_id; outbound joins customer_id to product_id."},
        {term: "Item masters", def: "Materials, Products, Suppliers and Customers add attributes to those IDs. Uploading them first is a useful working order, not a promise that every relationship is foreign-key-validated during CSV parsing. Inspect the combined model afterwards."},
        {term: "Demand Forecast", def: "Optional customer × product time series. It is separate from the outbound lane's volume and optional row demand distribution. Use the demand reference to check dates, quantities and period conversion before adding forecasts."},
        {term: "Multi-level and deep-tier data", def: "The project's BOM setting determines which BOM shape is offered. Deep-tier supplier tables and firm-network nodes/edges describe additional relationships. Deep-tier network upload also offers JSON. These are not prerequisites for the control-kit tutorial."},
      ]} />
      <P>Keep the two meanings of depth separate: a BOM level is a manufacturing dependency; a company tier is a trading relationship. A node's presence does not supply a missing supplier–buyer edge. Consult <DocLink to="data-model">The data model</DocLink> for dataset-specific reference and <DocLink to="system-boundary">System boundary</DocLink> for what reaches simulation.</P>
    </Section>
    <Section id="what-is-checked" title="Read the preview and review as separate checkpoints">
      <Steps steps={[
        {title: "Select the file and inspect the preview", body: <>The parse request checks headers and row values. CSV findings use <Term>error</Term>, <Term>warn</Term> and <Term>info</Term>; model-readiness findings use their own blocking categories. Fix reported errors by the physical line and column named in the message. The preview may show only the first five rows; it is not a review of every value.</>},
        {title: "Select Upload and inspect the staged run", body: <>For described CSVs, the server retains the original file, opens an ingestion run, and stages typed rows. The review says <strong>staged — nothing has been written yet</strong>, meaning nothing has been promoted into accepted inputs. Inspect the counts for <strong>new</strong>, <strong>changed</strong>, <strong>unchanged</strong>, <strong>superseded</strong> and <strong>held back</strong>. A held-back row carries an error and will not be promoted.</>},
        {title: "Review the diff before promoting", body: <>Open changed rows and check their old and proposed values. <strong>Re-compare with current data</strong> refreshes the comparison if another edit may have occurred. A superseded row repeats a natural key later in the same file; the later row is the candidate for promotion. Check that this is intentional rather than assuming every CSV line becomes a record.</>},
        {title: "Promote the intended rows", body: <>Select <strong>Promote … rows</strong> only after checking the count and findings. Confirm that the review changes to <strong>promoted</strong> and inspect the project data. If the request fails, retain the run ID and error, check its status, and re-compare before retrying. A network timeout does not tell you whether a write completed.</>},
      ]} />
    </Section>
    <Section id="reupload" title="What does a corrected upload replace?">
      <P>The described CSV promotion path matches rows on each table's natural key and upserts the supplied data. It is not a whole-dataset replacement: omitting an existing row from a later file does not ask to delete it. A changed identifier can become a new row instead of renaming the old one.</P>
      <Defs items={[
        {term: "Masters", def: "Check the matching material, product, supplier or customer ID. Re-upload only after reviewing which attributes the diff will write. A supplied blank and an omitted column can have different effects because defaults and nullability belong to each dataset."},
        {term: "BOMs, lanes and forecasts", def: "Check the complete natural key in that dataset's reference and the staged diff. A supplier ID alone does not identify every inbound lane; the material and any other key fields matter. Do not assume one universal deduplication rule across all tables."},
        {term: "Node List and deep-tier network", def: "These upload paths use bulk operations rather than the described CSV promotion lifecycle. Do not expect the same retained-file, staging or diff behavior. Check the dataset's reference and the resulting row counts before repeating an upload, especially after a partially failed batch."},
      ]} />
    </Section>
    <Section id="what-happens-after" title="Check the model after promotion">
      <P>Promotion is not proof that the full chain is coherent. Check accepted rows, allow derived-data rebuilding to finish and use <strong>Refresh Data</strong> if Project Manager asks for it. A ready project badge confirms core dataset presence; run validation checks the model and its settings separately. Resolve a combine failure before trusting a network drawn from older derived data.</P>
      <P>Rates and durations are different quantities. A volume of 70 per week with a lead time of 14 days means 70 units/week and two weeks in transit. The inbound <Term>lead_time_unit</Term> makes that distinction explicit. Supported CSV promotions normalize declared fields; some downstream readers still handle older unit representations. See <DocLink to="units-and-time-periods">Units and time periods</DocLink>.</P>
      <P>Saved policy versions, dataset snapshots and validated-model versions serve different purposes. After changing accepted inputs, check whether the model you intend to run still refers to the desired data and policy. <DocLink to="how-your-data-flows">How your data flows</DocLink> follows these boundaries.</P>
    </Section>
    <Section id="common-rejections" title="Fix the cause, then check the same checkpoint again">
      <Bullets items={[
        <>Missing headers: compare the selected dataset and its current template; do not change the dataset just to bypass the error.</>,
        <>Unknown unit or invalid number: use the reported column's accepted values; check decimal separators and shifted CSV cells.</>,
        <>Nonpositive consumption: correct the BOM quantity per product. An unused material should not be represented as a zero-consumption dependency.</>,
        <>Rows held back or superseded: inspect those exact lines. A successful promotion of other rows is not a complete import of the file.</>,
        <>Permission denial: retain the project and run identifiers and ask the owner to review the required access. An API or database denial can occur even when a page is visible.</>,
      ]} />
      <P>Next, <DocLink to="verify-your-inputs">verify the inputs</DocLink>, inspect the <DocLink to="product-level-network">product network</DocLink>, and save the policies you mean to test.</P>
    </Section>
  </>;
}
