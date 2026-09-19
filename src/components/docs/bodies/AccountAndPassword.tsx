// §6.3 section 13 — account and password.
//
// The page where D28 is a user-facing fact rather than an architecture note:
// sign-in is against this application's own approved-user list, held in the
// browser. Somebody reading a page about their own password deserves to be told
// what that means.

import { PageTitle, Section, P, Key, Callout, Term, DocLink, AppLink, Provenance } from "@/components/docs/prose";
import { refTable } from "@/components/docs/tableFacts";
import { SuppliedAndComputed } from "@/components/docs/tableRef";

export default function AccountAndPassword() {
  const users = refTable("approved_users");

  return (
    <>
      <PageTitle lead="Managing your own sign-in.">Account &amp; password</PageTitle>

      <Section id="your-account" title="Your account">
        <P>
          Your account is an entry in this deployment's list of approved users. It carries your
          identity, your organization and your role, and it is what every access question resolves
          against.
        </P>
        <Key>
          Accounts are approved rather than self-registered: somebody grants access, and access can
          be removed.
        </Key>
      </Section>

      <Section id="columns" title="What your account record holds">
        <SuppliedAndComputed table={users} />
      </Section>

      <Callout tone="limit" title="Sign-in here is not a managed identity provider">
        <p>
          This application checks your credentials against its own approved-user list and keeps the
          resulting session in your browser. It is not single sign-on, and it does not sit behind a
          managed identity service.
        </p>
        <p>
          What follows from that, and is worth knowing: the user id sent with each action is
          asserted by the browser rather than proved by a token a server issued. The database still
          refuses actions on projects your account cannot reach — that check is real and it is
          server-side — but an audit entry naming you records the identity the client presented.
        </p>
        <p>
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> states what that does
          and does not guarantee, in full.
        </p>
      </Callout>

      <Callout title="Practical consequences">
        <p>
          Sign out on shared machines, because a session lives in the browser. And treat your
          password as protecting everything your organization can reach through your account, not
          just your own projects.
        </p>
      </Callout>

      <Section id="related" title="Related">
        <P>
          <DocLink to="who-can-see-your-data">Who can see your data</DocLink> ·{" "}
          <DocLink to="roles-and-capabilities">Roles and capabilities</DocLink> ·{" "}
          <DocLink to="getting-an-api-key">Getting an API key</DocLink>
        </P>
        <P>
          Managed at <AppLink to="/profile">/profile</AppLink>.
        </P>
      </Section>

      <Provenance from="supabase/contract/approved_users.contract.yaml, joined to the schema" />
    </>
  );
}
