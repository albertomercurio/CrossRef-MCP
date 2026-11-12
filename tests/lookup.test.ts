import { test } from "node:test";
import assert from "node:assert/strict";
import { bibliography, describe, expandInitials, lookup, MAX_ORCID_LOOKUPS, references } from "../src/lookup";
import { arxiv, crossref, fakeWeb, ok, orcid, PRA, PRA_DOI, PRL, PRL_DOI, refused, semanticScholar } from "./helpers";

test("a DOI: Crossref's record as the plugin reads it", async () => {
  const web = fakeWeb({ ...crossref(PRL_DOI, PRL) });
  const json = describe(await lookup(web.http, `https://dx.doi.org/${PRL_DOI}`, { expandInitials: false }));
  assert.equal(json.pages, "273602", "the article number stands for the pages");
  assert.equal(json.journal_abbreviation, "Phys. Rev. Lett.");
  assert.deepEqual(json.authors?.[1], { given: "A.", family: "Mercurio", orcid: "0000-0001-7814-1936" });
  assert.equal(json.title_latex, undefined, "no math in the title");
  assert.match(json.bibtex!, /^@article\{Macri2022SpontaneousScatteringRaman,\n/);
  assert.match(json.bibtex!, /author = \{Macr\\`\{i\}, Vincenzo and Mercurio, A\. and .*S\\'\{a\}nchez Mu\\~\{n\}oz, Carlos\}/);
  assert.match(json.bibtex!, /journal = \{Phys\. Rev\. Lett\.\}/);
  assert.doesNotMatch(json.bibtex!, /url =/, "the DOI resolves");
});

test("math in a title: plain text in title, LaTeX in title_latex and BibTeX", async () => {
  const web = fakeWeb({ ...crossref(PRA_DOI, PRA) });
  const json = describe(await lookup(web.http, PRA_DOI));
  assert.equal(json.title, "Ratchet current in a PT-symmetric Floquet quantum system");
  assert.equal(json.title_latex, "Ratchet current in a $\\mathcal{PT}$-symmetric Floquet quantum system");
  assert.match(json.bibtex!, /title = \{\{Ratchet current in a \$\\mathcal\{PT\}\$-symmetric/);
});

test("an arXiv id: the published version through Semantic Scholar, with the eprint", async () => {
  const web = fakeWeb({
    ...semanticScholar("2207.09470", ok({ title: "T", externalIds: { DOI: PRL_DOI, ArXiv: "2207.09470" } })),
    ...crossref(PRL_DOI, PRL),
  });
  const metadata = await lookup(web.http, "https://arxiv.org/abs/2207.09470v2", { expandInitials: false });
  assert.equal(metadata.doi, PRL_DOI);
  assert.match(describe(metadata).bibtex!, /eprint = \{2207\.09470\},\n  archivePrefix = \{arXiv\}/);
});

test("Semantic Scholar refuses: arXiv's record leads to the journal DOI", async () => {
  const web = fakeWeb({
    ...semanticScholar("2207.09470", refused),
    ...arxiv("2207.09470", PRL_DOI),
    ...crossref(PRL_DOI, PRL),
  });
  const metadata = await lookup(web.http, "2207.09470", { expandInitials: false });
  assert.equal(metadata.itemType, "article");
  assert.equal(metadata.journalShort, "Phys. Rev. Lett.");
  assert.equal(metadata.arxivId, "2207.09470");
});

test("a preprint stays a preprint: @misc with the arXiv DOI", async () => {
  const web = fakeWeb({ ...semanticScholar("2207.09470", refused), ...arxiv("2207.09470") });
  const json = describe(await lookup(web.http, "2207.09470"));
  assert.equal(json.type, "preprint");
  assert.match(json.bibtex!, /^@misc\{Macri2022SpontaneousScatteringRaman,/);
  assert.match(json.bibtex!, /doi = \{10\.48550\/arXiv\.2207\.09470\}/);
  assert.match(json.bibtex!, /note = \{Preprint\}/);
});

test("the arxiv option adds the eprint to a DOI lookup, and must be an arXiv id", async () => {
  const web = fakeWeb({ ...crossref(PRL_DOI, PRL) });
  assert.equal((await lookup(web.http, PRL_DOI, { arxiv: "arXiv:2207.09470v3", expandInitials: false })).arxivId, "2207.09470");
  await assert.rejects(lookup(web.http, PRL_DOI, { arxiv: "10.1103/x" }), /not an arXiv id/);
});

test("initials written out from ORCID only when the record is the same person", async () => {
  const web = fakeWeb({
    ...orcid("0000-0000-0000-0001", "Alberto", "Mercurio"),
    ...orcid("0000-0000-0000-0002", "Someone", "Else"),
    ...orcid("0000-0000-0000-0003", "Alexander", "Kamenetskikh"),
    ...orcid("0000-0000-0000-0004", "Yi-Te", "Huang"),
  });
  const authors = await expandInitials(web.http, [
    { given: "A.", family: "Mercurio", orcid: "0000-0000-0000-0001" },
    { given: "A.", family: "Mercurio", orcid: "0000-0000-0000-0002" }, // another family name
    { given: "A.S.", family: "Kamenetskikh", orcid: "0000-0000-0000-0003" }, // the record drops a name
    { given: "Y.-T.", family: "Huang", orcid: "0000-0000-0000-0004" },
    { given: "B.", family: "Nobody", orcid: "0000-0000-0000-0009" }, // no record
    { given: "Franco", family: "Nori", orcid: "0000-0000-0000-0005" }, // nothing to write out
  ]);
  assert.deepEqual(authors.map((a) => a.given), ["Alberto", "A.", "A.S.", "Yi-Te", "B.", "Franco"]);
  assert.equal(web.asked.filter((u) => u.includes("0000-0000-0000-0005")).length, 0, "full names are not looked up");
});

test("ORCID lookups are capped for large collaborations", async () => {
  const web = fakeWeb({});
  const authors = Array.from({ length: 60 }, (_, i) => ({ given: "J.", family: `F${i}`, orcid: `0000-0000-0000-${String(i).padStart(4, "0")}` }));
  await expandInitials(web.http, authors);
  assert.equal(web.asked.length, MAX_ORCID_LOOKUPS);
});

test("several works: one .bib, unique keys, failures and duplicates as comments", async () => {
  const web = fakeWeb({
    ...crossref(PRL_DOI, PRL),
    ...crossref("10.1103/other", { ...PRL, DOI: "10.1103/other", volume: "130" }),
    ...semanticScholar("2207.09470", ok({ externalIds: { DOI: PRL_DOI } })),
  });
  const bib = await bibliography(web.http, [PRL_DOI, "10.1103/other", "10.9999/missing", "2207.09470", PRL_DOI], {
    expandInitials: false,
    takenKeys: ["Macri2022SpontaneousScatteringRaman"],
  });
  const [comments, ...entries] = bib.trim().split("\n\n");
  assert.equal(
    comments,
    [
      '% 10.9999/missing: Crossref returned 404 for DOI "10.9999/missing". Check that the DOI is correct.',
      `% 2207.09470: the same work as ${PRL_DOI}`,
    ].join("\n")
  );
  assert.deepEqual(
    entries.map((e) => e.match(/^@article\{(\w+),/)?.[1]),
    ["Macri2022SpontaneousScatteringRamana", "Macri2022SpontaneousScatteringRamanb"]
  );
  assert.match(entries[0], /eprint = \{2207\.09470\}/, "the arXiv id named later still gives the eprint");
});

test("references: what Crossref has, without empty fields", async () => {
  const web = fakeWeb({ ...crossref(PRL_DOI, PRL), ...crossref(PRA_DOI, PRA) });
  const result = await references(web.http, PRL_DOI);
  assert.equal(result.references_count, 2);
  assert.deepEqual(result.references, [
    { key: "PhysRevLett.129.273602Cc1R1", doi: "10.1038/121501c0" },
    { key: "PhysRevLett.129.273602Cc2R1", unstructured: "C. V. Raman, Indian J. Phys. 2, 387 (1928)." },
  ]);
  assert.match((await references(web.http, PRA_DOI)).note!, /did not deposit/);
});

test("references of a preprint without a journal DOI: a clear error", async () => {
  const web = fakeWeb({ ...semanticScholar("2207.09470", refused), ...arxiv("2207.09470") });
  await assert.rejects(references(web.http, "2207.09470"), /no journal DOI/);
});
