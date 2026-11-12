# CrossRef MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI assistant the metadata and the BibTeX entry of a paper or a book, from its DOI or its arXiv id.

It reads Crossref for DOIs, Semantic Scholar and arXiv for arXiv ids (the published version when there is one), Open Library for books that Crossref lists without authors, and ORCID for given names published as initials. The code that fetches and formats references is the one of the Obsidian plugin [Research Literature Manager](https://github.com/albertomercurio/Obsidian-Bibliography-Template), so both give the same entries.

## Tools

| Tool | Input | Answer |
|---|---|---|
| `fetch_bibtex` | `ids`: one or more DOIs or arXiv ids; `taken_keys` (optional) | BibTeX entries, ready for a `.bib` file |
| `fetch_metadata` | `id`; `arxiv` (optional) | Every field of one work as JSON, abstract and BibTeX included |
| `fetch_references` | `id`: a DOI, or the arXiv id of a published paper | The paper's reference list, as deposited with Crossref |

Ids can be written as they are usually pasted: `10.1103/PhysRevLett.129.273602`, `doi:…`, `https://doi.org/…`, `2207.09470`, `arXiv:2207.09470v2`, `quant-ph/0101001`, `https://arxiv.org/abs/…`.

`fetch_bibtex` with `["10.1103/physrevlett.129.273602"]` gives:

```bibtex
@article{Macri2022SpontaneousScatteringRaman,
  author = {Macr\`{i}, Vincenzo and Mercurio, Alberto and Nori, Franco and Savasta, Salvatore and S\'{a}nchez Mu\~{n}oz, Carlos},
  title = {{Spontaneous Scattering of Raman Photons from Cavity-QED Systems in the Ultrastrong Coupling Regime}},
  journal = {Phys. Rev. Lett.},
  year = {2022},
  volume = {129},
  number = {27},
  pages = {273602},
  doi = {10.1103/physrevlett.129.273602},
  eprint = {2207.09470},
  archivePrefix = {arXiv}
}
```

What the entries contain:

- **Citation key** `FamilyYearThreeTitleWords`, in ASCII. Within one call keys are unique, and so are they against `taken_keys`, the keys already in your `.bib` file: a clash gets a letter (`…Ramana`).
- **Authors** as `Family, Given`, with accents written in LaTeX. When a given name is published as initials ("J. R.") and the author has an ORCID, the server takes the given names from the public ORCID record, if that record has the same family name and given names that match the initials; otherwise the name stays as published. `expand_initials: false` turns this off.
- **Title** in double braces, with math converted from Crossref's MathML into LaTeX (`$\mathcal{PT}$`).
- **Journal** abbreviated (`Phys. Rev. Lett.`), and the article number when the journal has no pages.
- **DOI**, with no `url` when the DOI resolves, and the arXiv `eprint` when it is known: from the arXiv id, or from `arxiv` in `fetch_metadata`.
- `@article`, `@book` (publisher, ISBN), or `@misc` with `note = {Preprint}` for a paper still on arXiv only.

When an id fails or names a work already in the list (a DOI and the arXiv id of the same paper), `fetch_bibtex` writes it as a `%` comment before the entries and does not stop.

## Installation

You need Node.js 20 or later.

**Claude Code:**

```sh
claude mcp add crossref -- npx -y github:albertomercurio/CrossRef-MCP
```

**Claude Desktop** (`claude_desktop_config.json`), and other clients that take a command:

```json
{
  "mcpServers": {
    "crossref": {
      "command": "npx",
      "args": ["-y", "github:albertomercurio/CrossRef-MCP"],
      "env": { "CROSSREF_MAILTO": "you@example.org" }
    }
  }
}
```

**From a clone:** `npm ci && npm run build`, then run `node /path/to/CrossRef-MCP/dist/index.js` as the command.

**Docker:** `docker compose build`, then run `docker run -i --rm -e CROSSREF_MAILTO crossref-mcp` as the command.

### Environment variables

| Variable | Effect |
|---|---|
| `CROSSREF_MAILTO` | Your email, sent to Crossref with each request. Crossref then serves you from its "polite pool", which allows three requests at a time instead of one. Recommended. |
| `SEMANTIC_SCHOLAR_API_KEY` | A [Semantic Scholar key](https://www.semanticscholar.org/product/api). Without one, Semantic Scholar often refuses requests; the server then reads arXiv, which is slower but finds the published version too. |
| `USER_AGENT` | Replaces the User-Agent the server sends. |

The server stays within each service's limits: one Crossref request at a time without `CROSSREF_MAILTO`, one arXiv request every three seconds, and retries when a service asks to slow down. It keeps answers for ten minutes, so a work asked twice is fetched once.

## Development

```sh
npm ci
npm test            # offline: canned answers of each service
npm run typecheck
npm run build       # dist/index.js, a single file that needs only Node
```

`src/core/` is copied from the plugin and should not be edited here. To bring in a newer version of the plugin's code:

```sh
npm run sync-core -- ../Obsidian-Bibliography-Template
```

The rest of `src/` is the server: `lookup.ts` (ORCID names, several entries at once, references), `server.ts` (the tools), `http.ts` (requests, limits, cache) and `index.ts` (stdio).

## Changes from 1.x

- `fetch_doi_metadata` is now `fetch_metadata`, and takes `id` instead of `doi`: a DOI or an arXiv id.
- New: `fetch_bibtex`, for several entries at once.
- BibTeX is generated here instead of taken from Crossref's own export. That export gave keys such as `Macr__2022`, raw MathML in titles, accents not in LaTeX, all on one line, and left out article numbers.
- arXiv ids are supported, and so are books that Crossref lists without authors.
