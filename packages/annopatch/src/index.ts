import { fetchAnnopages, getAnnolinks } from "scrapbox-loader";

const fetchPages = async ({
  annoProjectName,
  url,
}: {
  annoProjectName: string;
  url: string;
}) => {
  const annopageEntries = await Promise.all(
    getAnnolinks(url).map((annolink) =>
      fetchAnnopages({ annoProjectName, annolink, fetcher: fetch })
    )
  );
  return annopageEntries.flat().flatMap(([, annopage]) => annopage);
};

console.log(
  JSON.stringify(
    await fetchPages({
      annoProjectName: "hata6502",
      url: "https://example.com/",
    }),
    null,
    2
  )
);
