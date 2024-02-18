import * as esbuild from "esbuild";

await Promise.all(
  [{ entryPoints: ["src/build.ts"], outfile: "dist/build.js" }].map((options) =>
    esbuild.build({
      ...options,
      bundle: true,
      external: ["esbuild"],
      format: "esm",
      platform: "node",
    })
  )
);
