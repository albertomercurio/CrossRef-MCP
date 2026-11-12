// Copied from src/ImportService.ts of github.com/albertomercurio/Obsidian-Bibliography-Template
// by scripts/sync-core.mjs: change it there, then sync.

/** An arXiv id without its prefix and version: "arXiv:2207.09470v2" → "2207.09470". */
function bareArxiv(id: string): string {
  return id.trim().replace(/^arxiv:\s*/i, "").replace(/v\d+$/i, "");
}

/**
 * A DOI as given, or an arXiv id without prefix and version. Also takes what is
 * often pasted instead: doi.org and dx.doi.org links, arxiv.org pages and PDFs.
 */
export function detectInput(raw: string): { type: "doi" | "arxiv"; id: string } {
  const s = raw.trim();

  // arXiv proxy DOI (registered with DataCite, not Crossref):
  // "10.48550/arXiv.2603.13030" → arXiv id "2603.13030". Must be checked
  // BEFORE the generic DOI rule below, which would otherwise swallow it.
  const arxivDoi = s.match(
    /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i
  );
  if (arxivDoi) {
    return { type: "arxiv", id: bareArxiv(arxivDoi[1]) };
  }

  // arXiv page or PDF: "https://arxiv.org/abs/2207.09470v2", ".../pdf/2207.09470.pdf"
  const arxivLink = s.match(
    /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/i
  );
  if (arxivLink) {
    return { type: "arxiv", id: bareArxiv(arxivLink[1]) };
  }

  // DOI: starts with "10." or "doi:" or a doi.org link
  if (
    /^10\.\d{4,}/i.test(s) ||
    /^doi:/i.test(s) ||
    /^https?:\/\/(?:dx\.)?doi\.org\//i.test(s)
  ) {
    return { type: "doi", id: s };
  }

  // arXiv: "2207.09470", "arXiv:2207.09470v2", and ids before 2007:
  // "quant-ph/0101001", "math.GT/0309136v1"
  if (/^(arxiv:\s*)?(\d{4}\.\d{4,5}|[a-z-]+(\.[a-z]{2})?\/\d{7})(v\d+)?$/i.test(s)) {
    return { type: "arxiv", id: bareArxiv(s) };
  }

  // Fallback: treat as DOI
  return { type: "doi", id: s };
}
