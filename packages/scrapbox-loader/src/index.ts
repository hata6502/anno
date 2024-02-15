import { TextQuoteSelector } from "text-quote-selector";

export interface Annodata {
  url: string;
  description: string;
  iconURL: string;
  iconWidth: number;
  iconHeight: number;
}

export type Link = Pick<Page, "projectName" | "title">;

export interface Page {
  projectName: string;
  title: string;
  annodataRecord: Record<string, Annodata>;
  configs: {
    textQuoteSelector: TextQuoteSelector;
    markerText: string;
    annotations: { url: string; width: number; height: number }[];
  }[];
}

interface Project {
  name: string;
  image?: string;
}

export const annodataIDPrefix = "annodata-";
export const annoProtocolMap = new Map([
  ["http:", "anno:"],
  ["https:", "annos:"],
]);

const fallbackIconURL =
  "https://i.gyazo.com/1e3dbb79088aa1627d7e092481848df5.png";

export const clearScrapboxLoaderCache = () => {
  iconCache.clear();
  projectCache.clear();
};

export const fetchAnnopagesByAnnolink = async ({
  annoProjectName,
  annolink,
  fetcher,
}: {
  annoProjectName: string;
  annolink: string;
  fetcher: typeof fetch;
}) => {
  const annopageEntries: [string, Page][] = [];

  const annolinkPageResponse = await fetcher(
    `https://scrapbox.io/api/pages/${encodeURIComponent(
      annoProjectName
    )}/${encodeURIComponent(annolink)}`
  );
  if (!annolinkPageResponse.ok) {
    console.error(`Failed to fetch page: ${annolinkPageResponse.status}`);
    return annopageEntries;
  }
  const annolinkPage = await annolinkPageResponse.json();

  const annolinkPageText = annolinkPage.lines
    // @ts-expect-error
    .map(({ text }) => text)
    .join("\n");
  const annopageLinks: Link[] = [
    ...new Set(
      [
        ...annolinkPage.links,
        ...annolinkPage.projectLinks,
        // @ts-expect-error
        ...annolinkPage.relatedPages.links1hop.map(({ title }) => title),
      ].sort(
        (a, b) =>
          annolinkPageText.indexOf(`[${b}]`) -
          annolinkPageText.indexOf(`[${a}]`)
      )
    ),
  ].map((link) => {
    const paths = link.split("/");
    return link.startsWith("/")
      ? { projectName: paths[1], title: paths.slice(2).join("/") }
      : { projectName: annoProjectName, title: link };
  });

  for (const annopageLink of annopageLinks) {
    const annopageEntry = await fetchAnnopage({ annopageLink, fetcher });
    if (!annopageEntry) {
      continue;
    }

    annopageEntries.push(annopageEntry);
  }

  return annopageEntries;
};

export const getAnnolink = (url: string) => {
  let replacedURL = url;
  for (const [protocol, annoProtocol] of annoProtocolMap) {
    if (replacedURL.startsWith(protocol)) {
      replacedURL = replacedURL.replace(protocol, annoProtocol);
    }
  }
  return replacedURL;
};

export const getAnnolinks = (url: string) => {
  const annolinkPaths = getAnnolink(url).split("/");
  const annolinks = [];
  do {
    annolinks.unshift(decodeURI(annolinkPaths.join("/")));
    annolinkPaths.pop();
  } while (annolinkPaths.length >= 2);
  return annolinks;
};

const iconCache = new Map<
  string,
  Promise<
    | {
        url: string;
        width: number;
        height: number;
      }
    | undefined
  >
>();
const projectCache = new Map<string, Promise<Project | undefined>>();

