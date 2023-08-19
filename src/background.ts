import PQueue from "p-queue";
import type { ContentMessage, InjectionConfig } from "./content";
import { initialStorageValues } from "./storage";
import { getAnnolink } from "./url";

const annodataIDPrefix = "annodata-";
const fallbackIconURL =
  "https://i.gyazo.com/1e3dbb79088aa1627d7e092481848df5.png";

export type BackgroundMessage =
  | { type: "open"; url: string }
  | { type: "urlChange"; url: string };

export type ExternalBackgroundMessage = {
  type: "collaborate";
  projectName: string;
  pageTitle: string;
  annolinks: string[];
};

export interface Annodata {
  url: string;
  description: string;
  iconURL: string;
  iconWidth: number;
  iconHeight: number;
}

export interface Link {
  projectName: string;
  title: string;
}

interface Annopage {
  projectName: string;
  title: string;
  annodataMap: Map<string, Annodata>;
  configs: InjectionConfig[];
}

interface InjectionData {
  annopageMap: Map<string, Annopage>;
  collaboratedAnnopageLink?: Link;
}

interface Project {
  name: string;
  image?: string;
}

const fetchQueue = new PQueue({ interval: 5000, intervalCap: 5 });
const queuedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetchQueue.add(() => fetch(input, init), { throwOnTimeout: true });

const mark = async ({
  tabId,
  annopageTitle,
  head,
  includesPrefix,
  includesSuffix,
}: {
  tabId: number;
  annopageTitle?: string;
  head?: string;
  includesPrefix: boolean;
  includesSuffix: boolean;
}) => {
  const { annoProjectName } = await chrome.storage.local.get(
    initialStorageValues
  );
  if (!annoProjectName) {
    chrome.runtime.openOptionsPage();
    return;
  }

  const markMessage: ContentMessage = {
    type: "mark",
    annoProjectName,
    annopageTitle,
    head,
    includesPrefix,
    includesSuffix,
  };
  chrome.tabs.sendMessage(tabId, markMessage);
};

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== "number") {
    return;
  }
  await mark({ tabId: tab.id, includesPrefix: true, includesSuffix: true });
});

chrome.contextMenus.create({
  id: "mark",
  title: "Mark",
  contexts: ["page", "selection"],
});
chrome.contextMenus.create({
  id: "markWord",
  title: "Mark as a word",
  contexts: ["page", "selection"],
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (typeof tab?.id !== "number") {
    return;
  }

  switch (info.menuItemId) {
    case "mark": {
      await mark({
        tabId: tab.id,
        includesPrefix: true,
        includesSuffix: true,
      });
      break;
    }

    case "markWord": {
      await mark({
        tabId: tab.id,
        annopageTitle: "Marked words",
        head: "[annos:/]",
        includesPrefix: false,
        includesSuffix: false,
      });
      break;
    }
  }
});

const annopageEntriesCache = new Map<
  string,
  {
    value: Promise<[string, Annopage][]>;
    storedAt: Date;
  }
