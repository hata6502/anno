import type { BackgroundMessage } from "./background";
import { encodeForScrapboxReadableLink } from "./url";

import { Annolink, getAnnolink } from "scrapbox-loader";
import { getCanonicalURL, injectByTextQuote } from "text-quote-injection";

import {
  TextQuoteSelector,
  getTextIndex,
  getTextRange,
  quoteText,
  textQuoteSelectorAll,
} from "text-quote-selector";

export type ContentMessage =
  | {
      type: "mark";
    }
  | {
      type: "inject";
      injectionData: InjectionData;
    };

export interface InjectionData {
  annoProjectName: string;
  pageRecord: Record<string, InjectionPage>;
  collaboratedPage?: InjectionPage;
}

export interface InjectionPage {
  projectName: string;
  title: string;
  configs: {
    textQuoteSelector: TextQuoteSelector;
    markerText: string;
    iframes: { url: string; width: number; height: number }[];
  }[];
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
      background-clip: padding-box;
      cursor: pointer;
      opacity: 0.5;
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

const mark = async () => {
  if (!prevInjectionData) return;

  const title = document.title || new Date().toLocaleString();
  const headerLines = [];

  if (!prevInjectionData?.collaboratedPage) {
    const gyazoIDMatch = location.pathname.match(/^\/([0-9a-z]{32})$/);
    if (location.host.match(/^([0-9a-z\-]+\.)?gyazo.com$/) && gyazoIDMatch) {
      const response = await fetch(
        `/${encodeURIComponent(gyazoIDMatch[1])}.json`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch gyazo.com");
      }
      const { desc, metadata, permalink_url } = await response.json();

      headerLines.push(
        ...[
          `[${permalink_url} ${permalink_url}]`,
          desc || undefined,
          metadata.url
            ? metadata.title
              ? `[${metadata.title} ${metadata.url}]`
              : `[${metadata.url}]`
            : metadata.title,
          metadata.exif_normalized?.latitude &&
            `[N${metadata.exif_normalized.latitude},E${metadata.exif_normalized.longitude},Z17]`,
        ].flatMap((data) => (typeof data === "string" ? data.split("\n") : []))
      );
    } else {
      headerLines.push(`[${title} ${getCanonicalURL()}]`);

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
        headerLines.push(...description.split("\n").map((line) => `> ${line}`));
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
    }

    headerLines.push(
      `#annopage [${decodeURI(getAnnolink(getCanonicalURL()))}]`,
      ""
    );
  }

  await write({
    annopageLink: prevInjectionData.collaboratedPage ?? {
      projectName: prevInjectionData.annoProjectName,
      title,
    },
    headerLines,
    includesPrefix: true,
    includesSuffix: true,
    markerText:
      prevInjectionData?.collaboratedPage?.configs.at(-1)?.markerText || "🍀",
  });
};

const write = async ({
  annopageLink,
  headerLines,
  includesPrefix,
  includesSuffix,
  markerText,
}: {
  annopageLink: Annolink;
  headerLines: string[];
  includesPrefix: boolean;
  includesSuffix: boolean;
  markerText: string;
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
      `[${markerText} ${getCanonicalURL()}#${[
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
      await mark();
      break;
    }

    case "inject": {
      const configs = Object.values(
        contentMessage.injectionData.pageRecord
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

            const textNodes: Text[] = [];
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

            const color = new Map([
              ["🟥", "hsl(0 100% 87.5%)"],
              ["🟧", "hsl(40 100% 87.5%)"],
              ["🟨", "hsl(60 100% 87.5%)"],
              ["🟩", "hsl(120 100% 87.5%)"],
              ["🟦", "hsl(240 100% 87.5%)"],
              ["🟪", "hsl(300 100% 87.5%)"],
              ["🟫", "hsl(0 25% 75%)"],
              ["⬛", "hsl(0 0% 75%)"],
              ["⬜", "transparent"],
            ]).get(config.markerText);

            const markElements = textNodes.map((textNode) => {
              const markElement = document.createElement("mark");
              markElement.classList.add("anno", "marker");
              markElement.style.backgroundColor = color ?? "";

              textNode.after(markElement);
              markElement.append(textNode);
              return markElement;
            });

            const iframeElements = config.iframes.map((iframe) => {
              const iframeElement = document.createElement("iframe");
              iframeElement.src = iframe.url;
              iframeElement.sandbox.add(
                "allow-popups",
                "allow-popups-to-escape-sandbox",
                "allow-scripts"
              );
              iframeElement.classList.add("anno", "icon");
              iframeElement.style.width = `${iframe.width}px`;
              iframeElement.style.height = `${iframe.height}px`;
              return iframeElement;
            });
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
                (lastTextNode.textContent ?? "").length
              );
            }

            const barmapElement = document.createElement("button");
            barmapElement.classList.add("anno", "barmap");
            barmapElement.style.backgroundColor = color ?? "rgb(91, 165, 111)";

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
                scrollableAncestorDOMRect.top + clientTop - 16
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
      url: getCanonicalURL(),
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

document.body.addEventListener("pointerdown", async (event) => {
  const selection = getSelection();
  const selectedElement = document.elementFromPoint(
    event.clientX,
    event.clientY
  );
  if (
    !(event.ctrlKey || event.metaKey) ||
    !event.altKey ||
    !selection ||
    !selectedElement
  )
    return;

  event.preventDefault();
  event.stopPropagation();

  const range = new Range();
  range.selectNode(selectedElement);
  selection.removeAllRanges();
  selection.addRange(range);
  console.log(range);

  await mark();
});
