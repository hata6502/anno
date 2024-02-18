import { fetchAnnopages, getAnnolinks } from "scrapbox-loader";

import { HttpFunction } from "@google-cloud/functions-framework";

export const index: HttpFunction = async (_req, res) => {
  res.send(
    JSON.stringify(
      await fetchPages({
        annoProjectName: "hata6502",
        url: "https://example.com/",
      }),
      null,
      2
    )
  );
};

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
