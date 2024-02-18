import { diffChars } from "diff";
import { TextQuoteSelector } from "text-quote-selector";

export type Annolink = Pick<Annopage, "projectName" | "title">;

export interface Annopage {
  projectName: string;
  title: string;
  configs: {
    textQuoteSelector: TextQuoteSelector;
    markerText: string;
    lineID: string;
    description: string;
    icons: {
      url: string;
      isStrong: boolean;
    }[];
  }[];
}

interface Project {
  name: string;
  image?: string;
}

const annoProtocolMap = new Map([
  ["http:", "anno:"],
  ["https:", "annos:"],
]);
const fallbackIconURL =
  "https://i.gyazo.com/1e3dbb79088aa1627d7e092481848df5.png";

export const clearScrapboxLoaderCache = () => {
  projectCache.clear();
};

export const extractAnnolink = (url: string) => {
  const annolinkPaths = getAnnolink(url).split("/");
  const annolinks = [];
  do {
    annolinks.unshift(decodeURI(annolinkPaths.join("/")));
    annolinkPaths.pop();
  } while (annolinkPaths.length >= 2);
  return annolinks;
};

export const fetchAnnopages = async ({
  annoProjectName,
  annolink,
  fetcher,
}: {
  annoProjectName: string;
  annolink: string;
  fetcher: typeof fetch;
}) => {
  const annopageEntries: [string, Annopage][] = [];

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
  const annopageLinks: Annolink[] = [
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

export const isAnnolink = (url: string) =>
  [...annoProtocolMap].some(([, annoProtocol]) => url.startsWith(annoProtocol));

const projectCache = new Map<string, Promise<Project | undefined>>();

const fetchAnnopage = async ({
  annopageLink,
  fetcher,
}: {
  annopageLink: Annolink;
  fetcher: typeof fetch;
}): Promise<[string, Annopage] | undefined> => {
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

    let annotationRemovedText = sectionText;
    for (const { body } of annotations) {
      annotationRemovedText = annotationRemovedText.replaceAll(body, "");
    }
    const annotationRemovedLines = annotationRemovedText.trim().split("\n");
    const mod = annotationRemovedLines
      .flatMap((line) => {
        const match = line.match(/^\s*>(.*)/);
        return match ? [match[1].trim()] : [];
      })
      .join("\n");
    const description = annotationRemovedLines
      .filter((line) => !line.trim().startsWith(">"))
      .join("\n");

    const icons = [];
    for (const iconExpressionMatch of sectionText.matchAll(
      /(\[?)\[([^\]]+)\.icon(?:\*([1-9]\d*))?\](\]?)/g
    )) {
      const title = iconExpressionMatch[2];
      const tower = Number(iconExpressionMatch[3] ?? "1");
      const isStrong = Boolean(
        iconExpressionMatch[1] && iconExpressionMatch[4]
      );

      for (const _towerIndex of Array(tower).keys()) {
        icons.push({
          url: `https://scrapbox.io/api/pages/${encodeURIComponent(
            annopageProject.name
          )}/${encodeURIComponent(title)}/icon?followRename`,
          isStrong,
        });
      }
    }
    if (icons.length < 1) {
      icons.push({
        url: annopageProject.image ?? fallbackIconURL,
        isStrong: false,
      });
    }

    for (const { prefix, exact, suffix, markerText } of annotations) {
      configs.push({
        textQuoteSelector: { prefix, exact, suffix },
        diff: diffChars(exact, mod),
        markerText,
        lineID: section[0].id,
        description,
        icons,
      });
    }
  }

  return [
    annopage.id,
    {
      projectName: annopageProject.name,
      title: annopage.title,
      configs,
    },
  ];
};
