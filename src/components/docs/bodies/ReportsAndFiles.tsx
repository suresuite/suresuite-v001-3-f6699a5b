// §6.3 section 11 — reports and files. Rewritten in WP 5.2j.
//
// ── THE PAGE SAID THE OPPOSITE OF THE POLICY ──────────────────────────────
//
// It read: "files are kept against the project rather than against you, so a
// file survives the person who produced it and is reachable by anyone who can
// reach the project." `user_files` has exactly two read policies —
// `user_id = get_current_user_id()` and a super-admin one — so a file is
// reachable by the person who made it and by nobody else on their team. The
// page told a reader their colleague could open a report that their colleague
// cannot see, on the page that links to "Who can see your data".
//
// It also described "a snapshot of what you were looking at", which is not how
// a report is made: rendering goes through an APPROVED decision_report proposal
// from the Report Builder agent. There is no button on a results screen that
// produces one, and E3 is the rule that caught it.

import { PageTitle, Section, P, Key, Callout, Steps, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { UNDESCRIBED } from "@/components/docs/generated/dataModel.generated";

export default function ReportsAndFiles() {
  const owing = UNDESCRIBED.find((g) => g.tables.some((t) => t.table === "user_files"));

  return (
    <>
      <PageTitle lead="Rendered reports, who can open them, how long they last, and what they are worth later.">
        Reports &amp; files
      </PageTitle>

      <Section id="what-a-report-is" title="What a rendered report is, and where it comes from">
        <Key>
          A report is produced by the assistant, from a proposal you approved — not by a button on a
          results screen.
        </Key>
        <P>
          You ask the <DocLink to="ai-assistant">project assistant</DocLink> for a decision report.
          It proposes one: a title, a template and a list of sections. Nothing is rendered until you
          approve that proposal, and what is rendered is exactly what you approved.{" "}
          <DocLink to="plans-and-proposals">Plans and proposals</DocLink> is that review step.
        </P>
        <P>
          At render time every section is resolved against <strong>live</strong> data — the runs and
          readings it cites, as they are now. A report is therefore current at the moment it is
          rendered rather than at the moment it was proposed, and a section citing a run that has
          since been deleted makes the render <strong>fail</strong> rather than quietly drop the
          section.
        </P>
      </Section>

      <Section id="formats" title="What you get">
        <P>
          Three choices, and two of them give you two files.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">XLSX only</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              The data pack: one sheet per section, numbers and narrative as cells. This is what you
              want if the report is going to be worked on rather than read.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">PDF — which always brings the XLSX too</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Ask for a PDF and you get <strong>two</strong> files, the document and the data pack
              behind it. That is deliberate and it is the same principle as the verifiable
              workbooks: a rendered document never circulates without the numbers it was made from.
              Asking for “both” gives you the same two files.
            </p>
          </div>
        </div>
        <Callout tone="limit" title="The PDF drops characters the XLSX keeps">
          <p>
            The PDF is written with the standard Latin-1 fonts. Em dashes, curly quotes and ellipses
            are converted to plain equivalents, and <strong>anything outside Latin-1 — Greek,
            Cyrillic, Chinese, most accented non-European characters — is replaced.</strong>
          </p>
          <p>
            So a product or supplier id in a non-Latin script reads correctly in the XLSX and is
            mangled in the PDF. If your item names are not Latin-1, circulate the XLSX.
          </p>
        </Callout>
      </Section>

      <Section id="who-can-open-it" title="Who can open it">
        <Key>
          A file belongs to the person who created it. Your colleagues cannot see it, even on a
          project you share.
        </Key>
        <P>
          <Term>user_files</Term> is read under one rule — the row's owner — plus a super-admin
          rule for platform operations. Project membership does not grant access to a file, and
          there is no sharing control. To give somebody a report, you send them the file.
        </P>
        <P>
          Downloading is the only way out, and it goes through a server action that checks the file
          is yours and then mints a link good for <strong>one hour</strong>. The storage bucket is
          not public and there are no permanent URLs — a link you pasted into a chat yesterday does
          not work today.
        </P>
      </Section>

      <Section id="how-long" title="How long a file lasts">
        <Steps
          steps={[
            {
              title: "Fourteen days, by default",
              body: (
                <>
                  Every rendered file expires 14 days after it is created. The sweep deletes the row
                  and the stored object together, so an expired file is gone rather than orphaned.
                </>
              ),
            },
            {
              title: "Mark it Keep to stop the clock",
              body: (
                <>
                  A retained file is never swept. This is the one action that decides whether a
                  report exists in three weeks, and it costs one click at the time you make it.
                </>
              ),
            },
            {
              title: "500 MB of retained files per person",
              body: (
                <>
                  The cap is on what you keep, not on what you render, and it is enforced when you
                  press Keep — so you are told at that moment rather than losing something later.
                </>
              ),
            },
          ]}
        />
        <P>
          An expired file stops appearing in your list before it is physically swept, so the list
          never shows you something you can no longer download.
        </P>
      </Section>

      <Callout tone="limit" title="A report is not a verifiable export">
        <p>
          A rendered report shows results. The three{" "}
          <DocLink to="verifiable-exports">verifiable workbooks</DocLink> show results{" "}
          <em>and the inputs and fingerprints they were computed from</em>, which is what lets
          somebody else check them.
        </p>
        <p>
          Send a report to explain. Send the workbooks to be believed.
        </p>
      </Callout>

      <Callout tone="limit" title="The whole file workspace is a deployment switch">
        <p>
          Reports, the file list and downloads exist only where the file workspace is turned on for
          the deployment. Where it is off, the assistant cannot store a report and every download
          answers with a service-unavailable message rather than a broken page.
        </p>
        <p>
          If you cannot find the file list at all, that is the likeliest reason, and it is an
          administrator's setting rather than anything about your account.
        </p>
      </Callout>

      <Callout tone="limit" title="An exported file leaves this system's guarantees behind">
        <p>
          Once a workbook or a report is on somebody's machine, nothing here can mark it stale, tell
          its reader the data has changed, or delete it. The fingerprints inside it are what make it
          checkable later — which is the argument for exporting the versioned artifacts rather than
          screenshots.
        </p>
      </Callout>

      {owing && (
        <Callout tone="limit" title="This table is not yet described in the contract">
          <p>
            <Term>user_files</Term> has no per-column description and is deferred to WP {owing.wp},
            so there is no column reference to link you to. What this page states about it —
            fourteen days, 500 MB, owner-only reads, the four file kinds — is read from the
            migration that created it rather than from a sidecar, which is a weaker source and is
            the one that exists.
          </p>
        </Callout>
      )}

      <Section id="related" title="Related">
        <P>
          <DocLink to="verifiable-exports">Verifiable exports</DocLink> is the artifact to send when
          somebody has to check you · <DocLink to="plans-and-proposals">Plans and proposals</DocLink>{" "}
          is the approval a render needs ·{" "}
          <DocLink to="exporting-and-deleting">Exporting and deleting your data</DocLink> ·{" "}
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> is the rest of the
          access picture · <DocLink to="reading-your-results">Reading your results</DocLink> is what
          a report is made of.
        </P>
        <P>
          Your files are listed in{" "}
          <AppLink to="/project-intelligence">Project Intelligence</AppLink>, beside the assistant
          that produced them.
        </P>
      </Section>

      <Provenance from="the report-render function for the formats and the signed-URL path, 20260723000001_reports_and_file_workspace.sql for the retention law, the cap and the owner-only read policy, and the contract's coverage register for what it does not describe" />
    </>
  );
}