>();
const prevInjectionDataMap = new Map<number, InjectionData>();
const abortInjectingControllerMap = new Map<number, AbortController>();
const inject = async ({
  tabId,
  url,
  signal,
}: {
  tabId: number;
  url: string;
  signal: AbortSignal;
}) => {
  const prevInjectionData = prevInjectionDataMap.get(tabId);
  const annopageMap = new Map(prevInjectionData?.annopageMap);
  let collaboratedAnnopageLink = prevInjectionData?.collaboratedAnnopageLink;
  await sendInjectionData({
    tabId,
    injectionData: { annopageMap, collaboratedAnnopageLink },
    signal,
  });

  const { annoProjectName } = await chrome.storage.local.get(
    initialStorageValues
  );
  if (!annoProjectName) {
    return;
  }

  const annolinkPaths = getAnnolink(url).split("/");
  const annolinks = [];
  do {
    annolinks.push(decodeURI(annolinkPaths.join("/")));
    annolinkPaths.pop();
  } while (annolinkPaths.length >= 2);

  const annopageIDs = [];
  for (const [annolinkIndex, annolink] of annolinks.entries()) {
    const annopageEntriesKey = JSON.stringify({ annoProjectName, annolink });
    const annopageEntriesMaxAgeMS = annolinkIndex ? 3 * 60 * 1000 : 0;
    let annopageEntriesPromise = annopageEntriesCache.get(annopageEntriesKey);
    if (
      !annopageEntriesPromise ||
      new Date().getTime() - annopageEntriesPromise.storedAt.getTime() >=
        annopageEntriesMaxAgeMS
    ) {
      annopageEntriesPromise = {
        value: fetchAnnopagesByAnnolink({ annoProjectName, annolink }),
        storedAt: new Date(),
      };
    }
    annopageEntriesCache.set(annopageEntriesKey, annopageEntriesPromise);
    const annopageEntries = await annopageEntriesPromise.value;

    for (const [annopageID, annopage] of annopageEntries) {
      annopageMap.set(annopageID, annopage);
      annopageIDs.push(annopageID);
    }

    const firstAnnopageEntries = annopageEntries.at(0);
    if (!annolinkIndex && firstAnnopageEntries) {
      const [, firstAnnopage] = firstAnnopageEntries;
      collaboratedAnnopageLink = firstAnnopage;
    }

    await sendInjectionData({
      tabId,
      injectionData: { annopageMap, collaboratedAnnopageLink },
      signal,
    });
  }

  for (const [annopageID] of annopageMap) {
    if (annopageIDs.includes(annopageID)) {
      continue;
    }

    annopageMap.delete(annopageID);
  }
  await sendInjectionData({
    tabId,
    injectionData: { annopageMap, collaboratedAnnopageLink },
    signal,
  });

  prevInjectionDataMap.set(tabId, { annopageMap, collaboratedAnnopageLink });
};

