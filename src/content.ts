// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";
import { BackgroundMessage } from "./background";
import { TextQuoteSelector, injectByTextQuote } from "./textQuoteInjection";

export type ContentMessage = {
  type: "ready";
  url: string;
};

const pageURL = new URL(location.href);
pageURL.hash = "";
pageURL.search = "";

let cleanUp: (() => void) | undefined;

chrome.runtime.onMessage.addListener((backgroundMessage: BackgroundMessage) => {
  switch (backgroundMessage.type) {
    case "getTextQuoteSelectorfromSelection": {
      const selection = getSelection();
      let link = "";

      if (selection && selection.rangeCount >= 1) {
        const textQuoteSelector: TextQuoteSelector = textQuote.fromRange(
          document.body,
          selection.getRangeAt(0)
        );

        link = `[${
          textQuoteSelector.exact
        } ${pageURL.toString()}#${new URLSearchParams({
          ...(textQuoteSelector.prefix && { p: textQuoteSelector.prefix }),
          e: textQuoteSelector.exact,
          ...(textQuoteSelector.suffix && { s: textQuoteSelector.suffix }),
        }).toString()}]`;
      }

      const body = `${link}
`;

      open(
        `https://scrapbox.io/anno/${encodeURIComponent(
          pageURL.toString()
        )}?${new URLSearchParams({
          ...(body.trim() && { body }),
        }).toString()}`
      );

      return;
    }

    case "inject": {
      cleanUp?.();

      cleanUp = injectByTextQuote(
        backgroundMessage.configs.map(({ textQuoteSelector, url }) => ({
          textQuoteSelector,
          inject: (range: Range) => {
            const linkElement = document.createElement("a");

            linkElement.href = url;
            linkElement.rel = "noopener";
            linkElement.target = "_blank";
            linkElement.textContent = "🍀";
            linkElement.style.all = "revert";
            linkElement.style.textDecoration = "none";

            if (range.endContainer.textContent?.trim()) {
              range.collapse();
              range.insertNode(linkElement);
            } else {
              const treeWalker = document.createTreeWalker(
                range.commonAncestorContainer,
                NodeFilter.SHOW_ALL
              );

              let currentNode: Node | null = treeWalker.currentNode;
              let actualLastTextNode: Text | undefined;

              while (currentNode) {
                if (
                  currentNode instanceof Text &&
                  currentNode.textContent?.trim()
                ) {
                  actualLastTextNode = currentNode;
                }

                if (currentNode === range.endContainer) {
                  actualLastTextNode?.after(linkElement);

                  break;
                }

                currentNode = treeWalker.nextNode();
              }
            }

            return linkElement;
          },
          cleanUp: (linkElement) => {
            if (!(linkElement instanceof HTMLAnchorElement)) {
              throw new Error("invalid linkElement");
            }

            linkElement.remove();
          },
        }))
      );

      return;
    }

    default: {
      const exhaustiveCheck: never = backgroundMessage;

      throw new Error(`Unknown message type: ${exhaustiveCheck}`);
    }
  }
});

const contentMessage: ContentMessage = {
  type: "ready",
  url: pageURL.toString(),
};
chrome.runtime.sendMessage(contentMessage);

addEventListener("load", () => {
  let urlSearchParams;

  try {
    urlSearchParams = new URLSearchParams(location.hash);
  } catch {
    return;
  }

  const exact = urlSearchParams.get("e");
  if (!exact) {
    return;
  }

  const selection = getSelection();
  const range: Range | null = textQuote.toRange(document.body, {
    prefix: urlSearchParams.get("p") ?? undefined,
    exact,
    suffix: urlSearchParams.get("s") ?? undefined,
  });
  if (!selection || !range) {
    return;
  }

  selection.removeAllRanges();
  selection.addRange(range);
});
