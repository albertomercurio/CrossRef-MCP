// What the tools do, on top of the plugin's core (src/core/): no MCP here, so
// the tests call it directly.
import { ArxivService } from "./core/ArxivService";
import { generateBibtex } from "./core/BibtexGenerator";
import { CrossrefService } from "./core/CrossrefService";
import { detectInput } from "./core/detectInput";
import { nameTokens, sameFamilyName, sameGivenNames } from "./core/nameUtils";
import { OrcidService, type OrcidRecord } from "./core/OrcidService";
import type { Http } from "./core/ports";
import type { AuthorRaw, PaperMetadata } from "./core/types";

/** A DOI without its doi.org or "doi:" prefix. */
function bareDoi(doi: string): string {
  return doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").trim();
}

const isArxivDoi = (doi: string | undefined) => !!doi && /^10\.48550\/arxiv/i.test(doi);

export interface LookupOptions {
  /** arXiv id of the preprint, when the work is looked up by its journal DOI: becomes the BibTeX eprint. */
  arxiv?: string;
  /** Write out initials from the author's ORCID record (default true). */
  expandInitials?: boolean;
}

/**
 * The record of a DOI or arXiv id, as the plugin imports it: for an arXiv id,
 * the published version when Semantic Scholar or arXiv names its journal DOI.
 */
export async function lookup(http: Http, raw: string, options: LookupOptions = {}): Promise<PaperMetadata> {
  const { type, id } = detectInput(raw);
  const metadata =
    type === "arxiv" ? await new ArxivService(http).fetchByArxivId(id) : await new CrossrefService(http).fetchByDOI(id);
  if (options.arxiv) {
    const preprint = detectInput(options.arxiv);
    if (preprint.type !== "arxiv") throw new Error(`"${options.arxiv}" is not an arXiv id.`);
    metadata.arxivId = preprint.id;
  }
  if (options.expandInitials !== false) metadata.authors = await expandInitials(http, metadata.authors);
  return metadata;
}

// ---- Initials ----------------------------------------------------------------

/** ORCID records read for one work at most: a large collaboration would otherwise send hundreds. */
export const MAX_ORCID_LOOKUPS = 25;

const nameWords = (s: string) => nameTokens(s.replace(/-/g, " "));

/**
 * Authors published with initials ("J. R.") and an ORCID get the given names of
 * their ORCID record, when the record has the same family name, at least as many
 * given names, and given names the initials stand for. Anything else stays as
 * published: a record that fails, is private or names someone else.
 */
export async function expandInitials(http: Http, authors: AuthorRaw[]): Promise<AuthorRaw[]> {
  const orcid = new OrcidService(http);
  const wanted = authors.filter((a) => a.orcid && nameWords(a.given).some((w) => w.length === 1)).map((a) => a.orcid!);
  const records = new Map<string, OrcidRecord>();
  await Promise.all(
    [...new Set(wanted)].slice(0, MAX_ORCID_LOOKUPS).map(async (id) => {
      try {
        records.set(id, await orcid.getRecord(id));
      } catch {
        // the name stays as published
      }
    })
  );
  return authors.map((author) => {
    const record = author.orcid ? records.get(author.orcid) : undefined;
    if (!record?.givenName || !sameFamilyName(record.familyName, author.family)) return author;
    const published = nameWords(author.given);
    const full = nameWords(record.givenName);
    const fuller = full.length >= published.length && full.join("").length > published.join("").length;
    return fuller && sameGivenNames(author.given, record.givenName) ? { ...author, given: record.givenName } : author;
  });
}

// ---- Output ------------------------------------------------------------------

/** Drops empty fields, so the JSON a model reads holds only what the source gives. */
function compact<T extends Record<string, unknown>>(object: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== "")
  ) as Partial<T>;
}

export function bibtexOf(metadata: PaperMetadata, takenKeys?: Set<string>): string {
  return generateBibtex({ metadata, takenKeys });
}

