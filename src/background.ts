import PQueue from "p-queue";
import type { ContentMessage, InjectionConfig } from "./content";
import { initialStorageValues } from "./storage";
import { getAnnolink } from "./url";

const fallbackIconImageURL =
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
  iconImageURL: string;
  iconSize: number;
}

export interface Link {
  projectName: string;
  title: string;
}

interface Annopage {
  annodataMap: Map<string, Annodata>;
  configs: InjectionConfig[];
}

interface Project {
  name: string;
  image?: string;
}

const fetchQueue = new PQueue({ interval: 5000, intervalCap: 5 });
const queuedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetchQueue.add(() => fetch(input, init), { throwOnTimeout: true });

const annotate = async ({ tabId }: { tabId: number }) => {
  const { annoProjectName } = await chrome.storage.sync.get(
    initialStorageValues
  );
  if (!annoProjectName) {
    chrome.runtime.openOptionsPage();
    return;
  }

  const annotateMessage: ContentMessage = {
    type: "annotate",
    annoProjectName,
  };
  chrome.tabs.sendMessage(tabId, annotateMessage);
};

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== "number") {
    return;
  }
  await annotate({ tabId: tab.id });
});

chrome.contextMenus.create({
  id: "annotate",
  title: "Annotate",
  contexts: ["page", "selection"],
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "annotate" || typeof tab?.id !== "number") {
    return;
  }
  await annotate({ tabId: tab.id });
});

