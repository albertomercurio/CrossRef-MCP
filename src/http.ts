// The core's HTTP port on Node's fetch, within the limits each service sets:
// Crossref serves anonymous clients one request at a time, arXiv asks for one
// request every three seconds. A refused request (429, 503) is tried again,
// except on Semantic Scholar, which the core replaces with arXiv. Answers are
// kept for ten minutes, so a work looked up twice is fetched once.
//
//   CROSSREF_MAILTO           an email for Crossref's "polite pool": three requests at a time
//   SEMANTIC_SCHOLAR_API_KEY  a key for Semantic Scholar, which limits anonymous requests
//   USER_AGENT                replaces the default User-Agent
import type { Http, HttpResponse } from "./core/ports";
import { version } from "../package.json";

const TIMEOUT_MS = 20_000;
const RETRIES = 3;
const MAX_RETRY_WAIT_MS = 10_000;
const CACHE_MS = 10 * 60_000;
const CACHE_ENTRIES = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** At most `concurrency` requests at once, starting at least `intervalMs` apart. */
class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  private last = 0;

  constructor(private concurrency: number, private intervalMs = 0) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.concurrency) this.active++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      const wait = this.last + this.intervalMs - Date.now();
      this.last = Date.now() + Math.max(0, wait);
      if (wait > 0) await sleep(wait);
      return await task();
    } finally {
      // Hand the slot to the next request, or free it.
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

interface Answer extends HttpResponse {
  retryAfterMs?: number;
}

export function nodeHttp(env: NodeJS.ProcessEnv = process.env): Http {
  const mailto = env.CROSSREF_MAILTO?.trim();
  const apiKey = env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  const userAgent =
    env.USER_AGENT?.trim() ||
    `CrossRef-MCP/${version} (https://github.com/albertomercurio/CrossRef-MCP${mailto ? `; mailto:${mailto}` : ""})`;

  const gates: Record<string, Gate> = {
    "api.crossref.org": mailto ? new Gate(3, 100) : new Gate(1, 200),
    "export.arxiv.org": new Gate(1, 3000),
    "pub.orcid.org": new Gate(8),
  };
  const anyHost = new Gate(Infinity);
  const cache = new Map<string, { at: number; answer: Promise<Answer> }>();

  async function once(target: URL, headers: Record<string, string>): Promise<Answer> {
    let response: Response;
    try {
      response = await fetch(target, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : String(err);
      throw new Error(`Network request to ${target.hostname} failed: ${reason}`);
    }
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // XML (arXiv, ORCID search) or an error page: the caller reads `text`
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    return { status: response.status, text, json, retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : undefined };
  }

  async function request(target: URL, headers: Record<string, string>): Promise<Answer> {
    const gate = gates[target.hostname] ?? anyHost;
    const retry = target.hostname !== "api.semanticscholar.org";
    for (let attempt = 0; ; attempt++) {
      const answer = await gate.run(() => once(target, headers));
      if (!retry || attempt >= RETRIES || (answer.status !== 429 && answer.status !== 503)) return answer;
      await sleep(Math.min(answer.retryAfterMs ?? 1000 * 2 ** attempt, MAX_RETRY_WAIT_MS));
    }
  }

  return async ({ url, headers }) => {
    const target = new URL(url);
    const all: Record<string, string> = { "User-Agent": userAgent, ...headers };
    if (mailto && target.hostname === "api.crossref.org") target.searchParams.set("mailto", mailto);
    if (apiKey && target.hostname === "api.semanticscholar.org") all["x-api-key"] = apiKey;

    const key = `${target.href} ${JSON.stringify(headers ?? {})}`;
    const kept = cache.get(key);
    if (kept && Date.now() - kept.at < CACHE_MS) {
      const { status, text, json } = await kept.answer;
      return { status, text, json };
    }
    const answer = request(target, all);
    cache.set(key, { at: Date.now(), answer });
    if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    // Keep only what succeeded: an error is asked again next time.
    answer.then(
      (a) => (a.status < 200 || a.status >= 300) && cache.delete(key),
      () => cache.delete(key)
    );
    const { status, text, json } = await answer;
    return { status, text, json };
  };
}