export function citekeyOf(entry: string): string | undefined {
  return entry.match(/^@\w+\{([^,\s]+),/)?.[1];
}

/** The answer of fetch_metadata. */
export function describe(metadata: PaperMetadata) {
  return compact({
    type: metadata.itemType,
    title: metadata.title,
    title_latex: metadata.titleLatex !== metadata.title ? metadata.titleLatex : undefined,
    authors: metadata.authors.map((a) => compact({ given: a.given, family: a.family, orcid: a.orcid })),
    journal: metadata.journalFull,
    journal_abbreviation: metadata.journalShort,
    year: metadata.year || undefined,
    volume: metadata.volume,
    issue: metadata.issue,
    pages: metadata.pages,
    publisher: metadata.publisher,
    doi: metadata.doi,
    arxiv: metadata.arxivId,
    isbn: metadata.isbn,
    url: metadata.url,
    abstract: metadata.abstract,
    bibtex: bibtexOf(metadata),
  });
}

// ---- Several works -------------------------------------------------------------

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface BibliographyOptions {
  expandInitials?: boolean;
  /** Citation keys already in the user's .bib: new entries get another one ("Key" → "Keya"). */
  takenKeys?: string[];
}

/**
 * BibTeX entries for several works, in the order given, with citation keys
 * unique among them and against `takenKeys`. What could not be fetched, and a
 * work named twice (its DOI and its arXiv id), is a % comment before the entries.
 */
export async function bibliography(http: Http, ids: string[], options: BibliographyOptions = {}): Promise<string> {
  const unique = [...new Map(ids.map((raw) => [raw.trim().toLowerCase(), raw.trim()])).values()].filter(Boolean);
  const results = await mapPool(unique, 4, (raw) =>
    lookup(http, raw, { expandInitials: options.expandInitials }).then(
      (metadata) => ({ metadata }),
      (err) => ({ error: messageOf(err) })
    )
  );

  const comments: string[] = [];
  const works = new Map<string, { raw: string; metadata: PaperMetadata }>();
  results.forEach((result, i) => {
    const raw = unique[i];
    if ("error" in result) {
      comments.push(`% ${raw}: ${result.error}`);
      return;
    }
    const { metadata } = result;
    const work = metadata.doi ? `doi:${metadata.doi.toLowerCase()}` : `arxiv:${metadata.arxivId}`;
    const first = works.get(work);
    if (!first) {
      works.set(work, { raw, metadata });
      return;
    }
    // The journal DOI and the arXiv id of one paper: one entry, with the eprint.
    first.metadata.arxivId ??= metadata.arxivId;
    comments.push(`% ${raw}: the same work as ${first.raw}`);
  });

  const taken = new Set(options.takenKeys ?? []);
  const entries = [...works.values()].map(({ metadata }) => {
    const entry = bibtexOf(metadata, taken);
    const key = citekeyOf(entry);
    if (key) taken.add(key);
    return entry;
  });
  return [comments.join("\n"), entries.join("\n\n")].filter(Boolean).join("\n\n") + "\n";
}

// ---- References ----------------------------------------------------------------

/** What a paper cites, as its publisher deposited it with Crossref. */
export async function references(http: Http, raw: string) {
  const { type, id } = detectInput(raw);
  let doi = bareDoi(id);
  if (type === "arxiv") {
    const metadata = await new ArxivService(http).fetchByArxivId(id);
    if (!metadata.doi || isArxivDoi(metadata.doi)) {
      throw new Error(`arXiv ${id} has no journal DOI: Crossref has reference lists of published papers only.`);
    }
    doi = metadata.doi;
  }

  const response = await http({ url: `https://api.crossref.org/works/${encodeURIComponent(doi)}` });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Crossref returned ${response.status} for DOI "${doi}". Check that the DOI is correct.`);
  }
  const work = response.json?.message ?? {};
  const list: any[] = work.reference ?? [];
  return compact({
    doi,
    title: String(work.title?.[0] ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
    references_count: list.length,
    note: list.length ? undefined : "Crossref has no reference list for this DOI: the publisher did not deposit one.",
    references: list.map((r) =>
      compact({
        key: r.key,
        doi: r.DOI,
        title: r["article-title"] ?? r["volume-title"],
        first_author: r.author,
        year: r.year,
        journal: r["journal-title"] ?? r["series-title"],
        volume: r.volume,
        issue: r.issue,
        page: r["first-page"],
        unstructured: r.unstructured,
      })
    ),
  });
}
