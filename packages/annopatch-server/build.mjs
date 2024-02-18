import * as esbuild from "esbuild";

await Promise.all(
  [{ entryPoints: ["src/index.ts"], outfile: "dist/index.mjs" }].map(
    (options) =>
      esbuild.build({
        ...options,
        bundle: true,
        platform: "node",
        format: "esm",
      })
  )
);
