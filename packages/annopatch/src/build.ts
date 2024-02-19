import { fetchAnnopages, isAnnolink } from "scrapbox-loader";

import * as esbuild from "esbuild";

const annoProjectName = process.env.ANNO_PROJECT_NAME;
if (!annoProjectName || !/^[0-9a-zA-Z][0-9a-zA-Z\-]*$/.test(annoProjectName)) {
  throw new Error("Invalid ANNO_PROJECT_NAME");
}

const annopageResponse = await fetch(
  `https://scrapbox.io/api/pages/${encodeURIComponent(
    annoProjectName
  )}/annopage`
);
if (!annopageResponse.ok) {
  throw new Error(`Failed to fetch annopage: ${annopageResponse.status}`);
}
const annopage = await annopageResponse.json();
const annolinks = [
  ...new Set(annopage.relatedPages.links1hop.flatMap(({ linksLc }) => linksLc)),
].filter(isAnnolink);
console.log("Number of annolinks: ", annolinks.length);

const annopageEntries = [];
for (const [annolinkIndex, annolink] of annolinks.entries()) {
  console.log(annolinkIndex + 1, annolink);

  const annopages = await fetchAnnopages({
    annoProjectName,
    annolink,
    fetcher: fetch,
  });
  annopageEntries.push([annolink, annopages.map(([, annopage]) => annopage)]);
}
const annopages = JSON.stringify(Object.fromEntries(annopageEntries));

await Promise.all(
  [
    { entryPoints: ["src/index.ts"], outfile: `dist/${annoProjectName}.js` },
  ].map((options) =>
    esbuild.build({
      ...options,
      bundle: true,
      define: { ANNOPAGES: JSON.stringify(annopages) }
    })
  )
);
