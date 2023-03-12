import { ContentMessage } from "./content";
import { TextQuoteSelector } from "./textQuoteInjection";

type InjectionConfig = {
  textQuoteSelector: TextQuoteSelector;
  url: string;
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

        const backgroundMessage: BackgroundMessage = {
          type: "inject",
          // @ts-expect-error
          configs: page.lines.flatMap((line) =>
            [...line.text.matchAll(/\[.*?\s(.*?)\]/g)].flatMap(
              (match): [InjectionConfig] | [] => {
                try {
                  const urlSearchParams = new URLSearchParams(
                    new URL(match[1]).hash
                  );
                  const exact = urlSearchParams.get("anno_e");

                  return exact
                    ? [
                        {
                          textQuoteSelector: {
                            prefix: urlSearchParams.get("anno_p") ?? undefined,
                            exact,
                            suffix: urlSearchParams.get("anno_s") ?? undefined,
                          },
                          // TODO: settings
                          url: `https://scrapbox.io/anno/${encodeURIComponent(
                            contentMessage.url
                          )}#${line.id}`,
                        },
                      ]
                    : [];
                } catch {
                  return [];
                }
              }
            )
          ),
        };

        chrome.tabs.sendMessage(sender.tab.id, backgroundMessage);

        return;
      }

      /*default: {
        const exhaustiveCheck: never = contentMessage;

        throw new Error(`Unknown message type: ${exhaustiveCheck}`);
      }*/
    }
  }
);
