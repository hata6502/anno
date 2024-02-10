import PQueue from "p-queue";
import type { ContentMessage, InjectionData, Page } from "./content";
import {
  clearScrapboxLoaderCache,
  annodataIDPrefix,
  fetchAnnopagesByAnnolink,
  getAnnolinks,
} from "./scrapboxLoader";
import { initialStorageValues } from "./storage";

export type BackgroundMessage =
  | { type: "open"; url: string }
  | { type: "urlChange"; url: string; prevInjectionData?: InjectionData };

export type ExternalBackgroundMessage = {
  type: "collaborate";
  projectName: string;
  pageTitle: string;
  annolinks: string[];
};

const fetchQueue = new PQueue({ interval: 5000, intervalCap: 5 });
const queuedFetch: typeof fetch = (input, init) =>
  // @ts-expect-error
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

const annopageEntriesCache = new Map<
  string,
  {
    value: Promise<[string, Page][]>;
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

  const annopageRecord = { ...prevInjectionData?.annopageRecord };
  let collaboratedAnnopage = prevInjectionData?.collaboratedAnnopage;
  await sendInjectionData({
    tabId,
    injectionData: {
      annoProjectName,
      annopageRecord,
      collaboratedAnnopage,
    },
    signal,
  });

  const annolinks = getAnnolinks(url);
  const annopageIDs = [];
  for (const [annolinkIndex, annolink] of annolinks.entries()) {
    const isCollaboratedAnnopage = annolinkIndex === annolinks.length - 1;

    const annopageEntriesKey = JSON.stringify({ annoProjectName, annolink });
    const annopageEntriesMaxAgeMS = isCollaboratedAnnopage ? 0 : 3 * 60 * 1000;
    let annopageEntriesPromise = annopageEntriesCache.get(annopageEntriesKey);
    if (
      !annopageEntriesPromise ||
      new Date().getTime() - annopageEntriesPromise.storedAt.getTime() >=
        annopageEntriesMaxAgeMS
    ) {
      annopageEntriesPromise = {
        value: fetchAnnopagesByAnnolink({
          annoProjectName,
          annolink,
          fetcher: queuedFetch,
        }),
        storedAt: new Date(),
      };
    }
    annopageEntriesCache.set(annopageEntriesKey, annopageEntriesPromise);
    const annopageEntries = await annopageEntriesPromise.value;

    for (const [annopageID, annopage] of annopageEntries) {
      annopageRecord[annopageID] = annopage;
      annopageIDs.push(annopageID);
    }

    if (isCollaboratedAnnopage) {
      collaboratedAnnopage = annopageEntries.at(0)?.[1];
    }

    await sendInjectionData({
      tabId,
      injectionData: {
        annoProjectName,
        annopageRecord,
        collaboratedAnnopage,
      },
      signal,
    });
  }

  for (const annopageID of Object.keys(annopageRecord)) {
    if (annopageIDs.includes(annopageID)) {
      continue;
    }

    delete annopageRecord[annopageID];
  }
  await sendInjectionData({
    tabId,
    injectionData: {
      annoProjectName,
      annopageRecord,
      collaboratedAnnopage,
    },
    signal,
  });
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

  for (const { annodataRecord } of Object.values(
    injectionData.annopageRecord
  )) {
    await chrome.storage.local.set(annodataRecord);
  }

  const injectMessage: ContentMessage = {
    type: "inject",
    injectionData,
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
  annopageEntriesCache.clear();
});

const tryGetTab = async (tabId: number) => {
  try {
    return await chrome.tabs.get(tabId);
  } catch {}
};
