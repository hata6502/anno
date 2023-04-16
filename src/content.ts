// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";
import { BackgroundMessage, Link } from "./background";
import { TextQuoteSelector, injectByTextQuote } from "./textQuoteInjection";
import { encodeForScrapboxReadableLink, getAnnolink } from "./url";

export type ContentMessage =
  | { type: "open"; url: string }
  | { type: "urlChange"; url: string };

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

let cleanUpInjections: (() => void) | undefined;
let existedAnnolink: Link | undefined;
chrome.runtime.onMessage.addListener(
  async (backgroundMessage: BackgroundMessage) => {
    switch (backgroundMessage.type) {
      case "annotate": {
        const lines = [];

        const title = document.title || new Date().toLocaleString();

        const selection = getSelection();
        const isSelected =
          selection && !selection.isCollapsed && selection.rangeCount >= 1;

        if (!existedAnnolink) {
          lines.push(`[${title} ${getURL()}]`);

          const ogImageElement = window.document.querySelector(
            'meta[property="og:image" i]'
          );
          const ogImageURL =
            ogImageElement instanceof window.HTMLMetaElement &&
            ogImageElement.content;
          if (ogImageURL) {
            lines.push(`[${ogImageURL}#.png]`);
          }

          const descriptionElement = window.document.querySelector(
            'meta[name="description" i]'
          );
          const ogDescriptionElement = window.document.querySelector(
            'meta[property="og:description" i]'
          );
          const description =
            (ogDescriptionElement instanceof window.HTMLMetaElement &&
              ogDescriptionElement.content) ||
            (descriptionElement instanceof window.HTMLMetaElement &&
              descriptionElement.content);
          if (description) {
            lines.push(...description.split("\n").map((line) => `> ${line}`));
          }

          const keywordsElement = window.document.querySelector(
            'meta[name="keywords" i]'
          );
          const keywords =
            keywordsElement instanceof window.HTMLMetaElement &&
            keywordsElement.content;
          if (keywords) {
            lines.push(keywords);
          }

          lines.push("", `[${getAnnolink(getURL())}]`);

          if (isSelected) {
            lines.push("");
          }
        }

        if (isSelected) {
          const textQuoteSelector: TextQuoteSelector = textQuote.fromRange(
            document.body,
            selection.getRangeAt(0)
          );

          lines.push(
            `[${textQuoteSelector.exact
              .replaceAll("[", "")
              .replaceAll("]", "")
              .replaceAll("\n", "")} ${getURL()}#${[
              ...(textQuoteSelector.prefix
                ? [
                    `p=${encodeForScrapboxReadableLink(
                      textQuoteSelector.prefix
                    )}`,
                  ]
                : []),
              `e=${encodeForScrapboxReadableLink(textQuoteSelector.exact)}`,
              ...(textQuoteSelector.suffix
                ? [
                    `s=${encodeForScrapboxReadableLink(
                      textQuoteSelector.suffix
                    )}`,
                  ]
                : []),
            ].join("&")}]`
          );
        }

        const annolink = existedAnnolink ?? { title };
        const openMessage: ContentMessage = {
          type: "open",
          url: `https://scrapbox.io/${encodeURIComponent(
            annolink.projectName ?? backgroundMessage.annoProjectName
          )}/${encodeURIComponent(annolink.title)}?${new URLSearchParams({
            body: lines.join("\n"),
          })}`,
        };
        chrome.runtime.sendMessage(openMessage);

        await new Promise((resolve) => setTimeout(resolve, 5000));
        prevURL = undefined;
        checkURLChange();
        break;
      }

      case "inject": {
        cleanUpInjections?.();
        cleanUpInjections = injectByTextQuote(
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
                markElement.append(
                  clonedRange.extractContents(),
                  iframeElement
                );
                clonedRange.insertNode(markElement);

                return () => {
                  // Remove the mark and iframe element.
                  markElement.after(
                    ...[...markElement.childNodes].slice(0, -1)
                  );
                  markElement.remove();
                };
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
  }
);

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

  const hashRemovedURL = new URL(location.href);
  hashRemovedURL.hash = "";
  history.replaceState(null, "", hashRemovedURL);
};

let prevURL: string | undefined;
const checkURLChange = () => {
  if (prevURL !== getURL()) {
    cleanUpInjections?.();
    cleanUpInjections = undefined;

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