const fetchAnnopage = async ({
  annopageLink,
  fetcher,
}: {
  annopageLink: Link;
  fetcher: typeof fetch;
}): Promise<[string, Page] | undefined> => {
  const annopageProjectPromise =
    projectCache.get(annopageLink.projectName) ??
    (async (): Promise<Project | undefined> => {
      const projectAPIResponse = await fetcher(
        `https://scrapbox.io/api/projects/${encodeURIComponent(
          annopageLink.projectName
        )}`
      );
      if (!projectAPIResponse.ok) {
        console.error(`Failed to fetch project: ${projectAPIResponse.status}`);
        return;
      }
      return projectAPIResponse.json();
    })();
  projectCache.set(annopageLink.projectName, annopageProjectPromise);
  const annopageProject = await annopageProjectPromise;
  if (!annopageProject) {
    return;
  }

  const annopageResponse = await fetcher(
    `https://scrapbox.io/api/pages/${encodeURIComponent(
      annopageProject.name
    )}/${encodeURIComponent(annopageLink.title)}?followRename`
  );
  if (!annopageResponse.ok) {
    console.error(`Failed to fetch page: ${annopageResponse.status}`);
    return;
  }
  const annopage = await annopageResponse.json();

  const sections = [];
  let section = [];
  for (const line of annopage.lines.slice(1)) {
    if (line.text) {
      section.push(line);
    } else {
      sections.push(section);
      section = [];
    }
  }
  sections.push(section);

  const configs = [];
  let annodataRecord: Record<string, Annodata> = {};
  for (const section of sections) {
    const sectionText = section.map(({ text }) => text).join("\n");

    const annotations = [
      ...sectionText.matchAll(/\[([^\]]*)\s(.*?)\]/g),
    ].flatMap((linkExpressionMatch) => {
      let searchParams;
      try {
        searchParams = new URLSearchParams(
          new URL(linkExpressionMatch[2]).hash.slice(1)
        );
      } catch {
        return [];
      }

      const exact = searchParams.get("e");
      if (!exact) {
        return [];
      }

      return [
        {
          body: linkExpressionMatch[0],
          prefix: searchParams.get("p") ?? undefined,
          exact,
          suffix: searchParams.get("s") ?? undefined,
          markerText: linkExpressionMatch[1],
        },
      ];
    });

    const parsedIcons = [];
    for (const iconExpressionMatch of sectionText.matchAll(
      /(\[?)\[([^\]]+)\.icon(?:\*([1-9]\d*))?\](\]?)/g
    )) {
      const title = iconExpressionMatch[2];
      const tower = Number(iconExpressionMatch[3] ?? "1");
      const isStrong = Boolean(
        iconExpressionMatch[1] && iconExpressionMatch[4]
      );

      for (const _towerIndex of Array(tower).keys()) {
        parsedIcons.push({
          url: `https://scrapbox.io/api/pages/${encodeURIComponent(
            annopageProject.name
          )}/${encodeURIComponent(title)}/icon?followRename`,
          isStrong,
        });
      }
    }
    if (parsedIcons.length < 1) {
      parsedIcons.push({
        url: annopageProject.image ?? fallbackIconURL,
        isStrong: false,
      });
    }

    const icons = [];
    for (const { url, isStrong } of parsedIcons) {
      const iconPromise =
        iconCache.get(url) ??
        (async () => {
          // 帯域制限せずにFetch APIを使える
          const iconResponse = await fetch(url);
          if (!iconResponse.ok) {
            console.error(`Failed to fetch icon: ${iconResponse.status}`);
            return;
          }
          const imageBitmap = await createImageBitmap(
            await iconResponse.blob()
          );

          const height = 128;
          const width = (imageBitmap.width / imageBitmap.height) * height;

          const canvas = new OffscreenCanvas(width, height);
          const canvasContext = canvas.getContext("2d");
          if (!canvasContext) {
            throw new Error("Failed to get offscreenCanvas context. ");
          }
          canvasContext.drawImage(imageBitmap, 0, 0, width, height);

          const fileReader = new FileReader();
          const dataURL = await new Promise<string>(async (resolve) => {
            fileReader.addEventListener("load", () => {
              if (typeof fileReader.result !== "string") {
                throw new Error("fileReader result is not string. ");
              }
              resolve(fileReader.result);
            });
            fileReader.readAsDataURL(await canvas.convertToBlob());
          });

          return {
            url: dataURL,
            width,
            height,
          };
        })();
      iconCache.set(url, iconPromise);
      const icon = await iconPromise;
      if (!icon) {
        continue;
      }

      icons.push({ ...icon, isStrong });
    }

    let annotationRemovedText = sectionText;
    for (const { body } of annotations) {
      annotationRemovedText = annotationRemovedText.replaceAll(body, "");
    }
    const annotationRemovedLines = annotationRemovedText.trim().split("\n");
    const description = annotationRemovedLines
      .filter((line) => !line.trim().startsWith(">"))
      .join("\n");

    for (const { prefix, exact, suffix, markerText } of annotations) {
      const newAnnodataRecord: Record<string, Annodata> = {};
      for (const icon of icons) {
        const iconHeight = icon.isStrong ? 56 : 28;
        const iconWidth = (icon.width / icon.height) * iconHeight;
        const annodata = {
          url: `https://scrapbox.io/${encodeURIComponent(
            annopageProject.name
          )}/${encodeURIComponent(annopage.title)}?followRename#${
            section[0].id
          }`,
          description,
          iconURL: icon.url,
          iconWidth,
          iconHeight,
        };

        const id = `${annodataIDPrefix}${[
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify(annodata))
            )
          ),
        ]
          .map((uint8) => uint8.toString(16).padStart(2, "0"))
          .join("")}`;
        newAnnodataRecord[id] = annodata;
      }

      annodataRecord = { ...annodataRecord, ...newAnnodataRecord };

      configs.push({
        textQuoteSelector: { prefix, exact, suffix },
        markerText,
        annotations: Object.entries(newAnnodataRecord).map(
          ([id, annodata]) => ({
            url: `${chrome.runtime.getURL(
              "annotation.html"
            )}?${new URLSearchParams({ id })}`,
            width: annodata.iconWidth,
            height: annodata.iconHeight,
          })
        ),
      });
    }
  }

  return [
    annopage.id,
    {
      projectName: annopageProject.name,
      title: annopage.title,
      annodataRecord,
      configs,
    },
  ];
};
