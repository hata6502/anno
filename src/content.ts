import type { BackgroundMessage } from "./background";
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
  | {
      type: "mark";
      annoProjectName: string;
    }
  | {
      type: "markWord";
      annoProjectName: string;
    }
  | {
      type: "inject";
      injectionData: InjectionData;
    };

export interface InjectionData {
  annopageRecord: Record<string, Annopage>;
  collaboratedAnnopageLink?: Link;
  markedWordsPageLink?: Link;
}

export interface Annopage {
  projectName: string;
  title: string;
  annodataRecord: Record<string, Annodata>;
  configs: {
    textQuoteSelector: TextQuoteSelector;
    annotations: { url: string; width: number; height: number }[];
  }[];
}

export interface Annodata {
  url: string;
  description: string;
  iconURL: string;
  iconWidth: number;
  iconHeight: number;
}

export interface Link {
  projectName: string;
  title: string;
}

const styleElement = document.createElement("style");
styleElement.textContent = `
  .anno {
    &.barmap {
      all: unset;
      position: fixed;
      width: 16px;
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      background: rgb(91, 165, 111, 0.5);
      background-clip: padding-box;
      cursor: pointer;
      z-index: 2147483647;
    }

    &.icon {
      all: revert;
      border: none;
      vertical-align: text-bottom;
    }

    &.marker {
      all: revert;
    }
  }
`;
document.head.append(styleElement);

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

const write = async ({
  annopageLink,
  headerLines,
  includesPrefix,
  includesSuffix,
}: {
  annopageLink: Link;
  headerLines: string[];
  includesPrefix: boolean;
  includesSuffix: boolean;
}) => {
  const lines = [...headerLines];

  const selection = getSelection();
  const isSelected =
    selection && !selection.isCollapsed && selection.rangeCount >= 1;
  if (isSelected) {
    const textQuoteSelector = quoteText(
      getTextIndex(document.body),
      selection.getRangeAt(0)
    );

    lines.push(
      `[🍀 ${getURL()}#${[
        `e=${encodeForScrapboxReadableLink(textQuoteSelector.exact)}`,
        ...(includesPrefix && textQuoteSelector.prefix
          ? [`p=${encodeForScrapboxReadableLink(textQuoteSelector.prefix)}`]
          : []),
        ...(includesSuffix && textQuoteSelector.suffix
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
  handleDocumentChange();
};

let prevInjectionData: InjectionData | undefined;
chrome.runtime.onMessage.addListener(async (contentMessage: ContentMessage) => {
  switch (contentMessage.type) {
    case "mark": {
      const title = document.title || new Date().toLocaleString();

      const headerLines = [];
      if (!prevInjectionData?.collaboratedAnnopageLink) {
        headerLines.push(`[${title} ${getURL()}]`);

        const ogImageElement = window.document.querySelector(
          'meta[property="og:image" i]'
        );
        const ogImageURL =
          ogImageElement instanceof window.HTMLMetaElement &&
          ogImageElement.content;
        if (ogImageURL) {
          headerLines.push(`[${ogImageURL}#.png]`);
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
          headerLines.push(
            ...description.split("\n").map((line) => `> ${line}`)
          );
        }

        const keywordsElement = window.document.querySelector(
          'meta[name="keywords" i]'
        );
        const keywords =
          keywordsElement instanceof window.HTMLMetaElement &&
          keywordsElement.content;
        if (keywords) {
          headerLines.push(keywords);
        }

        headerLines.push(`[${decodeURI(getAnnolink(getURL()))}]`);
        headerLines.push("");
      }

      await write({
        annopageLink: prevInjectionData?.collaboratedAnnopageLink || {
          projectName: contentMessage.annoProjectName,
          title,
        },
        headerLines,
        includesPrefix: true,
        includesSuffix: true,
      });
      break;
    }

    case "markWord": {
      const headerLines = [];
      if (!prevInjectionData?.markedWordsPageLink) {
        headerLines.push("[/hata6502/anno word marker]");
        headerLines.push("[annos:/]");
        headerLines.push("");
      }

      await write({
        annopageLink: prevInjectionData?.markedWordsPageLink || {
          projectName: contentMessage.annoProjectName,
          title: "Marked words",
        },
        headerLines,
        includesPrefix: false,
        includesSuffix: false,
      });
      break;
    }

    case "inject": {
      const configs = Object.values(
        contentMessage.injectionData.annopageRecord
      ).flatMap(({ configs }) => configs);

      injectByTextQuote(
        configs.map((config) => ({
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
              markElement.classList.add("anno", "marker");
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
                iframeElement.classList.add("anno", "icon");

                iframeElement.style.width = `${width}px`;
                iframeElement.style.height = `${height}px`;

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

            const barmapElement = document.createElement("button");
            barmapElement.classList.add("anno", "barmap");

            barmapElement.addEventListener("click", () => {
              const { exact, prefix, suffix } = quoteText(
                getTextIndex(document.body),
                nextRange
              );

              const url = new URL(location.href);
              url.hash = `#${[
                `e=${encodeForScrapboxReadableLink(exact)}`,
                ...(prefix
                  ? [`p=${encodeForScrapboxReadableLink(prefix)}`]
                  : []),
                ...(suffix
                  ? [`s=${encodeForScrapboxReadableLink(suffix)}`]
                  : []),
              ].join("&")}`;
              history.pushState(null, "", url);
              prevURL = undefined;
              handleDocumentChange();
            });

            document.body.append(barmapElement);

            const handleResize = () => {
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
                16
              }px`;
              barmapElement.style.top = `${
                scrollableAncestorDOMRect.top + clientTop - 8
              }px`;
              barmapElement.style.height = `${Math.max(
                clientBottom - clientTop,
                4
              )}px`;
            };
            const resizeObserver = new ResizeObserver(handleResize);
            resizeObserver.observe(document.body);

            return {
              range: nextRange,
              cleanUp: () => {
                resizeObserver.disconnect();

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

      prevInjectionData = contentMessage.injectionData;
      break;
    }

    default: {
      const exhaustiveCheck: never = contentMessage;
      throw new Error(`Unknown contentMessage type: ${exhaustiveCheck}`);
    }
  }
});

let isHighlighted = false;
const highlight = () => {
  if (isHighlighted) {
    return;
  }

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

  isHighlighted = true;
};

let prevURL: string | undefined;
const checkURLChange = () => {
  if (prevURL !== location.href) {
    const urlChangeMessage: BackgroundMessage = {
      type: "urlChange",
      url: getURL(),
      prevInjectionData,
    };
    chrome.runtime.sendMessage(urlChangeMessage);

    isHighlighted = false;
  }

  prevURL = location.href;
};

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