const fetchAnnopagesByAnnolink = async ({
  annoProjectName,
  annolink,
}: {
  annoProjectName: string;
  annolink: string;
}) => {
  const annopageEntries: [string, Annopage][] = [];

  const annolinkPageResponse = await queuedFetch(
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
    const annopageEntry = await fetchAnnopage({ annopageLink });
    if (!annopageEntry) {
      continue;
    }

    annopageEntries.push(annopageEntry);
  }

  return annopageEntries;
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
}: {
  annopageLink: Link;
}): Promise<[string, Annopage] | undefined> => {
  const annopageProjectPromise =
    projectCache.get(annopageLink.projectName) ??
    (async (): Promise<Project | undefined> => {
      const projectAPIResponse = await queuedFetch(
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

  const annopageResponse = await queuedFetch(
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
  let annodataMap = new Map();
  for (const section of sections) {
    const sectionText = section.map(({ text }) => text).join("\n");

    const annotations = [...sectionText.matchAll(/\[[^\]]*\s(.*?)\]/g)].flatMap(
      (linkExpressionMatch) => {
        let searchParams;
        try {
          searchParams = new URLSearchParams(
            new URL(linkExpressionMatch[1]).hash.slice(1)
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
          },
        ];
      }
    );

    let description = sectionText;
    for (const { body } of annotations) {
      description = description.replaceAll(body, "");
    }

    const parsedIcons = [];
    for (const iconExpressionMatch of description.matchAll(
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

    for (const { prefix, exact, suffix } of annotations) {
      const newAnnodataEntries: [string, Annodata][] = [];
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
        newAnnodataEntries.push([id, annodata]);
      }

      annodataMap = new Map([...annodataMap, ...newAnnodataEntries]);

      configs.push({
        textQuoteSelector: { prefix, exact, suffix },
        annotations: newAnnodataEntries.map(([id, annodata]) => ({
          url: `${chrome.runtime.getURL(
            "annotation.html"
          )}?${new URLSearchParams({ id })}`,
          width: annodata.iconWidth,
          height: annodata.iconHeight,
        })),
      });
    }
  }

  return [
    annopage.id,
    {
      projectName: annopageProject.name,
      title: annopage.title,
      annodataMap,
      configs,
    },
  ];
};

const sendInjectionData = async ({
  tabId,
  injectionData,
  signal,
}: {
  tabId: number;
  injectionData: InjectionData;
  signal: AbortSignal;
}) => {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const { annopageMap, collaboratedAnnopageLink } = injectionData;

  await chrome.storage.local.set(
    Object.fromEntries(
      [...annopageMap].flatMap(([, { annodataMap }]) => [...annodataMap])
    )
  );

  const injectMessage: ContentMessage = {
    type: "inject",
    configs: [...annopageMap].flatMap(([, { configs }]) => configs),
    collaboratedAnnopageLink,
  };
  chrome.tabs.sendMessage(tabId, injectMessage);
};

chrome.runtime.onStartup.addListener(async () => {
  const annodataKeys = Object.keys(await chrome.storage.local.get(null)).filter(
    (key) => key.startsWith(annodataIDPrefix)
  );
  await chrome.storage.local.remove(annodataKeys);
});

let annoTabId: number | undefined;
chrome.runtime.onMessage.addListener(
  async (backgroundMessage: BackgroundMessage, sender) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      throw new Error("tabId is empty. ");
    }

    switch (backgroundMessage.type) {
      case "open": {
        const annoTab = annoTabId && (await tryGetTab(annoTabId));
        if (annoTab && annoTab.id) {
          await chrome.tabs.update(annoTab.id, {
            active: true,
            url: backgroundMessage.url,
          });
          await chrome.windows.update(annoTab.windowId, { focused: true });
        } else {
          const window = await chrome.windows.create({
            type: "popup",
            url: backgroundMessage.url,
          });
          annoTabId = window.tabs?.at(0)?.id;
        }
        break;
      }

      case "urlChange": {
        abortInjectingControllerMap.get(tabId)?.abort();

        const abortInjectingController = new AbortController();
        abortInjectingControllerMap.set(tabId, abortInjectingController);
        await inject({
          tabId,
          url: backgroundMessage.url,
          signal: abortInjectingController.signal,
        });
        break;
      }

      default: {
        const exhaustiveCheck: never = backgroundMessage;
        throw new Error(`Unknown message type: ${exhaustiveCheck}`);
      }
    }
  }
);

chrome.runtime.onMessageExternal.addListener(
  async (externalBackgroundMessage: ExternalBackgroundMessage) => {
    const { annoProjectName } = await chrome.storage.local.get(
      initialStorageValues
    );
    if (!annoProjectName) {
      chrome.runtime.openOptionsPage();
      return;
    }

    switch (externalBackgroundMessage.type) {
      case "collaborate": {
        const body = `[/${externalBackgroundMessage.projectName}/${externalBackgroundMessage.pageTitle}]`;

        for (const annolink of externalBackgroundMessage.annolinks) {
          await chrome.tabs.create({
            url: `https://scrapbox.io/${encodeURIComponent(
              annoProjectName
            )}/${encodeURIComponent(annolink)}?${new URLSearchParams({
              body,
            })}`,
          });
        }

        break;
      }

      default: {
        const exhaustiveCheck: never = externalBackgroundMessage.type;
        throw new Error(`Unknown message type: ${exhaustiveCheck}`);
      }
    }
  }
);

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  const isReloading = changeInfo.status === "loading" && !changeInfo.url;
  if (!isReloading) {
    return;
  }

  iconCache.clear();
  projectCache.clear();
  annopageEntriesCache.clear();
});

const tryGetTab = async (tabId: number) => {
  try {
    return await chrome.tabs.get(tabId);
  } catch {}
};
