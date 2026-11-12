// Copied from src/ImportService.ts of github.com/albertomercurio/Obsidian-Bibliography-Template
// by scripts/sync-core.mjs: change it there, then sync.

export function detectInput(raw: string): { type: "doi" | "arxiv"; id: string } {
  const s = raw.trim();

  // arXiv proxy DOI (registered with DataCite, not Crossref):
  // "10.48550/arXiv.2603.13030" → arXiv id "2603.13030". Must be checked
  // BEFORE the generic DOI rule below, which would otherwise swallow it.
  const arxivDoi = s.match(
    /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i
  );
  if (arxivDoi) {
    return { type: "arxiv", id: arxivDoi[1] };
  }

  // DOI: starts with "10." or "doi:" or "https://doi.org/"
  if (
    /^10\.\d{4,}/i.test(s) ||
    /^doi:/i.test(s) ||
    /^https?:\/\/doi\.org\//i.test(s)
  ) {
    return { type: "doi", id: s };
  }

  // arXiv: "arXiv:XXXX.XXXXX" or just "XXXX.XXXXX" or "XXXX.XXXXXvN"
  if (/^(arxiv:)?\d{4}\.\d{4,5}(v\d+)?$/i.test(s)) {
    return { type: "arxiv", id: s };
  }

  // Fallback: treat as DOI
  return { type: "doi", id: s };
}
