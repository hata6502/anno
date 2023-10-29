import * as esbuild from "esbuild";

await Promise.all(
  [
    { entryPoints: ["src/annotation.ts"], outfile: "dist/annotation.js" },
    { entryPoints: ["src/background.ts"], outfile: "dist/background.js" },
    { entryPoints: ["src/content.ts"], outfile: "dist/content.js" },
    { entryPoints: ["src/gyanno.tsx"], outfile: "dist/gyanno.js" },
    { entryPoints: ["src/options.ts"], outfile: "dist/options.js" },
    {
      entryPoints: ["src/scrapboxContent.ts"],
      outfile: "dist/scrapboxContent.js",
    },
    {
      entryPoints: ["src/scrapboxUserScript.ts"],
      outfile: "dist/scrapboxUserScript.js",
    },
  ].map((options) =>
    esbuild.build({
      ...options,
      bundle: true,
      define: {
        "process.env.EXTENSION_ID": process.env.EXTENSION_ID,
      },
      format: "esm",
    })
  )
);
