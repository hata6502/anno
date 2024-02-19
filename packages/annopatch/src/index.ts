import { extractAnnolink } from "scrapbox-loader";
import { getCanonicalURL, injectByTextQuote } from "text-quote-injection";

import { getTextRange } from "text-quote-selector";

const annopages = new Map(Object.entries(JSON.parse(ANNOPAGES)));

document.addEventListener("DOMContentLoaded", () => {
  const configs = extractAnnolink(getCanonicalURL())
    .flatMap((annolink) => annopages.get(annolink) ?? [])
    .flatMap(({ configs }) => configs);

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

        let textNodeIndex = 0;
        let charIndex = 0;
        const seekTextNode = (edge: "start" | "end") => {
          let currentTextNode;
          while ((currentTextNode = textNodes.at(textNodeIndex))) {
            const text = currentTextNode.textContent ?? "";

            if (
              edge === "start"
                ? charIndex < text.length
                : charIndex <= text.length
            )
              return { currentTextNode, text };

            textNodeIndex++;
            charIndex -= text.length;
          }
        };

        const splittedChanges = config.diff.flatMap((change) =>
          [...change.value].map((char) => ({ ...change, value: char }))
        );
        for (const change of splittedChanges) {
          if (change.added) {
            const current = seekTextNode("end");
            if (!current) break;
            const { currentTextNode, text } = current;

            currentTextNode.textContent = `${text.slice(0, charIndex)}${
              change.value
            }${text.slice(charIndex)}`;

            charIndex += change.value.length;
          } else if (change.removed) {
            const current = seekTextNode("start");
            if (!current) break;
            const { currentTextNode, text } = current;

            currentTextNode.textContent = `${text.slice(
              0,
              charIndex
            )}${text.slice(charIndex + change.value.length)}`;
          } else {
            charIndex += change.value.length;
          }
        }

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
        return { range: nextRange, cleanUp: () => {} };
      },
    }))
  );
});
