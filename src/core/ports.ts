// Copied from src/ports.ts of github.com/albertomercurio/Obsidian-Bibliography-Template
// by scripts/sync-core.mjs: change it there, then sync.

export interface HttpResponse {
  status: number;
  text: string;
  json: any;
}

export type Http = (request: { url: string; headers?: Record<string, string> }) => Promise<HttpResponse>;
