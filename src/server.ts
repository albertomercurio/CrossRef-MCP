import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Http } from "./core/ports";
import { bibliography, describe, lookup, references } from "./lookup";
import { version } from "../package.json";

const ID =
  "DOI (10.1103/PhysRevLett.129.273602, doi:…, https://doi.org/…) or arXiv id (2207.09470, arXiv:2207.09470v2, quant-ph/0101001, an arxiv.org link)";

const EXPAND = z
  .boolean()
  .default(true)
  .describe("Write out initials (\"J. R.\") from the author's public ORCID record, when it is the same person");

/** A tool's answer, or its error as text the model can read and act on. */
async function answer(produce: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: await produce() }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
  }
}

export function createServer(http: Http): McpServer {
  const server = new McpServer(
    { name: "crossref-mcp-server", version },
    {
      instructions:
        "Papers and books by DOI or arXiv id. fetch_bibtex gives .bib entries, several at once; fetch_metadata " +
        "every field of one work, abstract included; fetch_references what a published paper cites.",
    }
  );

  server.registerTool(
    "fetch_metadata",
    {
      title: "Metadata of a paper or book",
      description:
        "Metadata of one paper or book, with its BibTeX entry: title (and title_latex, with math as LaTeX), " +
        "authors with ORCID, journal and its abbreviation, year, volume, issue, pages or article number, " +
        "publisher, ISBN, abstract. A DOI is read from Crossref (books lacking authors are completed from " +
        "Open Library); an arXiv id from Semantic Scholar, which gives the published version when there is " +
        "one, else from arXiv as a preprint.",
      inputSchema: {
        id: z.string().min(1).describe(ID),
        arxiv: z
          .string()
          .optional()
          .describe("arXiv id of the preprint, when `id` is the journal DOI: adds eprint to the BibTeX"),
        expand_initials: EXPAND,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, arxiv, expand_initials }) =>
      answer(async () =>
        JSON.stringify(describe(await lookup(http, id, { arxiv, expandInitials: expand_initials })), null, 2)
      )
  );

  server.registerTool(
    "fetch_bibtex",
    {
      title: "BibTeX entries",
      description:
        "BibTeX entries of one or more papers or books, ready for a .bib file: @article, @book, or @misc for a " +
        "preprint; authors as \"Family, Given\" with accents in LaTeX; the journal abbreviated; title math in " +
        "LaTeX; pages or article number; DOI, and the arXiv eprint when known. Citation keys are " +
        "FamilyYearThreeTitleWords (Macri2022SpontaneousScatteringRaman), unique within the call and against " +
        "taken_keys. Ids that fail, or name a work already listed, are % comments before the entries.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(100).describe(`One or more ids, each a ${ID}`),
        taken_keys: z
          .array(z.string())
          .optional()
          .describe("Citation keys already in the .bib file: a new entry with the same key gets a letter (Keya)"),
        expand_initials: EXPAND,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ ids, taken_keys, expand_initials }) =>
      answer(() => bibliography(http, ids, { takenKeys: taken_keys, expandInitials: expand_initials }))
  );

  server.registerTool(
    "fetch_references",
    {
      title: "References of a paper",
      description:
        "The reference list of a published paper, as its publisher deposited it with Crossref: for each cited " +
        "work its DOI when known, title, first author, year, journal, volume, first page, or the citation as " +
        "printed (unstructured). Takes a DOI, or the arXiv id of a paper published since.",
      inputSchema: { id: z.string().min(1).describe(ID) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => answer(async () => JSON.stringify(await references(http, id), null, 2))
  );

  return server;
}
