import type { BackgroundMessage, Link } from "./background";
import { injectByTextQuote } from "./textQuoteInjection";
import {
  TextQuoteSelector,
  getTextIndex,
  getTextRange,
  quoteText,
  textQuoteSelectorAll,
} from "text-quote-selector";
import { encodeForScrapboxReadableLink, getAnnolink } from "./url";

export type ContentMessage =
  | { type: "annotate"; annoProjectName: string }
  | {
      type: "inject";
      configs: InjectionConfig[];
      collaboratedAnnopageLink?: Link;
    };

export interface InjectionConfig {
  textQuoteSelector: TextQuoteSelector;
  annotations: { url: string; width: number; height: number }[];
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

let collaboratedAnnopageLink: Link | undefined;
chrome.runtime.onMessage.addListener(async (contentMessage: ContentMessage) => {
  switch (contentMessage.type) {
    case "annotate": {
      const lines = [];

      const title = document.title || new Date().toLocaleString();

      const selection = getSelection();
      const isSelected =
        selection && !selection.isCollapsed && selection.rangeCount >= 1;

      if (!collaboratedAnnopageLink) {
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

        lines.push(`[${decodeURI(getAnnolink(getURL()))}]`);

        if (isSelected) {
          lines.push("");
        }
      }

      if (isSelected) {
        const textQuoteSelector = quoteText(
          getTextIndex(document.body),
          selection.getRangeAt(0)
        );

        lines.push(
          `[🍀 ${getURL()}#${[
            `e=${encodeForScrapboxReadableLink(textQuoteSelector.exact)}`,
            ...(textQuoteSelector.prefix
              ? [`p=${encodeForScrapboxReadableLink(textQuoteSelector.prefix)}`]
              : []),
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
      const annopageLink = collaboratedAnnopageLink ?? {
        projectName: contentMessage.annoProjectName,
        title,
      };
      const openMessage: BackgroundMessage = {
        type: "open",
        url: `https://scrapbox.io/${encodeURIComponent(
          annopageLink.projectName
        )}/${encodeURIComponent(annopageLink.title)}?${new URLSearchParams({
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
          inject: (range) => {
            const textRange = getTextRange(range);
            const splittedStartTextNode = textRange.start.textNode.splitText(
              textRange.start.offset
            );
            const end =
              textRange.start.textNode === textRange.end.textNode
                ? {
                    textNode: splittedStartTextNode,
                    offset: textRange.end.offset - textRange.start.offset,
                  }
                : textRange.end;
            end.textNode.splitText(end.offset);

            const splittedRange = new Range();
            splittedRange.setStart(splittedStartTextNode, 0);
            splittedRange.setEnd(end.textNode, end.offset);

            const textNodes = [];
            const nodeIterator = document.createNodeIterator(
              splittedRange.commonAncestorContainer,
              NodeFilter.SHOW_TEXT
            );
            let currentNode;
            let isInRange = false;
            while ((currentNode = nodeIterator.nextNode())) {
              if (currentNode === splittedRange.startContainer) {
                isInRange = true;
              }

              if (isInRange && currentNode instanceof Text) {
                textNodes.push(currentNode);
              }

              if (currentNode === splittedRange.endContainer) {
                break;
              }
            }

            const markElements = textNodes.flatMap((textNode) => {
              if (!textNode.textContent?.trim()) {
                return [];
              }

              const markElement = document.createElement("mark");
              markElement.style.all = "revert";
              markElement.style.background = "rgba(91, 165, 111, 0.5)";
              textNode.after(markElement);
              markElement.append(textNode);
              return [markElement];
            });

            const iframeElements = config.annotations.map(
              ({ url, width, height }) => {
                const iframeElement = document.createElement("iframe");

                iframeElement.src = url;
                iframeElement.sandbox.add(
                  "allow-popups",
                  "allow-popups-to-escape-sandbox",
                  "allow-scripts"
                );

                iframeElement.style.all = "revert";
                iframeElement.style.width = `${width}px`;
                iframeElement.style.height = `${height}px`;
                iframeElement.style.marginTop = `${-height}px`;
                iframeElement.style.border = "none";
                iframeElement.style.verticalAlign = "text-bottom";

                return iframeElement;
              }
            );
            markElements.at(-1)?.after(...iframeElements);

            let ancestorElement =
              splittedRange.commonAncestorContainer instanceof Element
                ? splittedRange.commonAncestorContainer
                : splittedRange.commonAncestorContainer.parentElement;
            while (ancestorElement) {
              if (!ancestorElement.scrollTop) {
                ancestorElement.scrollTop = 1;
              }
              if (
                ancestorElement.scrollTop &&
                ancestorElement.scrollHeight > ancestorElement.clientHeight &&
                getComputedStyle(ancestorElement).overflowY !== "hidden"
              ) {
                break;
              }

              ancestorElement = ancestorElement.parentElement;
            }
            const scrollableAncestorElement =
              ancestorElement ?? document.documentElement;

            const barmapWidth = 16;
            const barmapElement = document.createElement("button");
            barmapElement.style.all = "unset";
            barmapElement.style.position = "fixed";
            barmapElement.style.width = `${barmapWidth}px`;
            barmapElement.style.borderTop = `8px solid transparent`;
            barmapElement.style.borderBottom = `8px solid transparent`;
            barmapElement.style.background = "rgba(91, 165, 111, 0.5)";
            barmapElement.style.backgroundClip = "padding-box";
            barmapElement.style.cursor = "pointer";
            barmapElement.style.zIndex = "2147483647";

            barmapElement.addEventListener("click", () => {
              markElements.at(0)?.scrollIntoView({ block: "center" });
            });

            document.body.append(barmapElement);

            const handleScroll = () => {
              const elements = [...markElements, ...iframeElements];

              const isVisible = elements.some(
                (element) => element.offsetParent
              );

              const scrollableAncestorDOMRect =
                scrollableAncestorElement === document.documentElement
                  ? new DOMRect()
                  : scrollableAncestorElement.getBoundingClientRect();
              const domRects = elements.map((element) =>
                element.getBoundingClientRect()
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

              barmapElement.style.display = isVisible ? "block" : "none";
              barmapElement.style.left = `${
                scrollableAncestorDOMRect.left +
                scrollableAncestorElement.clientWidth -
                barmapWidth
              }px`;
              barmapElement.style.top = `${
                scrollableAncestorDOMRect.top + clientTop - 8
              }px`;
              barmapElement.style.height = `${Math.max(
                clientBottom - clientTop,
                4
              )}px`;
            };
            handleScroll();
            addEventListener("scroll", handleScroll, true);

            const nextRange = new Range();
            const firstTextNode = textNodes.at(0);
            if (firstTextNode) {
              nextRange.setStart(firstTextNode, 0);
            }
            const lastTextNode = textNodes.at(-1);
            if (lastTextNode) {
              nextRange.setEnd(
                lastTextNode,
                lastTextNode.textContent?.length ?? 0
              );
            }

            return {
              range: nextRange,
              cleanUp: () => {
                removeEventListener("scroll", handleScroll, true);

                for (const markElement of markElements) {
                  markElement.after(...markElement.childNodes);
                  markElement.remove();
                }

                for (const iframeElement of iframeElements) {
                  iframeElement.remove();
                }

                barmapElement.remove();
              },
            };
          },
        }))
      );

      collaboratedAnnopageLink = contentMessage.collaboratedAnnopageLink;
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
    triedSearchParams = new URLSearchParams(location.hash.slice(1));
  } catch {
    return;
  }
  const searchParams = triedSearchParams;
  const exact = searchParams.get("e");
  if (!exact) {
    return;
  }

  const selection = getSelection();
  const range = textQuoteSelectorAll(getTextIndex(document.body), {
    exact,
    prefix: searchParams.get("p") ?? undefined,
    suffix: searchParams.get("s") ?? undefined,
  }).at(0)?.range;
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
  if (!navigator.userActivation.isActive) {
    return;
  }

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
