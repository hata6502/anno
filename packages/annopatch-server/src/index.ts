import { fetchAnnopages, getAnnolinks } from "scrapbox-loader";

import { HttpFunction } from "@google-cloud/functions-framework";

export const index: HttpFunction = async (req, res) => {
  const { annoProjectName, url } = req.query;
  if (typeof annoProjectName !== "string") {
    res.status(400).send("annoProjectName is required");
    return;
  }
  if (typeof url !== "string") {
    res.status(400).send("url is required");
    return;
  }

  res.json(await fetchPages({ annoProjectName, url }));
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
