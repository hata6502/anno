// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";
import { BackgroundMessage } from "./background";
import { TextQuoteSelector, injectByTextQuote } from "./textQuoteInjection";
import {
  encodeForScrapboxReadableLink,
  getAnnoPageTitle,
  getPageURL,
} from "./url";

export type ContentMessage = { type: "load" };

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

        link = `[${textQuoteSelector.exact} ${location.href}#${[
          ...(textQuoteSelector.prefix
            ? [`p=${encodeForScrapboxReadableLink(textQuoteSelector.prefix)}`]
            : []),
          `e=${encodeForScrapboxReadableLink(textQuoteSelector.exact)}`,
          ...(textQuoteSelector.suffix
            ? [`s=${encodeForScrapboxReadableLink(textQuoteSelector.suffix)}`]
            : []),
        ].join("&")}]`;
      }

      const body = `${link}`;

      open(
        `https://scrapbox.io/${encodeURIComponent(
          backgroundMessage.annoProjectName
        )}/${encodeURIComponent(
          getAnnoPageTitle(getPageURL(location.href))
        )}?${new URLSearchParams({
          ...(body.trim() && { body }),
        }).toString()}`
      );
      break;
    }

    case "inject": {
      cleanUp?.();
      cleanUp = injectByTextQuote(
        // Reverse to the icon order.
        [...backgroundMessage.configs]
          .reverse()
          .map(({ textQuoteSelector, annotationURL }) => ({
            textQuoteSelector,
            inject: (range: Range) => {
              const iframeElement = document.createElement("iframe");
              iframeElement.src = annotationURL;
              iframeElement.sandbox.add(
                "allow-popups",
                "allow-popups-to-escape-sandbox",
                "allow-scripts"
              );
              iframeElement.style.all = "revert";
              iframeElement.style.border = "none";
              iframeElement.style.width = "20px";
              iframeElement.style.height = "20px";

              const clonedRange = range.cloneRange();
              if (clonedRange.endOffset === 0) {
                const nodeIterator = document.createNodeIterator(
                  clonedRange.commonAncestorContainer,
                  NodeFilter.SHOW_TEXT
                );

                let prevNode;
                let currentNode;
                while ((currentNode = nodeIterator.nextNode())) {
                  if (prevNode && currentNode === clonedRange.endContainer) {
                    clonedRange.setEndAfter(prevNode);
                    break;
                  }

                  prevNode = currentNode;
                }
              }

              clonedRange.collapse();
              clonedRange.insertNode(iframeElement);

              return iframeElement;
            },
            cleanUp: (iframeElement) => {
              if (!(iframeElement instanceof Element)) {
                throw new Error("invalid element. ");
              }
              iframeElement.remove();
            },
          }))
      );
      break;
    }

    default: {
      const exhaustiveCheck: never = backgroundMessage;
      throw new Error(`Unknown message type: ${exhaustiveCheck}`);
    }
  }
});

(() => {
  let triedSearchParams;
  try {
    triedSearchParams = new URLSearchParams(location.hash);
  } catch {
    return;
  }
  const searchParams = triedSearchParams;
  const exact = searchParams.get("e");
  if (!exact) {
    return;
  }

  const highlight = () => {
    const selection = getSelection();
    const range: Range | null = textQuote.toRange(document.body, {
      prefix: searchParams.get("p") ?? undefined,
      exact,
      suffix: searchParams.get("s") ?? undefined,
    });
    if (!selection || !range) {
      return;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    const startElement =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    startElement?.scrollIntoView({ block: "center" });

    mutationObserver.disconnect();
  };

  const mutationObserver = new MutationObserver(highlight);
  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  highlight();
})();

const loadMessage: ContentMessage = { type: "load" };
chrome.runtime.sendMessage(loadMessage);
