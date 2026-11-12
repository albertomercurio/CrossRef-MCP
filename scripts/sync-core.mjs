// Copies the metadata code of the Obsidian plugin Research Literature Manager
// (github.com/albertomercurio/Obsidian-Bibliography-Template) into src/core/,
// so this server fetches and formats references exactly as the plugin does:
//
//   node scripts/sync-core.mjs ../Obsidian-Bibliography-Template
//
// Whole files are copied as they are; from the other three only the
// declarations the core needs are taken. Nothing in src/core/ is edited here.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const plugin = process.argv[2];
if (!plugin) {
  console.error("Usage: node scripts/sync-core.mjs <folder of the plugin's repository>");
  process.exit(1);
}

const read = (file) => readFileSync(join(plugin, "src", file), "utf8");
const header = (file) =>
  `// Copied from src/${file} of github.com/albertomercurio/Obsidian-Bibliography-Template\n` +
  `// by scripts/sync-core.mjs: change it there, then sync.\n\n`;
const out = "src/core";
mkdirSync(out, { recursive: true });

const whole = ["CrossrefService.ts", "ArxivService.ts", "OpenLibraryService.ts", "OrcidService.ts", "BibtexGenerator.ts", "nameUtils.ts"];
for (const file of whole) writeFileSync(join(out, file), header(file) + read(file));

/** A top-level declaration, from `export …` to the closing brace at the start of a line. */
const block = (declaration) => new RegExp(`^export ${declaration}\\b[\\s\\S]*?^\\}$`, "m");

function pick(file, patterns) {
  const text = read(file);
  const parts = patterns.map((pattern) => {
    const match = text.match(pattern);
    if (!match) throw new Error(`src/${file}: nothing matches ${pattern}`);
    return match[0];
  });
  return header(file) + parts.join("\n\n") + "\n";
}

writeFileSync(join(out, "ports.ts"), pick("ports.ts", [block("interface HttpResponse"), /^export type Http = .*;$/m]));
writeFileSync(join(out, "types.ts"), pick("types.ts", [block("interface PaperMetadata"), block("interface AuthorRaw")]));
writeFileSync(join(out, "detectInput.ts"), pick("ImportService.ts", [block("function detectInput")]));

console.log(`src/core/: ${[...whole, "ports.ts", "types.ts", "detectInput.ts"].join(", ")}`);
