// The files the manual points at — WP 5.2j, §4 D110.
//
// The manual now links three sets of shipped assets: the CSV/JSON templates a
// person downloads before filling anything in, the three upload guides, and
// the Colab notebook `/developer` offers. All three are DERIVED — from
// `UploadWizard.tsx`'s `templateTypes` and from `DeveloperApi.tsx`'s own href —
// so a file renamed in the product changes the manual with nobody editing a
// page.
//
// Derived is not the same as correct. A derivation faithfully reproduces a
// path that was already wrong, and a documentation page that 404s is worse
// than one that never offered the file: a reader who clicks and gets nothing
// concludes the product does not ship it. So every derived path is resolved
// against `public/` here, on disk.
//
// The reverse direction is checked too, and deliberately reported rather than
// failed: a file sitting in `public/template/` that no dataset offers is a
// template nobody can reach. Two of the fourteen are exactly that
// (`location-dataset-template.csv`, `supply-chain-data-template.csv`) — they
// belong to no wizard dataset and to no page, and deleting them is a product
// decision this package does not own. Printing the count keeps them from
// becoming invisible the way the fourteen templates themselves were.

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { API_NOTEBOOK, UPLOAD_ASSETS } from "../generated/policy.generated";
import { REFERENCE_TABLES } from "../generated/reference.generated";
import { ALL_PAGES } from "../registry";

const PUBLIC = join(__dirname, "..", "..", "..", "..", "public");
const resolve = (href: string) => join(PUBLIC, href.replace(/^\//, ""));

describe("every asset the manual links exists", () => {
  it("derived the FOURTEEN datasets the wizard declares", () => {
    // The vacuity rule (§4 D57): a scan that matched nothing would make every
    // assertion below pass over an empty list.
    //
    // THIRTEEN WHEN THIS TEST WAS WRITTEN, FOURTEEN SINCE WP 6.2 — and the way it
    // moved is §4 D39 exactly. WP 5.2j added this assertion while WP 6.2 added the
    // `item_master_customers` dataset (§4 D108: `P-C.2` reads two `customers`
    // columns and nothing in the product could set either). NEITHER BRANCH WAS RED
    // ALONE: this test did not exist on one, and the dataset did not exist on the
    // other. The merge is where the two facts met, and `contract:check` on the
    // merge result is the only thing that could have seen it.
    //
    // The count stays SPELLED OUT rather than derived from `UPLOAD_ASSETS.length`,
    // which would make the assertion vacuous — and it is named in the title so a
    // stale one is obvious rather than arithmetic nobody re-reads (D101's lesson).
    //
    // Fourteen datasets, thirteen template FILES: §4 D110's "fourteen CSV
    // templates" counts files in `public/template/`, and the two numbers are still
    // different because `node_list` deliberately offers no template while
    // `customers.csv` added one. They were equal by coincidence before.
    expect(UPLOAD_ASSETS.length).toBe(14);
    expect(UPLOAD_ASSETS.filter((a) => a.templateFile).length).toBe(13);
  });

  it.each(UPLOAD_ASSETS.filter((a) => a.templateFile).map((a) => [a.id, a.templateFile!]))(
    "%s template %s",
    (_id, file) => {
      expect(existsSync(resolve(file)), `${file} is linked and not shipped`).toBe(true);
    },
  );

  it.each(UPLOAD_ASSETS.filter((a) => a.guideFile).map((a) => [a.id, a.guideFile!]))(
    "%s guide %s",
    (_id, file) => {
      expect(existsSync(resolve(file)), `${file} is linked and not shipped`).toBe(true);
    },
  );

  it("ships the Colab notebook /developer offers", () => {
    expect(existsSync(resolve(API_NOTEBOOK)), `${API_NOTEBOOK} is linked and not shipped`).toBe(
      true,
    );
  });

  it("records node_list as deliberately template-less rather than missing one", () => {
    // The one dataset whose `templateFile` is empty in the wizard. If it ever
    // gains a template this fails, which is the reminder to say so on the page
    // instead of leaving the "there is no template, and here is why" sentence
    // standing over a template that now exists.
    const nodeList = UPLOAD_ASSETS.find((a) => a.id === "node_list");
    expect(nodeList, "node_list is no longer a wizard dataset").toBeDefined();
    expect(nodeList!.templateFile).toBeNull();
  });

  it("reports templates no dataset offers", () => {
    const offered = new Set(
      UPLOAD_ASSETS.map((a) => a.templateFile).filter(Boolean).map((f) => f!.split("/").pop()),
    );
    const orphans = readdirSync(join(PUBLIC, "template")).filter((f) => !offered.has(f));
    // Reported, not failed — see the header. The number is the point.
    console.log(
      `public/template: ${orphans.length} of ${readdirSync(join(PUBLIC, "template")).length} ` +
        `reachable from no wizard dataset${orphans.length ? ` — ${orphans.join(", ")}` : ""}`,
    );
    expect(orphans.length).toBeLessThanOrEqual(2);
  });
});

describe("every table page resolves to the dataset that loads it", () => {
  // A §3 page either names a wizard dataset — through the contract's
  // `ingest_dataset.wizard_id`, or through the registry's `wizardId` for the
  // four tables the contract cannot answer for — or it does not, and then the
  // page must not claim a template. Nothing here types a path.
  const ids = new Set(UPLOAD_ASSETS.map((a) => a.id));

  it.each(ALL_PAGES.filter((p) => p.wizardId).map((p) => [p.slug, p.wizardId!]))(
    "%s → %s",
    (slug, id) => {
      expect(ids.has(id), `${slug} names wizard dataset "${id}", which the wizard does not offer`)
        .toBe(true);
    },
  );

  it("never restates a binding the contract already declares", () => {
    // `registry.wizardId` exists only for the tables whose sidecar carries no
    // `ingest_dataset` block — the four that reach their tables through bulk
    // RPCs rather than through `ingest_land_file` (§4 D56). A page that
    // declared one for a table the contract already answers for would be a
    // second authority for the same fact, which is `single-source`.
    for (const p of ALL_PAGES.filter((x) => x.wizardId && x.table)) {
      const t = REFERENCE_TABLES.find((x) => x.table === p.table);
      expect(
        t?.ingestDataset ?? null,
        `${p.slug} declares wizardId although ${p.table}'s sidecar already does`,
      ).toBeNull();
    }
  });
});
