// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";
import { BackgroundMessage } from "./background";
import { TextQuoteSelector, injectByTextQuote } from "./textQuoteInjection";
import { encodeForScrapboxReadableLink, getAnnolink } from "./url";

export type ContentMessage = { type: "urlChange"; url: string };

const getURL = () => {
  const canonicalLinkElement = document.querySelector(
    'link[rel="canonical" i]'
  );
  const url = new URL(
    (canonicalLinkElement instanceof HTMLLinkElement &&
      canonicalLinkElement.href) ||
      location.href
  );

  url.searchParams.delete("p");
  url.searchParams.delete("e");
  url.searchParams.delete("s");
  url.hash = "";

  return String(url);
};

let cleanUp: (() => void) | undefined;
let existedAnnopageTitle: string | undefined;
chrome.runtime.onMessage.addListener((backgroundMessage: BackgroundMessage) => {
  switch (backgroundMessage.type) {
    case "annotate": {
      const selection = getSelection();
      const lines = [];

      if (selection && !selection.isCollapsed && selection.rangeCount >= 1) {
        const textQuoteSelector: TextQuoteSelector = textQuote.fromRange(
          document.body,
          selection.getRangeAt(0)
        );

        if (!existedAnnopageTitle) {
          lines.push(`[${getAnnolink(getURL())}]`, "");
        }

        lines.push(
          `[${textQuoteSelector.exact
            .replaceAll("[", "")
            .replaceAll("]", "")
            .replaceAll("\n", "")} ${getURL()}#${[
            ...(textQuoteSelector.prefix
              ? [`p=${encodeForScrapboxReadableLink(textQuoteSelector.prefix)}`]
              : []),
            `e=${encodeForScrapboxReadableLink(textQuoteSelector.exact)}`,
            ...(textQuoteSelector.suffix
              ? [`s=${encodeForScrapboxReadableLink(textQuoteSelector.suffix)}`]
              : []),
          ].join("&")}]`
        );
      }

      const annopageTitle = existedAnnopageTitle ?? document.title;
      open(
        `https://scrapbox.io/${encodeURIComponent(
          backgroundMessage.annoProjectName
        )}/${encodeURIComponent(annopageTitle)}?${new URLSearchParams({
          body: lines.join("\n"),
        })}`
      );
      existedAnnopageTitle = annopageTitle;
      break;
    }

    case "inject": {
      cleanUp?.();
      cleanUp = injectByTextQuote(
        // Reverse to the icon order.
        [...backgroundMessage.configs]
          .reverse()
          .map(({ textQuoteSelector, annotationURL, iconSize }) => ({
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
              iframeElement.style.width = `${iconSize}px`;
              iframeElement.style.height = `${iconSize}px`;

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

      existedAnnopageTitle = backgroundMessage.existedAnnopageTitle;
      break;
    }

    default: {
      const exhaustiveCheck: never = backgroundMessage;
      throw new Error(`Unknown message type: ${exhaustiveCheck}`);
    }
  }
});

const highlight = () => {
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

let prevURL: string | undefined;
const sendURLChangeMessage = () => {
  if (prevURL !== getURL()) {
    const urlChangeMessage: ContentMessage = {
      type: "urlChange",
      url: getURL(),
    };
    chrome.runtime.sendMessage(urlChangeMessage);
  }

  prevURL = getURL();
};

const handleDocumentChange = () => {
  highlight();
  sendURLChangeMessage();
};
const mutationObserver = new MutationObserver(handleDocumentChange);
mutationObserver.observe(document, {
  subtree: true,
  childList: true,
  characterData: true,
});
handleDocumentChange();
