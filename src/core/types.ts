// Copied from src/types.ts of github.com/albertomercurio/Obsidian-Bibliography-Template
// by scripts/sync-core.mjs: change it there, then sync.

export interface PaperMetadata {
  inputType: "doi" | "arxiv";
  doi?: string;
  arxivId?: string;
  title: string;
  year: number;
  authors: AuthorRaw[];
  /** Full journal name as returned by the API */
  journalFull?: string;
  /** Short journal name / abbreviation from the API (may be absent) */
  journalShort?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  url?: string;
  /** For books */
  isbn?: string;
  itemType: "article" | "book" | "preprint";
  abstract?: string;
  /**
   * Title with math rendered as inline LaTeX ($...$). Used exclusively for
   * .bib output. Do NOT use for filenames or frontmatter — Obsidian won't
   * render LaTeX there.
   */
  titleLatex?: string;
}

export interface AuthorRaw {
  given: string;
  family: string;
  /** ORCID without URL prefix, e.g. "0000-0001-2345-6789" */
  orcid?: string;
}
