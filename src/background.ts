import PQueue from "p-queue";
import { ContentMessage, InjectionConfig } from "./content";
import { initialStorageValues } from "./storage";
import { getAnnolink } from "./url";

const fallbackIconImageURL =
  "https://i.gyazo.com/1e3dbb79088aa1627d7e092481848df5.png";

export type BackgroundMessage =
  | { type: "open"; url: string }
  | { type: "urlChange"; url: string };

export interface Annodata {
  url: string;
  description: string;
  iconImageURL: string;
  iconSize: number;
}

export interface Link {
  projectName?: string;
  title: string;
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

const cleanUpMap = new Map<number, () => void>();
const cleanUp = ({ tabId }: { tabId: number }) => {
  cleanUpMap.get(tabId)?.();
  cleanUpMap.delete(tabId);
};

const getAnnolinkOrder = ({
  annolink,
  referencingLinks,
}: {
  annolink: Link;
  referencingLinks: string[];
}) => {
  const index = referencingLinks.indexOf(
    `${annolink.projectName ? `/${annolink.projectName}/` : ""}${
      annolink.title
    }`
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const iconImageURLCache = new Map<string, Promise<string | null>>();
const projectCache = new Map<string, Promise<Project | null>>();
const fetchAnnodata = async ({ annolink }: { annolink: string }) => {
  let annodataMap = new Map<string, Annodata>();
  const configs: InjectionConfig[] = [];

  const { annoProjectName } = await chrome.storage.sync.get(
    initialStorageValues
  );
  if (!annoProjectName) {
    return { annodataMap, configs };
  }

  const annolinkResponse = await queuedFetch(
    `https://scrapbox.io/api/pages/${encodeURIComponent(
      annoProjectName
    )}/${encodeURIComponent(annolink)}`
  );
  if (!annolinkResponse.ok) {
    console.error(`Failed to fetch page: ${annolinkResponse.status}`);
    return { annodataMap, configs };
  }
  const annolinkPage = await annolinkResponse.json();

  const referencingLinks = [
    ...annolinkPage.lines
      // @ts-expect-error
      .map(({ text }) => text)
      .join("\n")
      .matchAll(/\[(.*?)\]/g),
  ].map((linkMatch) => linkMatch[1]);
  const annolinks: Link[] = [
    ...annolinkPage.relatedPages.links1hop,
    ...annolinkPage.relatedPages.projectLinks1hop,
  ].sort(
    (a, b) =>
      getAnnolinkOrder({ annolink: a, referencingLinks }) -
      getAnnolinkOrder({ annolink: b, referencingLinks })
  );
  const existedAnnolink = annolinks.at(0);

  for (const annolink of annolinks) {
    const annopageProjectName = annolink.projectName ?? annoProjectName;
    let annopageProject = await projectCache.get(annopageProjectName);
    if (annopageProject === undefined) {
      const projectPromise = (async () => {
        const projectAPIResponse = await queuedFetch(
          `https://scrapbox.io/api/projects/${encodeURIComponent(
            annopageProjectName
          )}`
        );
        if (!projectAPIResponse.ok) {
          console.error(
            `Failed to fetch project: ${projectAPIResponse.status}`
          );
          return null;
        }
        const project = await projectAPIResponse.json();
        return project as Project;
      })();

      projectCache.set(annopageProjectName, projectPromise);
      annopageProject = await projectPromise;
    }
    if (!annopageProject) {
      continue;
    }

    const annopageResponse = await queuedFetch(
      `https://scrapbox.io/api/pages/${encodeURIComponent(
        annopageProject.name
      )}/${encodeURIComponent(annolink.title)}?followRename`
    );
    if (!annopageResponse.ok) {
      console.error(`Failed to fetch page: ${annopageResponse.status}`);
      continue;
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

    for (const section of sections) {
      if (section.length < 1) {
        continue;
      }

      for (const urlMatch of section[0].text.matchAll(/\[[^\]]*\s(.*?)\]/g)) {
        let searchParams;
        try {
          searchParams = new URLSearchParams(new URL(urlMatch[1]).hash);
        } catch {
          continue;
        }

        const exact = searchParams.get("e");
        if (!exact) {
          continue;
        }

        const description = section
          .slice(1)
          .flatMap(({ text }) => (/^\s*>/.test(text) ? [] : [text]))
          .join("\n");

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

        const newAnnodataMap = new Map<string, Annodata>();
        for (const icon of icons) {
          const id = crypto.randomUUID();
          const iconSize = icon.isStrong ? 60 : 20;

          newAnnodataMap.set(id, {
            url: `https://scrapbox.io/${encodeURIComponent(
              annopageProject.name
            )}/${encodeURIComponent(annopage.title)}#${section[0].id}`,
            description,
            iconImageURL: icon.url,
            iconSize,
          });
        }

        annodataMap = new Map([...annodataMap, ...newAnnodataMap]);

        configs.push({
          textQuoteSelector: {
            prefix: searchParams.get("p") ?? undefined,
            exact,
            suffix: searchParams.get("s") ?? undefined,
          },
          annotations: [...newAnnodataMap].map(([id, annodata]) => ({
            url: `${chrome.runtime.getURL(
              "annotation.html"
            )}?${new URLSearchParams({ id })}`,
            size: annodata.iconSize,
          })),
        });
      }
    }
  }

  return { annodataMap, configs, existedAnnolink };
};

const inject = async ({ tabId, url }: { tabId: number; url: string }) => {
  cleanUp({ tabId });

  const { annodataMap, configs, existedAnnolink } = await fetchAnnodata({
    annolink: getAnnolink(url),
  });

  await chrome.storage.local.set(Object.fromEntries(annodataMap));
  const injectMessage: ContentMessage = {
    type: "inject",
    configs,
    existedAnnolink,
  };
  chrome.tabs.sendMessage(tabId, injectMessage);

  cleanUpMap.set(tabId, async () => {
    await chrome.storage.local.remove([...annodataMap.keys()]);
  });
};

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

chrome.tabs.onRemoved.addListener((tabId) => {
  cleanUp({ tabId });
});
chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  cleanUp({ tabId: removedTabId });
});

const tryGetTab = async (tabId: number) => {
  try {
    return await chrome.tabs.get(tabId);
  } catch {}
};
