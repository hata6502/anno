import { ContentMessage } from "./content";
import { TextQuoteSelector } from "./textQuoteInjection";

type InjectionConfig = {
  textQuoteSelector: TextQuoteSelector;
  url: string;
  description: string;
  iconImageURLs: string[];
};

export type BackgroundMessage =
  | {
      type: "getTextQuoteSelectorfromSelection";
    }
  | {
      type: "inject";
      configs: InjectionConfig[];
    };

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== "number") {
    return;
  }

  const backgroundMessage: BackgroundMessage = {
    type: "getTextQuoteSelectorfromSelection",
  };

  chrome.tabs.sendMessage(tab.id, backgroundMessage);
});

const projectAPIResponse = await fetch("https://scrapbox.io/api/projects/anno");
if (!projectAPIResponse.ok) {
  throw new Error(`Failed to fetch project: ${projectAPIResponse.status}`);
}
const { image: projectImageURL } = await projectAPIResponse.json();

const iconImageURLMap = new Map<string, string>();
chrome.runtime.onMessage.addListener(
  async (contentMessage: ContentMessage, sender) => {
    switch (contentMessage.type) {
      case "ready": {
        if (typeof sender.tab?.id !== "number") {
          return;
        }

        // TODO: cookie
        const scrapboxPageAPIResponse = await fetch(
          `https://scrapbox.io/api/pages/anno/${encodeURIComponent(
            contentMessage.url
          )}`
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

        const configs = [];
        for (const section of sections) {
          if (!section.length) {
            continue;
          }

          for (const urlMatch of section[0].text.matchAll(/\[.*?\s(.*?)\]/g)) {
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
                  Number(multiIconExpressionMatch[2])
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
                  `https://scrapbox.io/api/pages/anno/${encodeURIComponent(
                    iconTitle
                  )}`
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
              iconImageURLs.push(projectImageURL);
            }

            const config: InjectionConfig = {
              textQuoteSelector: {
                prefix: searchParams.get("p") ?? undefined,
                exact,
                suffix: searchParams.get("s") ?? undefined,
              },
              url: `https://scrapbox.io/anno/${encodeURIComponent(
                contentMessage.url
              )}#${section[0].id}`,
              // TODO: convert to plain text?
              description: section
                .slice(1)
                .map(({ text }) => text)
                .join("\n"),
              iconImageURLs,
            };
            configs.push(config);
          }
        }

        const backgroundMessage: BackgroundMessage = {
          type: "inject",
          configs,
        };
        chrome.tabs.sendMessage(sender.tab.id, backgroundMessage);
      }

      /*default: {
        const exhaustiveCheck: never = contentMessage;

        throw new Error(`Unknown message type: ${exhaustiveCheck}`);
      }*/
    }
  }
);
