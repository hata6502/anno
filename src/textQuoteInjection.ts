import {
  TextIndex,
  TextQuoteSelector,
  getTextIndex,
  textQuoteSelectorAll,
} from "./textQuoteSelector";

export type CleanUpTextQuoteInjection = () => void;

export interface TextQuoteInjectionConfig {
  id: string;
  textQuoteSelector: TextQuoteSelector;
  inject: (match: Range) => CleanUpTextQuoteInjection;
}

interface Injection {
  config: TextQuoteInjectionConfig;
  cleanUps: CleanUpTextQuoteInjection[];
  ranges: Range[];
}

export const injectByTextQuote = (configs: TextQuoteInjectionConfig[]) => {
  const configIDs = configs.map(({ id }) => id);
  for (const injection of injections) {
    if (configIDs.includes(injection.config.id)) {
      continue;
    }

    for (const cleanUp of injection.cleanUps) {
      cleanUp();
    }
  }

  injections = configs.map(
    (config) =>
      injections.find((injection) => injection.config.id === config.id) ?? {
        config,
        cleanUps: [],
        ranges: [],
      }
  );

  handleMutation();
};

let injections: Injection[] = [];
const handleMutation = () => {
  mutationObserver.disconnect();
  let textIndex = getTextIndex(document.body);

  injections = injections.map((injection) => {
    let ranges = getNearestRanges(
      textIndex,
      injection.config.textQuoteSelector
    );
    if (
      ranges.length === injection.ranges.length &&
      [...ranges.entries()].every(([rangeIndex, range]) => {
        const prevRange = injection.ranges[rangeIndex];
        return (
          range.startContainer === prevRange.startContainer &&
          range.startOffset === prevRange.startOffset &&
          range.endContainer === prevRange.endContainer &&
          range.endOffset === prevRange.endOffset
        );
      })
    ) {
      return injection;
    }

    for (const cleanUp of injection.cleanUps) {
      cleanUp();
    }
    textIndex = getTextIndex(document.body);
    ranges = getNearestRanges(textIndex, injection.config.textQuoteSelector);

    const cleanUps = ranges.map((range) => injection.config.inject(range));
    textIndex = getTextIndex(document.body);
    ranges = getNearestRanges(textIndex, injection.config.textQuoteSelector);

    return { ...injection, cleanUps, ranges };
  });

  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
};
const mutationObserver = new MutationObserver(handleMutation);

const getNearestRanges = (
  textIndex: TextIndex,
  textQuoteSelector: TextQuoteSelector
) => {
  const ranges = textQuoteSelectorAll(textIndex, textQuoteSelector);

  return ranges
    .filter(({ range }) => {
      const ancestorHTMLElement =
        range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      return !ancestorHTMLElement?.isContentEditable;
    })
    .flatMap(({ range, distance }) =>
      distance <= ranges[0].distance ? [range] : []
    );
};
