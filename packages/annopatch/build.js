import * as esbuild from "esbuild";

await Promise.all(
  [{ entryPoints: ["src/index.ts"], outfile: "dist/index.js" }].map((options) =>
    esbuild.build({
      ...options,
      bundle: true,
      platform: "node",
      format: "esm",
    })
  )
);
