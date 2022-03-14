import { TextQuoteSelector } from "./textQuoteInjection";
import { initialStorageValues } from "./storage";
import { getAnnoPageTitle, getPageURL } from "./url";

export interface Annodata {
  url: string;
  description: string;
  iconImageURL: string;
}

export type BackgroundMessage =
  | {
      type: "getTextQuoteSelectorfromSelection";
      annoProjectName: string;
    }
  | {
      type: "inject";
      configs: InjectionConfig[];
    };

interface InjectionConfig {
  textQuoteSelector: TextQuoteSelector;
  annotationURL: string;
}

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
    type: "getTextQuoteSelectorfromSelection",
    annoProjectName,
  };
  chrome.tabs.sendMessage(tab.id, backgroundMessage);
});

const projectsAPIResponse = await fetch("https://scrapbox.io/api/projects");
if (!projectsAPIResponse.ok) {
  throw new Error(`Failed to fetch projects: ${projectsAPIResponse.status}`);
}
const { projects } = await projectsAPIResponse.json();
const watchingProjects = await Promise.all(
  [...projects]
    .sort((a, b) => b.updated - a.updated)
    .slice(0, 5)
    .map(async (project) => {
      const projectAPIResponse = await fetch(
        `https://scrapbox.io/api/projects/${encodeURIComponent(project.name)}`
      );
      if (!projectAPIResponse.ok) {
        throw new Error(
          `Failed to fetch project: ${projectAPIResponse.status}`
        );
      }
      return projectAPIResponse.json();
    })
);

const iconImageURLMap = new Map<string, string>();
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }
  const annoPageTitle = getAnnoPageTitle(getPageURL(tab.url));

  const annodataMap = new Map<string, Annodata>();
  const configs: InjectionConfig[] = [];
  await Promise.all(
    watchingProjects.map(async (project) => {
      const scrapboxPageAPIResponse = await fetch(
        `https://scrapbox.io/api/pages/${encodeURIComponent(
          project.name
        )}/${encodeURIComponent(annoPageTitle)}?followRename=true`
      );
      if (!scrapboxPageAPIResponse.ok) {
        throw new Error(
          `Failed to fetch page: ${scrapboxPageAPIResponse.status}`
        );
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

          let iconTowerExtractedLine = section[0].text;
          for (const multiIconExpressionMatch of iconTowerExtractedLine.matchAll(
            /\[([^\[\]]+\.icon)\*([1-9]\d*)\]/g
          )) {
            iconTowerExtractedLine = iconTowerExtractedLine.replace(
              multiIconExpressionMatch[0],
              `[${multiIconExpressionMatch[1]}]`.repeat(
                Math.min(Number(multiIconExpressionMatch[2]), 100)
              )
            );
          }

          const iconImageURLs = [];
          for (const iconExpressionMatch of iconTowerExtractedLine.matchAll(
            /\[([^\[\]]+)\.icon\]/g
          )) {
            const iconTitle = iconExpressionMatch[1];
            let iconImageURL = iconImageURLMap.get(iconTitle);
            if (!iconImageURL) {
              const iconAPIResponse = await fetch(
                `https://scrapbox.io/api/pages/${encodeURIComponent(
                  project.name
                )}/${encodeURIComponent(iconTitle)}`
              );
              if (!iconAPIResponse.ok) {
                throw new Error(
                  `Failed to fetch iconAPI: ${iconAPIResponse.status}`
                );
              }

              const { image } = await iconAPIResponse.json();
              iconImageURLMap.set(iconTitle, image);
              iconImageURL = image as string;
            }

            iconImageURLs.push(iconImageURL);
          }

          if (!iconImageURLs.length) {
            iconImageURLs.push(project.image);
          }

          for (const iconImageURL of iconImageURLs) {
            const id = crypto.randomUUID();

            annodataMap.set(id, {
              url: `https://scrapbox.io/${encodeURIComponent(
                project.name
              )}/${encodeURIComponent(annoPageTitle)}#${section[0].id}`,
              description: section
                .slice(1)
                .map(({ text }) => text)
                .join("\n"),
              iconImageURL,
            });

            const config = {
              textQuoteSelector: {
                prefix: searchParams.get("p") ?? undefined,
                exact,
                suffix: searchParams.get("s") ?? undefined,
              },
              annotationURL: `${chrome.runtime.getURL(
                "annotation.html"
              )}?${new URLSearchParams({ id })}`,
            };
            configs.push(config);
          }
        }
      }
    })
  );

  // @ts-expect-error
  await chrome.storage.session.set(Object.fromEntries(annodataMap));

  const backgroundMessage: BackgroundMessage = {
    type: "inject",
    configs,
  };
  chrome.tabs.sendMessage(tabId, backgroundMessage);
});
