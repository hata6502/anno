import { fetchAnnopagesByAnnolink, getAnnolinks } from "scrapbox-loader";

const fetchAnnopageRecord = async ({
  annoProjectName,
  url,
}: {
  annoProjectName: string;
  url: string;
}) => {
  const annopageEntries = await Promise.all(
    getAnnolinks(url).map((annolink) =>
      fetchAnnopagesByAnnolink({
        annoProjectName,
        annolink,
        fetcher: fetch,
      })
    )
  );
  return Object.fromEntries(annopageEntries.flat());
};

console.log(
  await fetchAnnopageRecord({
    annoProjectName: "hata6502",
    url: "https://example.com/",
  })
);
