// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";
import type { BackgroundMessage, Link } from "./background";
import { TextQuoteSelector, injectByTextQuote } from "./textQuoteInjection";
import { encodeForScrapboxReadableLink, getAnnolink } from "./url";

export type ContentMessage =
  | { type: "annotate"; annoProjectName: string }
  | {
      type: "inject";
      configs: InjectionConfig[];
      existedAnnolink?: Link;
    };

export interface InjectionConfig {
  textQuoteSelector: TextQuoteSelector;
  annotations: { url: string; size: number }[];
}

const getURL = () => {
  const canonicalLinkElement = document.querySelector(
    'link[rel="canonical" i]'
  );
  const url = new URL(
    (canonicalLinkElement instanceof HTMLLinkElement &&
      canonicalLinkElement.href) ||
      location.href
  );
  url.hash = "";
  return String(url);
};

let existedAnnolink: Link | undefined;
chrome.runtime.onMessage.addListener(async (contentMessage: ContentMessage) => {
  switch (contentMessage.type) {
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

        lines.push(`[${getAnnolink(getURL())}]`);

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
          `[🍀 ${getURL()}#${[
            ...(textQuoteSelector.prefix
              ? [`p=${encodeForScrapboxReadableLink(textQuoteSelector.prefix)}`]
              : []),
            `e=${encodeForScrapboxReadableLink(textQuoteSelector.exact)}`,
            ...(textQuoteSelector.suffix
              ? [`s=${encodeForScrapboxReadableLink(textQuoteSelector.suffix)}`]
              : []),
          ].join("&")}]`
        );
        lines.push(
          ...textQuoteSelector.exact
            .trim()
            .replaceAll(/^ +/gm, "")
            .replaceAll(/\n{2,}/g, "\n")
            .split("\n")
            .map((line) => `> ${line}`)
        );
      }
      const annolink = existedAnnolink ?? {
        projectName: contentMessage.annoProjectName,
        title,
      };
      const openMessage: BackgroundMessage = {
        type: "open",
        url: `https://scrapbox.io/${encodeURIComponent(
          annolink.projectName
        )}/${encodeURIComponent(annolink.title)}?${new URLSearchParams({
          body: lines.join("\n"),
          followRename: "true",
        })}`,
      };
      chrome.runtime.sendMessage(openMessage);

      await new Promise((resolve) => setTimeout(resolve, 5000));
      prevURL = undefined;
      checkURLChange();
      break;
    }

    case "inject": {
      injectByTextQuote(
        contentMessage.configs.map((config) => ({
          id: JSON.stringify(config),
          textQuoteSelector: config.textQuoteSelector,
          inject: (range: Range) => {
            const textNodes = [];
            const clonedRange = range.cloneRange();

            if (clonedRange.startContainer instanceof Text) {
              clonedRange.setStart(
                clonedRange.startContainer.splitText(clonedRange.startOffset),
                0
              );
              textNodes.push(clonedRange.startContainer);
            }

            const nodeIterator = document.createNodeIterator(
              clonedRange.commonAncestorContainer,
              NodeFilter.SHOW_ALL
            );
            let currentNode;
            let isInRange = false;
            while ((currentNode = nodeIterator.nextNode())) {
              if (currentNode === clonedRange.endContainer) {
                break;
              }

              if (isInRange && currentNode instanceof Text) {
                textNodes.push(currentNode);
              }

              if (currentNode === clonedRange.startContainer) {
                isInRange = true;
              }
            }

            if (clonedRange.endContainer instanceof Text) {
              clonedRange.endContainer.splitText(clonedRange.endOffset);
              textNodes.push(clonedRange.endContainer);
            }

            const markElements = textNodes.flatMap((textNode) => {
              if (!textNode.textContent?.trim()) {
                return [];
              }

              const markElement = document.createElement("mark");
              markElement.style.all = "revert";
              textNode.after(markElement);
              markElement.append(textNode);
              return [markElement];
            });

            const iframeElements = config.annotations.map(({ url, size }) => {
              const iframeElement = document.createElement("iframe");

              iframeElement.src = url;
              iframeElement.sandbox.add(
                "allow-popups",
                "allow-popups-to-escape-sandbox",
                "allow-scripts"
              );

              iframeElement.style.all = "revert";
              iframeElement.style.border = "none";
              iframeElement.style.verticalAlign = "text-bottom";
              iframeElement.style.width = `${size}px`;
              iframeElement.style.height = `${size}px`;

              return iframeElement;
            });
            markElements.at(-1)?.after(...iframeElements);

            let ancestorElement =
              clonedRange.commonAncestorContainer instanceof Element
                ? clonedRange.commonAncestorContainer
                : clonedRange.commonAncestorContainer.parentElement;
            while (ancestorElement) {
              if (!ancestorElement.scrollTop) {
                ancestorElement.scrollTop = 1;
              }
              if (ancestorElement.scrollTop) {
                break;
              }

              ancestorElement = ancestorElement.parentElement;
            }
            const scrollableAncestorElement =
              ancestorElement ?? document.documentElement;

            const barmapWidth = 16;
            const barmapElement = document.createElement("div");
            barmapElement.style.all = "revert";
            barmapElement.style.position = "fixed";
            barmapElement.style.width = `${barmapWidth}px`;
            barmapElement.style.background = "rgba(91, 165, 111, 0.5)";
            barmapElement.style.pointerEvents = "none";
            barmapElement.style.zIndex = "2147483647";
            document.body.append(barmapElement);

            const handleScroll = () => {
              const scrollableAncestorDOMRect =
                scrollableAncestorElement === document.documentElement
                  ? new DOMRect()
                  : scrollableAncestorElement.getBoundingClientRect();
              const domRects = [...markElements, ...iframeElements].map(
                (element) => element.getBoundingClientRect()
              );

              const top = Math.min(...domRects.map((domRect) => domRect.top));
              const bottom = Math.max(
                ...domRects.map((domRect) => domRect.bottom)
              );

              const clientTop =
                ((scrollableAncestorElement.scrollTop +
                  (top - scrollableAncestorDOMRect.top)) /
                  scrollableAncestorElement.scrollHeight) *
                scrollableAncestorElement.clientHeight;
              const clientBottom =
                ((scrollableAncestorElement.scrollTop +
                  (bottom - scrollableAncestorDOMRect.top)) /
                  scrollableAncestorElement.scrollHeight) *
                scrollableAncestorElement.clientHeight;

              barmapElement.style.left = `${
                scrollableAncestorDOMRect.left +
                scrollableAncestorElement.clientWidth -
                barmapWidth
              }px`;
              barmapElement.style.top = `${
                scrollableAncestorDOMRect.top + clientTop
              }px`;
              barmapElement.style.height = `${Math.max(
                clientBottom - clientTop,
                4
              )}px`;
            };
            handleScroll();
            addEventListener("scroll", handleScroll, true);

            return () => {
              for (const markElement of markElements) {
                markElement.after(...markElement.childNodes);
                markElement.remove();
              }

              for (const iframeElement of iframeElements) {
                iframeElement.remove();
              }

              barmapElement.remove();
              removeEventListener("scroll", handleScroll, true);
            };
          },
        }))
      );

      existedAnnolink = contentMessage.existedAnnolink;
      break;
    }

    default: {
      const exhaustiveCheck: never = contentMessage;
      throw new Error(`Unknown contentMessage type: ${exhaustiveCheck}`);
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

  const hashRemovedURL = new URL(location.href);
  hashRemovedURL.hash = "";
  history.replaceState(null, "", hashRemovedURL);
};

let prevURL: string | undefined;
const checkURLChange = () => {
  if (prevURL !== getURL()) {
    const urlChangeMessage: BackgroundMessage = {
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
}, 30000);

const handleDocumentChange = () => {
  checkURLChange();
  highlight();
};
const mutationObserver = new MutationObserver(handleDocumentChange);
handleDocumentChange();
mutationObserver.observe(document, {
  subtree: true,
  childList: true,
  characterData: true,
});
