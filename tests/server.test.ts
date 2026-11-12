import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { nodeHttp } from "../src/http";
import { createServer } from "../src/server";
import { crossref, fakeWeb, PRL, PRL_DOI } from "./helpers";

async function connect(routes: Parameters<typeof fakeWeb>[0]) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(fakeWeb(routes).http).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const text = (result: any) => result.content[0].text as string;

test("the tools a client sees", async () => {
  const client = await connect({});
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["fetch_metadata", "fetch_bibtex", "fetch_references"]);
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint));
  assert.match(client.getInstructions() ?? "", /fetch_bibtex/);
});

test("fetch_metadata and fetch_bibtex through MCP", async () => {
  const client = await connect(crossref(PRL_DOI, PRL));
  const metadata = JSON.parse(text(await client.callTool({ name: "fetch_metadata", arguments: { id: PRL_DOI, expand_initials: false } })));
  assert.equal(metadata.journal, "Physical Review Letters");
  const bib = text(await client.callTool({ name: "fetch_bibtex", arguments: { ids: [PRL_DOI], expand_initials: false } }));
  assert.match(bib, /^@article\{Macri2022SpontaneousScatteringRaman,/);
});

test("a failure is a tool error the model can read", async () => {
  const client = await connect({});
  const result: any = await client.callTool({ name: "fetch_metadata", arguments: { id: "10.9999/missing" } });
  assert.equal(result.isError, true);
  assert.match(text(result), /Crossref returned 404 for DOI "10\.9999\/missing"/);
});

test("http: retries a refusal, keeps successes for the next call, adds the mailto for Crossref", async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  let refusals = 1;
  globalThis.fetch = (async (input: URL | string) => {
    asked.push(String(input));
    if (refusals-- > 0) return new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } });
    return new Response(JSON.stringify({ message: { ok: true } }), { status: 200 });
  }) as typeof fetch;
  try {
    const http = nodeHttp({ CROSSREF_MAILTO: "someone@example.org" });
    const first = await http({ url: "https://api.crossref.org/works/10.1%2Fx" });
    const second = await http({ url: "https://api.crossref.org/works/10.1%2Fx" });
    assert.equal(first.status, 200);
    assert.deepEqual(second.json, { message: { ok: true } });
    assert.equal(asked.length, 2, "one refusal, one success, then the cache");
    assert.equal(asked[0], "https://api.crossref.org/works/10.1%2Fx?mailto=someone%40example.org");
  } finally {
    globalThis.fetch = realFetch;
  }
});
