// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";
import { BackgroundMessage, Link } from "./background";
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
let existedAnnolink: Link | undefined;
let prevWindow: Window | null = null;
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

        if (!existedAnnolink) {
          lines.push(`[${getAnnolink(getURL())}]`, "");
        }

        lines.push(
          `> [${textQuoteSelector.exact
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

      const annolink = existedAnnolink ?? { title: document.title };
      prevWindow?.close();
      prevWindow = open(
        `https://scrapbox.io/${encodeURIComponent(
          annolink.projectName ?? backgroundMessage.annoProjectName
        )}/${encodeURIComponent(annolink.title)}?${new URLSearchParams({
          body: lines.join("\n"),
        })}`
      );
      existedAnnolink = annolink;
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
              iframeElement.style.marginLeft = "4px";
              iframeElement.style.marginRight = "4px";

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

              const markElement = document.createElement("mark");
              markElement.style.all = "revert";
              markElement.append(clonedRange.extractContents(), iframeElement);
              clonedRange.insertNode(markElement);

              return markElement;
            },
            cleanUp: (markElement) => {
              if (!(markElement instanceof Element)) {
                throw new Error("invalid element. ");
              }
              // Remove the mark and iframe element.
              markElement.after(...[...markElement.childNodes].slice(0, -1));
              markElement.remove();
            },
          }))
      );

      existedAnnolink = backgroundMessage.existedAnnolink;
      break;
    }

    default: {
      const exhaustiveCheck: never = backgroundMessage;
      throw new Error(`Unknown message type: ${exhaustiveCheck}`);
    }
  }
});

addEventListener("beforeunload", () => {
  prevWindow?.close();
});

let highlighted = false;
const highlight = () => {
  if (highlighted) {
    return;
  }

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

  highlighted = true;
};

let prevURL: string | undefined;
const checkURLChange = () => {
  if (prevURL !== getURL()) {
    highlighted = false;

    const urlChangeMessage: ContentMessage = {
      type: "urlChange",
      url: getURL(),
    };
    chrome.runtime.sendMessage(urlChangeMessage);
  }

  prevURL = getURL();
};
setInterval(() => {
  prevURL = undefined;
  checkURLChange();
}, 60000);

const handleDocumentChange = () => {
  checkURLChange();
  highlight();
};
handleDocumentChange();
const mutationObserver = new MutationObserver(handleDocumentChange);
mutationObserver.observe(document, {
  subtree: true,
  childList: true,
  characterData: true,
});
