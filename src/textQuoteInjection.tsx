import {
  TextIndex,
  TextQuoteSelector,
  getTextIndex,
  textQuoteSelectorAll,
} from "text-quote-selector";

export interface TextQuoteInjectionConfig {
  id: string;
  textQuoteSelector: TextQuoteSelector;
  whiteout: string;
  inject: (range: Range) => State;
}

interface Injection {
  config: TextQuoteInjectionConfig;
  minDistance: number;
  states: State[];
}

interface State {
  range: Range;
  cleanUp: () => void;
}

let injections: Injection[] = [];
export const injectByTextQuote = (configs: TextQuoteInjectionConfig[]) => {
  const configIDs = configs.map(({ id }) => id);
  for (const { config, states } of injections) {
    if (configIDs.includes(config.id)) {
      continue;
    }

    for (const { cleanUp } of states) {
      cleanUp();
    }
  }

  injections = configs.map(
    (config) =>
      injections.find((injection) => injection.config.id === config.id) ?? {
        config,
        minDistance: Infinity,
        states: [],
      }
  );

  handle();
};

const handle = () => {
  mutationObserver.disconnect();
  try {
    const textIndex = getTextIndex(document.body);
    injections = injections
      .map((injection) => ({
        injection,
        ...getNearestRanges(
          textIndex,
          injection.config.textQuoteSelector,
          injection.minDistance
        ),
      }))
      .map(({ injection, nearestRanges, minDistance }) => ({
        ...injection,
        minDistance,
        states: [
          ...injection.states,
          ...nearestRanges.flatMap((range) =>
            injection.states.some((state) => isEqualRange(state.range, range))
              ? []
              : [injection.config.inject(range)]
          ),
        ],
      }));
  } finally {
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
};
const mutationObserver = new MutationObserver(handle);

const getNearestRanges = (
  textIndex: TextIndex,
  textQuoteSelector: TextQuoteSelector,
  prevDistance: number
) => {
  const ranges = textQuoteSelectorAll(textIndex, textQuoteSelector);
  const minDistance = Math.min(
    prevDistance,
    ranges.at(0)?.distance ?? Infinity
  );
  const nearestRanges = ranges
    .filter(({ range }) => {
      const ancestorHTMLElement =
        range.commonAncestorContainer instanceof HTMLElement
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      return !ancestorHTMLElement?.isContentEditable;
    })
    .flatMap(({ range, distance }) => (distance <= minDistance ? [range] : []));
  return { nearestRanges, minDistance };
};

const isEqualRange = (a: Range, b: Range) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset;
