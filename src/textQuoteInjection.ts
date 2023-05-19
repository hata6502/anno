// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";

export type CleanUpTextQuoteInjection = () => void;

export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

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

  injections = injections.map((injection) => {
    let ranges = getNearestRanges(injection.config.textQuoteSelector);
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
    ranges = getNearestRanges(injection.config.textQuoteSelector);

    const cleanUps = ranges.map((range) => injection.config.inject(range));
    ranges = getNearestRanges(injection.config.textQuoteSelector);

    return { ...injection, cleanUps, ranges };
  });

  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
};
const mutationObserver = new MutationObserver(handleMutation);

const getNearestRanges = (textQuoteSelector: TextQuoteSelector): Range[] => {
  const ranges = textQuote.toRanges(document.body, textQuoteSelector);
  return (
    ranges
      // @ts-expect-error
      .filter(({ range }) => {
        const ancestorHTMLElement =
          range.commonAncestorContainer instanceof HTMLElement
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;
        return !ancestorHTMLElement?.isContentEditable;
      })
      // @ts-expect-error
      .flatMap(({ range, distance }) =>
        distance <= ranges[0].distance ? [range] : []
      )
  );
};
