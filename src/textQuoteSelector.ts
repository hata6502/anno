import leven from "leven";

export interface TextIndex {
  text: string;
  index: Index;
}

export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

type Index = [number, Text][];

interface TextRangePoint {
  textNode: Text;
  offset: number;
}

const contextLength = 32;

export const getTextIndex = (root: Node): TextIndex => {
  const index: Index = [];
  let text = "";

  const nodeIterator = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = nodeIterator.nextNode())) {
    if (!(node instanceof Text)) {
      throw new Error("node is not Text");
    }

    index.push([text.length, node]);
    text += node.textContent?.trim() ?? "";
  }

  return { text, index };
};

export const quoteText = (
  textIndex: TextIndex,
  range: Range
): TextQuoteSelector => {
  const startNode = getRangePointNode({
    container: range.startContainer,
    offset: range.startOffset,
  });
  const endNode = getRangePointNode({
    container: range.endContainer,
    offset: range.endOffset,
  });

  const textNodes = [];
  const nodeIterator = document.createNodeIterator(
    range.commonAncestorContainer,
    NodeFilter.SHOW_ALL
  );
  let node;
  let isInRange = false;
  while ((node = nodeIterator.nextNode())) {
    if (node === startNode) {
      isInRange = true;
    }

    if (isInRange && node instanceof Text) {
      textNodes.push(node);
    }

    if (node === endNode) {
      break;
    }
  }

  let startContainer;
  let startOffset = range.startOffset;
  startContainer = range.startContainer;
  if (!(startContainer instanceof Text)) {
    startContainer = textNodes.at(0);
    if (!startContainer) {
      throw new Error("startContainer not found");
    }

    startOffset = 0;
  }

  let endContainer;
  let endOffset = range.endOffset;
  endContainer = range.endContainer;
  if (!(endContainer instanceof Text)) {
    endContainer = textNodes.at(-1);
    if (!endContainer) {
      throw new Error("endContainer not found");
    }

    endOffset = endContainer.textContent?.length ?? 0;
  }

  const startIndex = textRangePointToIndex(textIndex, {
    textNode: startContainer,
    offset: startOffset,
  });
  const endIndex = textRangePointToIndex(textIndex, {
    textNode: endContainer,
    offset: endOffset,
  });

  return {
    exact: textIndex.text.slice(startIndex, endIndex),
    prefix: textIndex.text.slice(
      Math.max(startIndex - contextLength, 0),
      startIndex
    ),
    suffix: textIndex.text.slice(endIndex, endIndex + contextLength),
  };
};

export const textQuoteSelectorAll = (
  textIndex: TextIndex,
  { exact, prefix = "", suffix = "" }: TextQuoteSelector
) => {
  const exactMatchIndexes = [];
  let exactMatchIndex = -1;
  while (
    (exactMatchIndex = textIndex.text.indexOf(exact, exactMatchIndex + 1)) !==
    -1
  ) {
    exactMatchIndexes.push(exactMatchIndex);
  }

  const matches = exactMatchIndexes.map((exactMatchIndex) => {
    const exactMatchEndIndex = exactMatchIndex + exact.length;
    const distance =
      leven(
        textIndex.text.slice(
          Math.max(exactMatchIndex - contextLength, 0),
          exactMatchIndex
        ),
        prefix
      ) +
      leven(
        textIndex.text.slice(
          exactMatchEndIndex,
          exactMatchEndIndex + contextLength
        ),
        suffix
      );

    return [exactMatchIndex, distance] as const;
  });

  return [...matches]
    .sort(([, aDistance], [, bDistance]) => aDistance - bDistance)
    .map(([startIndex, distance]) => {
      const start = indexToTextRangePoint(textIndex, {
        index: startIndex,
        isStart: true,
      });
      const end = indexToTextRangePoint(textIndex, {
        index: startIndex + exact.length,
        isStart: false,
      });

      const range = new Range();
      range.setStart(start.textNode, start.offset);
      range.setEnd(end.textNode, end.offset);

      return { range, distance };
    });
};

const textRangePointToIndex = (
  textIndex: TextIndex,
  { textNode, offset }: TextRangePoint
) => {
  const record = textIndex.index.find(
    ([, currentTextNode]) => currentTextNode === textNode
  );
  if (!record) {
    throw new Error("textNode not found in index");
  }
  const [index] = record;

  return index + offset;
};

const indexToTextRangePoint = (
  textIndex: TextIndex,
  { index, isStart }: { index: number; isStart: boolean }
): TextRangePoint => {
  let prev;
  for (const current of textIndex.index) {
    const [currentIndex] = current;
    if (isStart ? index < currentIndex : index <= currentIndex) {
      break;
    }

    prev = current;
  }
  if (!prev) {
    throw new Error("index out of range");
  }

  const [prevIndex, textNode] = prev;
  return {
    textNode,
    offset: index - prevIndex,
  };
};

const getRangePointNode = ({
  container,
  offset,
}: {
  container: Node;
  offset: number;
}) =>
  container instanceof Text ||
  container instanceof Comment ||
  container instanceof CDATASection
    ? container
    : [...container.childNodes].at(offset) ?? container;
