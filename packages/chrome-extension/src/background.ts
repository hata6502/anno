import type { IframeData } from "./annotation";
import type { ContentMessage, InjectionData, InjectionPage } from "./content";
import { initialStorageValues } from "./storage";

import {
  clearScrapboxLoaderCache,
  fetchAnnopages,
  extractAnnolink,
} from "scrapbox-loader";

import PQueue from "p-queue";

export type BackgroundMessage =
  | { type: "open"; url: string }
  | { type: "urlChange"; url: string; prevInjectionData?: InjectionData };

export type ExternalBackgroundMessage = {
  type: "collaborate";
  projectName: string;
  pageTitle: string;
  annolinks: string[];
};

const iframeIDPrefix = "iframe-";

const fetchQueue = new PQueue({ interval: 5000, intervalCap: 5 });
const queuedFetch: typeof fetch = (input, init) =>
  fetchQueue.add(() => fetch(input, init), { throwOnTimeout: true });

const mark = async ({ tabId }: { tabId: number }) => {
  const { annoProjectName } = await chrome.storage.sync.get(
    initialStorageValues
  );
  if (!annoProjectName) {
    chrome.runtime.openOptionsPage();
    return;
  }

  const markMessage: ContentMessage = { type: "mark" };
  chrome.tabs.sendMessage(tabId, markMessage);
};

chrome.action.onClicked.addListener(async (tab) => {
  if (typeof tab.id !== "number") {
    return;
  }
  await mark({ tabId: tab.id });
});

chrome.contextMenus.create({
  id: "mark",
  title: "Mark",
  contexts: ["page", "selection"],
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (typeof tab?.id !== "number") {
    return;
  }

  switch (info.menuItemId) {
    case "mark": {
      await mark({ tabId: tab.id });
      break;
    }
  }
});

const pageEntriesCache = new Map<
  string,
  {
    value: Promise<[string, InjectionPage][]>;
    storedAt: Date;
  }
>();
const abortInjectingControllerMap = new Map<number, AbortController>();
const inject = async ({
  tabId,
  url,
  signal,
  prevInjectionData,
}: {
  tabId: number;
  url: string;
  signal: AbortSignal;
  prevInjectionData?: InjectionData;
}) => {
  const { annoProjectName } = await chrome.storage.sync.get(
    initialStorageValues
  );
  if (!annoProjectName) return;

  const pageRecord = { ...prevInjectionData?.pageRecord };
  let collaboratedPage = prevInjectionData?.collaboratedPage;
  await sendInjectionData({
    tabId,
    injectionData: {
      annoProjectName,
      pageRecord,
      collaboratedPage,
    },
    signal,
  });

  const annolinks = extractAnnolink(url);
  const annopageIDs = [];
  for (const [annolinkIndex, annolink] of annolinks.entries()) {
    const isCollaboratedAnnopage = annolinkIndex === annolinks.length - 1;

    const annopageEntriesKey = JSON.stringify({ annoProjectName, annolink });
    const annopageEntriesMaxAgeMS = isCollaboratedAnnopage ? 0 : 3 * 60 * 1000;
    let pageEntriesPromise = pageEntriesCache.get(annopageEntriesKey);
    if (
      !pageEntriesPromise ||
      new Date().getTime() - pageEntriesPromise.storedAt.getTime() >=
        annopageEntriesMaxAgeMS
    ) {
      pageEntriesPromise = {
        value: fetchPages({
          annoProjectName,
          annolink,
        }),
        storedAt: new Date(),
      };
    }
    pageEntriesCache.set(annopageEntriesKey, pageEntriesPromise);
    const annopageEntries = await pageEntriesPromise.value;

    for (const [annopageID, annopage] of annopageEntries) {
      pageRecord[annopageID] = annopage;
      annopageIDs.push(annopageID);
    }

    if (isCollaboratedAnnopage) {
      collaboratedPage = annopageEntries.at(0)?.[1];
    }

    await sendInjectionData({
      tabId,
      injectionData: {
        annoProjectName,
        pageRecord,
        collaboratedPage,
      },
      signal,
    });
  }

  for (const annopageID of Object.keys(pageRecord)) {
    if (annopageIDs.includes(annopageID)) {
      continue;
    }

    delete pageRecord[annopageID];
  }
  await sendInjectionData({
    tabId,
    injectionData: {
      annoProjectName,
      pageRecord,
      collaboratedPage,
    },
    signal,
  });
};

const fetchPages = async ({
  annoProjectName,
  annolink,
}: {
  annoProjectName: string;
  annolink: string;
}) => {
  const annopageEntries = await fetchAnnopages({
    annoProjectName,
    annolink,
    fetcher: queuedFetch,
  });

  return Promise.all(
    annopageEntries.map(
      async ([annopageID, annopage]): Promise<[string, InjectionPage]> => {
        const configs = await Promise.all(
          annopage.configs.map(async (config) => {
            const icons = [];
            for (const { url, isStrong } of config.icons) {
              const iconPromise = iconCache.get(url) ?? fetchIcon(url);
              iconCache.set(url, iconPromise);

              const icon = await iconPromise;
              if (!icon) {
                continue;
              }
              icons.push({ ...icon, isStrong });
            }

            const iframes = [];
            for (const icon of icons) {
              const height = icon.isStrong ? 56 : 28;
              const width = (icon.width / icon.height) * height;
              const iframeData: IframeData = {
                url: `https://scrapbox.io/${encodeURIComponent(
                  annopage.projectName
                )}/${encodeURIComponent(annopage.title)}?followRename#${
                  config.lineID
                }`,
                description: config.description,
                iconURL: icon.url,
                iconWidth: width,
                iconHeight: height,
              };

              const id = `${iframeIDPrefix}${[
                ...new Uint8Array(
                  await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(JSON.stringify(iframeData))
                  )
                ),
              ]
                .map((uint8) => uint8.toString(16).padStart(2, "0"))
                .join("")}`;
              await chrome.storage.local.set({ [id]: iframeData });
              iframes.push({
                url: `${chrome.runtime.getURL(
                  "annotation.html"
                )}?${new URLSearchParams({ id })}`,
                width,
                height,
              });
            }

            return { ...config, iframes };
          })
        );

        return [annopageID, { ...annopage, configs }];
      }
    )
  );
};

const iconCache = new Map<
  string,
  Promise<{ url: string; width: number; height: number } | undefined>
>();
const fetchIcon = async (url: string) => {
  // 帯域制限せずにFetch APIを使える
  const iconResponse = await fetch(url);
  if (!iconResponse.ok) {
    console.error(`Failed to fetch icon: ${iconResponse.status}`);
    return;
  }
  const imageBitmap = await createImageBitmap(await iconResponse.blob());

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

  return { url: dataURL, width, height };
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

  const injectMessage: ContentMessage = { type: "inject", injectionData };
  chrome.tabs.sendMessage(tabId, injectMessage);
};

chrome.runtime.onStartup.addListener(async () => {
  const iconKeys = Object.keys(await chrome.storage.local.get(null)).filter(
    (key) => key.startsWith(iframeIDPrefix)
  );
  await chrome.storage.local.remove(iconKeys);
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
          prevInjectionData: backgroundMessage.prevInjectionData,
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

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  const isReloading = changeInfo.status === "loading" && !changeInfo.url;
  if (!isReloading) {
    return;
  }

  clearScrapboxLoaderCache();
  iconCache.clear();
  pageEntriesCache.clear();
});

const tryGetTab = async (tabId: number) => {
  try {
    return await chrome.tabs.get(tabId);
  } catch {}
};
