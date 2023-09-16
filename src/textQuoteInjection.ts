import {
  TextIndex,
  TextQuoteSelector,
  getTextIndex,
  textQuoteSelectorAll,
} from "text-quote-selector";

export interface TextQuoteInjectionConfig {
  id: string;
  textQuoteSelector: TextQuoteSelector;
  inject: (range: Range) => State;
}

interface Injection {
  config: TextQuoteInjectionConfig;
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
        states: [],
      }
  );
};

const handle = () => {
  mutationObserver.disconnect();
  try {
    const textIndex = getTextIndex(document.body);
    injections = injections
      .map((injection) => ({
        injection,
        ranges: getNearestRanges(textIndex, injection.config.textQuoteSelector),
      }))
      .map(({ injection, ranges }) => {
        for (const state of injection.states) {
          if (ranges.some((range) => isEqualRange(range, state.range))) {
            continue;
          }

          state.cleanUp();
        }

        return {
          ...injection,
          states: ranges.map(
            (range) =>
              injection.states.find((state) =>
                isEqualRange(state.range, range)
              ) ?? injection.config.inject(range)
          ),
        };
      });
  } finally {
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
};
const mutationObserver = new MutationObserver(handle);
new ResizeObserver(handle).observe(document.body);

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

const isEqualRange = (a: Range, b: Range) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset;
