// §6.3 section 9 — models, budgets and limits.
//
// THE PAGE WHERE D34 HAS TO BE SAID. `allowed_model_ids` is read as an
// allow-list only when non-empty, so an administrator who clears it to revoke
// access grants everything instead. The contract states the rule; the admin
// screen badges "No restriction" after the fact; nothing warns at the point of
// the action. This is the last surface that can, so it does — in the reader's
// words, not the column's.

import { PageTitle, Section, P, Key, Callout, Prose, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";

export default function ModelsBudgetsLimits() {
  const perms = refTable("user_ai_permissions");
  const allow = perms.columns.find((c) => c.name === "allowed_model_ids");

  return (
    <>
      <PageTitle lead="Which models run, what they cost, and who is allowed to use them.">
        Models, budgets and limits
      </PageTitle>

      <Section id="the-three-layers" title="Three separate questions">
        <Key>
          Which models exist · what they may spend · who may use them. They are configured
          separately and they fail separately.
        </Key>
        <P>
          A model can be available and unusable because a budget is spent. A user can be entitled to
          a model that is not configured. Reading “it does not work” usually starts with deciding
          which of the three is in the way.
        </P>
      </Section>

      <Section id="budgets" title="Budgets">
        <P>
          A budget is a ceiling on spend, and usage is recorded against it as work happens. When it
          is reached, requests stop rather than continuing silently at cost — which means a stopped
          assistant is sometimes the budget working rather than a fault.
        </P>
      </Section>

      <Section id="entitlements" title="Who may use what">
        <P>
          Per-user entitlements decide which models a person can pick, which one a new conversation
          starts on, and which one is used when the first is unavailable.
        </P>
        {allow && (
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <div className="font-mono text-[12px] font-semibold text-foreground">{allow.name}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              <Prose text={allow.meaning} />
            </p>
          </div>
        )}
      </Section>

      <Callout tone="limit" title="Clearing the allow-list grants every model. It does not revoke them.">
        <p>
          <strong>This is the one thing on this page that will surprise an administrator, and it
          surprises them in the dangerous direction.</strong>
        </p>
        <p>
          The list of permitted models is treated as an allow-list <em>only while it has entries in
          it</em>. An empty list — and a user with no entitlements row at all — means no
          restriction: every configured model is permitted.
        </p>
        <p>
          So the intuitive way to take someone's access away is the exact way to give them all of
          it. To restrict a user, list the models they <em>may</em> use. To stop them using a
          particular model, remove that model from a list that still contains the others.
        </p>
        <p>
          The behaviour is deliberate — it is what every user had before entitlements existed, and
          changing it would silently lock out everyone who has no row. What was missing is a warning
          at the moment of the action, and until the admin screen carries one, this page is it.
        </p>
      </Callout>

      <Section id="where" title="Where this is set">
        <P>
          Models and budgets at <AppLink to="/admin/models">/admin/models</AppLink> and{" "}
          <AppLink to="/admin/usage">/admin/usage</AppLink>; per-user entitlements on the user's own
          page under <AppLink to="/admin/users">/admin/users</AppLink>. All three need an
          administrator — <DocLink to="admin-screens">Admin screens</DocLink> covers what each one
          controls.
        </P>
      </Section>

      <Section id="related" title="Related">
        <P>
          <DocLink to="ai-assistant">The AI assistant</DocLink> ·{" "}
          <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> ·{" "}
          <DocLink to="admin-screens">Admin screens</DocLink> ·{" "}
          <DocLink to="known-limits">Known limits</DocLink>
        </P>
      </Section>

      <Provenance from="the user_ai_permissions sidecar, whose own description of the empty-list rule is quoted above" />
    </>
  );
}