const iconImageURLCache = new Map<string, Promise<string | null>>();
const projectCache = new Map<string, Promise<Project | null>>();
const inject = async ({ tabId, url }: { tabId: number; url: string }) => {
  const annopageMap = new Map<string, Annopage>();
  let existedAnnolink;

  const { annoProjectName } = await chrome.storage.sync.get(
    initialStorageValues
  );
  if (!annoProjectName) {
    await sendAnnopage({
      tabId,
      annopageMap,
      existedAnnolink,
    });
    return;
  }

  const annolinkPaths = getAnnolink(url).split("/");
  const annolinks = [];
  do {
    annolinks.push(decodeURI(annolinkPaths.join("/")));
  } while (annolinkPaths.pop());

  await sendAnnopage({
    tabId,
    annopageMap,
    existedAnnolink,
  });
  for (const [annolinkIndex, annolink] of annolinks.entries()) {
    const annolinkPageResponse = await queuedFetch(
      `https://scrapbox.io/api/pages/${encodeURIComponent(
        annoProjectName
      )}/${encodeURIComponent(annolink)}`
    );
    if (!annolinkPageResponse.ok) {
      console.error(`Failed to fetch page: ${annolinkPageResponse.status}`);

      await sendAnnopage({
        tabId,
        annopageMap,
        existedAnnolink,
      });
      continue;
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
    if (!annolinkIndex) {
      existedAnnolink = annopageLinks.at(0);
    }

    for (const annopageLink of annopageLinks) {
      const annopageEntry = await fetchAnnopage({ annopageLink });
      if (!annopageEntry) {
        continue;
      }

      const [annopageID, annopage] = annopageEntry;
      annopageMap.set(annopageID, annopage);
      await sendAnnopage({
        tabId,
        annopageMap,
        existedAnnolink,
      });
    }
  }
};

const fetchAnnopage = async ({
  annopageLink,
}: {
  annopageLink: Link;
}): Promise<[string, Annopage] | undefined> => {
  let annopageProject = await projectCache.get(annopageLink.projectName);
  if (annopageProject === undefined) {
    const projectPromise = (async () => {
      const projectAPIResponse = await queuedFetch(
        `https://scrapbox.io/api/projects/${encodeURIComponent(
          annopageLink.projectName
        )}`
      );
      if (!projectAPIResponse.ok) {
        console.error(`Failed to fetch project: ${projectAPIResponse.status}`);
        return null;
      }
      const project = await projectAPIResponse.json();
      return project as Project;
    })();

    projectCache.set(annopageLink.projectName, projectPromise);
    annopageProject = await projectPromise;
  }
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

    const icons = [];
    for (const iconExpressionMatch of description.matchAll(
      /(\[?)\[([^\]]+)\.icon(?:\*([1-9]\d*))?\](\]?)/g
    )) {
      const title = iconExpressionMatch[2];
      const tower = Number(iconExpressionMatch[3] ?? "1");
      const isStrong = Boolean(
        iconExpressionMatch[1] && iconExpressionMatch[4]
      );

      const iconKey = `/${annopageProject.name}/${title}`;
      let url = await iconImageURLCache.get(iconKey);
      if (url === undefined) {
        const iconImageURLPromise = (async () => {
          const iconResponse = await fetch(
            `https://scrapbox.io/api/pages/${encodeURIComponent(
              annopageProject.name
            )}/${encodeURIComponent(title)}/icon?followRename`
          );
          if (!iconResponse.ok) {
            console.error(`Failed to fetch icon: ${iconResponse.status}`);
            return null;
          }

          const fileReader = new FileReader();
          return new Promise<string>(async (resolve) => {
            fileReader.addEventListener("load", () => {
              if (typeof fileReader.result !== "string") {
                throw new Error("fileReader result is not string. ");
              }
              resolve(fileReader.result);
            });
            fileReader.readAsDataURL(await iconResponse.blob());
          });
        })();

        iconImageURLCache.set(iconKey, iconImageURLPromise);
        url = await iconImageURLPromise;
      }

      if (url) {
        for (const _towerIndex of Array(tower).keys()) {
          icons.push({ url, isStrong });
        }
      }
    }
    if (!icons.length) {
      icons.push({
        url: annopageProject.image ?? fallbackIconImageURL,
        isStrong: false,
      });
    }

    for (const { prefix, exact, suffix } of annotations) {
      const newAnnodataMap = new Map<string, Annodata>();
      for (const icon of icons) {
        const annodata = {
          url: `https://scrapbox.io/${encodeURIComponent(
            annopageProject.name
          )}/${encodeURIComponent(annopage.title)}?followRename#${
            section[0].id
          }`,
          description,
          iconImageURL: icon.url,
          iconSize: icon.isStrong ? 60 : 20,
        };

        const id = [
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify(annodata))
            )
          ),
        ]
          .map((uint8) => uint8.toString(16).padStart(2, "0"))
          .join("");

        newAnnodataMap.set(id, annodata);
      }

      annodataMap = new Map([...annodataMap, ...newAnnodataMap]);

      configs.push({
        textQuoteSelector: { prefix, exact, suffix },
        annotations: [...newAnnodataMap].map(([id, annodata]) => ({
          url: `${chrome.runtime.getURL(
            "annotation.html"
          )}?${new URLSearchParams({ id })}`,
          size: annodata.iconSize,
        })),
      });
    }
  }

  return [annopage.id, { annodataMap, configs }];
};

const sendAnnopage = async ({
  tabId,
  annopageMap,
  existedAnnolink,
}: {
  tabId: number;
  annopageMap: Map<string, Annopage>;
  existedAnnolink?: Link;
}) => {
  await chrome.storage.local.set(
    Object.fromEntries(
      [...annopageMap].flatMap(([, { annodataMap }]) => [...annodataMap])
    )
  );

  const injectMessage: ContentMessage = {
    type: "inject",
    configs: [...annopageMap].flatMap(([, { configs }]) => configs),
    existedAnnolink,
  };
  chrome.tabs.sendMessage(tabId, injectMessage);
};

chrome.runtime.onStartup.addListener(async () => {
  // Clear annodata.
  await chrome.storage.local.clear();
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
        await inject({ tabId, url: backgroundMessage.url });
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
    const { annoProjectName } = await chrome.storage.sync.get(
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

const tryGetTab = async (tabId: number) => {
  try {
    return await chrome.tabs.get(tabId);
  } catch {}
};
