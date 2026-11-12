// Canned answers of Crossref, Semantic Scholar, arXiv and ORCID, so the tests
// take the real code path without the network.
import type { Http, HttpResponse } from "../src/core/ports";

export const PRL_DOI = "10.1103/physrevlett.129.273602";

/** As Crossref has it: an article number instead of pages, accents, ORCID links. */
export const PRL = {
  DOI: PRL_DOI,
  title: ["Spontaneous Scattering of Raman Photons from Cavity-QED Systems in the Ultrastrong Coupling Regime"],
  author: [
    { given: "Vincenzo", family: "Macrì" },
    { given: "A.", family: "Mercurio", ORCID: "http://orcid.org/0000-0001-7814-1936" },
    { given: "Franco", family: "Nori", ORCID: "http://orcid.org/0000-0003-3682-7432" },
    { given: "Salvatore", family: "Savasta" },
    { given: "Carlos", family: "Sánchez Muñoz" },
  ],
  published: { "date-parts": [[2022, 12, 29]] },
  "container-title": ["Physical Review Letters"],
  "short-container-title": ["Phys. Rev. Lett."],
  volume: "129",
  issue: "27",
  "article-number": "273602",
  publisher: "American Physical Society (APS)",
  type: "journal-article",
  URL: `https://doi.org/${PRL_DOI}`,
  reference: [
    { key: "PhysRevLett.129.273602Cc1R1", "doi-asserted-by": "publisher", DOI: "10.1038/121501c0" },
    { key: "PhysRevLett.129.273602Cc2R1", unstructured: "C. V. Raman, Indian J. Phys. 2, 387 (1928)." },
  ],
};

export const PRA_DOI = "10.1103/physreva.108.052211";

export const PRA = {
  DOI: PRA_DOI,
  title: [
    'Ratchet current in a \n<mml:math xmlns:mml="http://www.w3.org/1998/Math/MathML"><mml:mi mathvariant="script">PT</mml:mi></mml:math>\n-symmetric Floquet quantum system',
  ],
  author: [{ given: "Zhiqiang", family: "Li" }],
  published: { "date-parts": [[2023, 11, 13]] },
  "container-title": ["Physical Review A"],
  "short-container-title": ["Phys. Rev. A"],
  volume: "108",
  issue: "5",
  "article-number": "052211",
  type: "journal-article",
};

export const ARXIV_FEED = (id: string, doi?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query: id_list=${id}</title>
  <entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <published>2022-07-19T18:00:00Z</published>
    <title>Spontaneous scattering of Raman photons from cavity-QED systems</title>
    <summary>Raman photons.</summary>
    <author><name>Vincenzo Macrì</name></author>
    <author><name>Alberto Mercurio</name></author>
    ${doi ? `<arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">${doi}</arxiv:doi>` : ""}
  </entry>
</feed>`;

const ok = (json: any): HttpResponse => ({ status: 200, text: JSON.stringify(json), json });
const xml = (text: string): HttpResponse => ({ status: 200, text, json: null });
export const notFound: HttpResponse = { status: 404, text: "Resource not found.", json: null };
export const refused: HttpResponse = { status: 429, text: "Too Many Requests", json: null };

export interface FakeWeb {
  http: Http;
  /** Every address asked, in order. */
  asked: string[];
}

/** Answers by the start of the address; anything else is a 404. */
export function fakeWeb(routes: Record<string, HttpResponse | (() => HttpResponse)>): FakeWeb {
  const asked: string[] = [];
  const http: Http = async ({ url }) => {
    asked.push(url);
    const prefix = Object.keys(routes)
      .filter((p) => url.startsWith(p))
      .sort((a, b) => b.length - a.length)[0];
    const route = prefix === undefined ? notFound : routes[prefix];
    return typeof route === "function" ? route() : route;
  };
  return { http, asked };
}

export const crossref = (doi: string, work: object) => ({
  [`https://api.crossref.org/works/${encodeURIComponent(doi)}`]: ok({ message: work }),
});

export const orcid = (id: string, given: string, family: string) => ({
  [`https://pub.orcid.org/v3.0/${id}/person`]: ok({ name: { "given-names": { value: given }, "family-name": { value: family } } }),
});

export const semanticScholar = (id: string, answer: HttpResponse) => ({
  [`https://api.semanticscholar.org/graph/v1/paper/arXiv:${id}`]: answer,
});

export const arxiv = (id: string, doi?: string) => ({
  [`https://export.arxiv.org/api/query?id_list=${id}`]: xml(ARXIV_FEED(id, doi)),
});

export { ok };
