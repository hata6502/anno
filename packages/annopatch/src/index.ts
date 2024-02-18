import { extractAnnolink, fetchAnnopages, isAnnolink } from "scrapbox-loader";

/*const fetchPages = async ({
  annoProjectName,
  url,
}: {
  annoProjectName: string;
  url: string;
}) => {
  const annopageEntries = await Promise.all(
    extractAnnolink(url).map((annolink) =>
    )
  );
};*/

const annoProjectName = "hata6502";

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

const annopages = new Map();
for (const [annolinkIndex, annolink] of annolinks.entries()) {
  console.log(annolinkIndex + 1, annolink);

  const annopageEntries = await fetchAnnopages({
    annoProjectName,
    annolink,
    fetcher: fetch,
  });
  annopages.set(
    annolink,
    annopageEntries.map(([, annopage]) => annopage)
  );
}
console.log(JSON.stringify(Object.fromEntries(annopages)));
