// Bundles the server into one file, dist/index.js, that runs with Node alone.
import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  // CommonJS dependencies need `require` inside an ES module bundle.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
