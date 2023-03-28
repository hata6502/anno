import PQueue from "p-queue";
import { ContentMessage } from "./content";
import { TextQuoteSelector } from "./textQuoteInjection";
import { initialStorageValues } from "./storage";
import { getAnnoPageTitle } from "./url";

const fallbackIconImageURL =
  "https://i.gyazo.com/1e3dbb79088aa1627d7e092481848df5.png";

export interface Annodata {
  url: string;
  description: string;
  iconImageURL: string;
  iconSize: number;
}

export type BackgroundMessage =
  | {
      type: "annotate";
      annoProjectName: string;
    }
  | {
      type: "inject";
      configs: InjectionConfig[];
    };

interface InjectionConfig {
  textQuoteSelector: TextQuoteSelector;
  annotationURL: string;
  iconSize: number;
}

interface Project {
  name: string;
  image?: string;
}

const fetchQueue = new PQueue({ interval: 1000, intervalCap: 1 });
const queuedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetchQueue.add(() => fetch(input, init), { throwOnTimeout: true });

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== "number") {
    return;
  }

  const { annoProjectName } = await chrome.storage.sync.get(
    initialStorageValues
  );
  if (!annoProjectName) {
    chrome.runtime.openOptionsPage();
    return;
  }

  const backgroundMessage: BackgroundMessage = {
    type: "annotate",
    annoProjectName,
  };
  chrome.tabs.sendMessage(tab.id, backgroundMessage);
});

const cleanUpMap = new Map<number, () => void>();
const cleanUp = ({ tabId }: { tabId: number }) => {
  cleanUpMap.get(tabId)?.();
  cleanUpMap.delete(tabId);
};

const iconImageURLCache = new Map<string, Promise<string | null>>();
const projectCache = new Map<string, Promise<Project | null>>();
const inject = async ({ tabId, url }: { tabId: number; url: string }) => {
  cleanUp({ tabId });

  const annoPageTitle = getAnnoPageTitle(url);

  const watchingProjects = [];
  const { annoProjectName } = await chrome.storage.sync.get(
    initialStorageValues
  );
  for (const projectName of [annoProjectName]) {
    if (!projectName) {
      continue;
    }

    let project = await projectCache.get(projectName);
    if (project === undefined) {
      const projectPromise = (async () => {
        const projectAPIResponse = await queuedFetch(
          `https://scrapbox.io/api/projects/${encodeURIComponent(projectName)}`
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

      projectCache.set(projectName, projectPromise);
      project = await projectPromise;
    }

    if (project) {
      watchingProjects.push(project);
    }
  }

  const annodataMap = new Map<string, Annodata>();
  const configs = [];
  for (const watchingProject of watchingProjects) {
    const scrapboxPageAPIResponse = await queuedFetch(
      `https://scrapbox.io/api/pages/${encodeURIComponent(
        watchingProject.name
      )}/${encodeURIComponent(annoPageTitle)}?followRename=true`
    );
    if (!scrapboxPageAPIResponse.ok) {
      console.error(`Failed to fetch page: ${scrapboxPageAPIResponse.status}`);
      continue;
    }

    const page = await scrapboxPageAPIResponse.json();
    const sections = [];
    let section = [];
    for (const line of page.lines.slice(1)) {
      if (line.text) {
        section.push(line);
      } else {
        sections.push(section);
        section = [];
      }
    }
    sections.push(section);

    for (const section of sections) {
      if (!section.length) {
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

        const icons = [];
        for (const iconExpressionMatch of section[0].text.matchAll(
          /(\[?)\[([^\]]+)\.icon(?:\*([1-9]\d*))?\](\]?)/g
        )) {
          const title = iconExpressionMatch[2];
          const tower = Number(iconExpressionMatch[3] ?? "1");
          const isStrong = Boolean(
            iconExpressionMatch[1] && iconExpressionMatch[4]
          );

          const iconKey = `/${watchingProject.name}/${title}`;
          let url = await iconImageURLCache.get(iconKey);
          if (url === undefined) {
            const iconImageURLPromise = (async () => {
              const iconAPIResponse = await fetch(
                `https://scrapbox.io/api/pages/${encodeURIComponent(
                  watchingProject.name
                )}/${encodeURIComponent(title)}`
              );
              if (!iconAPIResponse.ok) {
                console.error(
                  `Failed to fetch iconAPI: ${iconAPIResponse.status}`
                );
                return null;
              }
              const { image } = await iconAPIResponse.json();

              const iconImageResponse = await fetch(image);
              if (!iconImageResponse.ok) {
                console.error(
                  `Failed to fetch the icon image: ${iconImageResponse.status}`
                );
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
                fileReader.readAsDataURL(await iconImageResponse.blob());
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
            url: watchingProject.image ?? fallbackIconImageURL,
            isStrong: false,
          });
        }

        for (const icon of icons) {
          const id = crypto.randomUUID();
          const iconSize = icon.isStrong ? 60 : 20;

          annodataMap.set(id, {
            url: `https://scrapbox.io/${encodeURIComponent(
              watchingProject.name
            )}/${encodeURIComponent(annoPageTitle)}#${section[0].id}`,
            description: section
              .slice(1)
              .map(({ text }) => text)
              .join("\n"),
            iconImageURL: icon.url,
            iconSize,
          });

          const config: InjectionConfig = {
            textQuoteSelector: {
              prefix: searchParams.get("p") ?? undefined,
              exact,
              suffix: searchParams.get("s") ?? undefined,
            },
            annotationURL: `${chrome.runtime.getURL(
              "annotation.html"
            )}?${new URLSearchParams({ id })}`,
            iconSize,
          };
          configs.push(config);
        }
      }
    }
  }

  await chrome.storage.local.set(Object.fromEntries(annodataMap));

  const backgroundMessage: BackgroundMessage = {
    type: "inject",
    configs,
  };
  chrome.tabs.sendMessage(tabId, backgroundMessage);

  cleanUpMap.set(tabId, async () => {
    await chrome.storage.local.remove([...annodataMap.keys()]);
  });
};

chrome.runtime.onMessage.addListener(
  async (contentMessage: ContentMessage, sender) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      throw new Error("tabId is empty. ");
    }

    switch (contentMessage.type) {
      case "urlChange": {
        await inject({ tabId, url: contentMessage.url });
        break;
      }

      /*default: {
        const exhaustiveCheck: never = contentMessage;
        throw new Error(`Unknown message type: ${exhaustiveCheck}`);
      }*/
    }
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  cleanUp({ tabId });
});
chrome.tabs.onReplaced.addListener((_addedTabId, removedTabId) => {
  cleanUp({ tabId: removedTabId });
});
