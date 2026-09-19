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
import { AI_GOVERNANCE } from "@/components/docs/generated/policy.generated";

export default function ModelsBudgetsLimits() {
  const perms = refTable("user_ai_permissions");
  const allow = perms.columns.find((c) => c.name === "allowed_model_ids");
  const g = AI_GOVERNANCE;

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
          A budget is a ceiling, and usage is recorded against it as work happens. When it is
          reached, requests stop rather than continuing silently at cost — which means a stopped
          assistant is sometimes the budget working rather than a fault.
        </P>
        <P>
          <strong>A budget is set at one of {g.budgetScopes.length} scopes</strong> —{" "}
          {g.budgetScopes.map((x, i) => (
            <span key={x}>
              {i > 0 && i === g.budgetScopes.length - 1 ? " or " : i > 0 ? ", " : ""}
              <Term>{x}</Term>
            </span>
          ))}{" "}
          — over a {g.budgetPeriods.join(" or ")} window. So “the budget” is rarely one number: a
          person can be inside their own and stopped by their organization's.
        </P>
        <P>
          Each one can cap {g.budgetCeilings.length} different things at once: money, tokens, and
          requests per minute and per day. <strong>Being stopped on requests per minute is not the
          same as being out of budget</strong>, and the two feel identical from the conversation —
          if the assistant recovers after a minute, it was rate rather than spend.
        </P>
      </Section>

      <Section id="usage" title="What gets recorded about each call">
        <P>
          Every request the assistant makes records the model, the provider, the tokens in and out,
          the cost, how long it took, and whether it succeeded. Failed calls are recorded too, with
          their error, which is what makes “it stopped working at four o'clock” answerable.
        </P>
        <P>
          The status vocabulary is worth knowing because the third value is not an error:{" "}
          {g.usageStatuses.map((x, i) => (
            <span key={x}>
              {i > 0 ? ", " : ""}
              <Term>{x}</Term>
            </span>
          ))}
          . <Term>blocked</Term> means a limit refused the call before it was made — it cost nothing
          and it is not a fault. A run of them is a budget or an entitlement, not an outage.
        </P>
        <P>
          Cost is computed from the model's own per-thousand-token input and output prices, which
          are configured per model rather than looked up from a provider. A price set wrong makes
          every figure on the usage screen wrong in the same direction, and nothing external
          contradicts it.
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

      <Section id="check-your-own" title="Checking your own access">
        <P>
          <AppLink to="/profile">Your account page</AppLink> has an “AI models you can use” block,
          and it is the only place you can see your own entitlements without an administrator. It
          says one of three things, and the first one is the one to read carefully.
        </P>
        <div className="space-y-3">
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              “All enabled models are available to you.”
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              This is what you see both when somebody deliberately granted you everything{" "}
              <strong>and</strong> when nobody has ever set an entitlement for you — including when
              an administrator cleared your list intending to take access away. The page cannot tell
              the three apart, because the stored state is the same.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">A list of named models</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Somebody restricted you on purpose, to exactly these. The block also names the model a
              new conversation starts on and the one used when that is unavailable.
            </p>
          </div>
          <div className="rounded-sm border border-border bg-card p-4 shadow-xs">
            <p className="text-[13px] font-semibold text-foreground">
              “No AI models are enabled for your account.”
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Not an empty entitlement — the models themselves are not enabled in this deployment.
              This is an administrator's question, not yours.
            </p>
          </div>
        </div>
      </Section>

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

      <Provenance from="the user_ai_permissions sidecar, whose own description of the empty-list rule is quoted above, and the CHECK constraints on ai_budgets and ai_usage_logs in the introspected schema for the scopes, periods and statuses — those tables are deliberately outside the data contract" />
    </>
  );
}
