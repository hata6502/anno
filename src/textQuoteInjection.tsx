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
  inject: (range: Range) => Pick<State, "range" | "cleanUp">;
}

interface Injection {
  config: TextQuoteInjectionConfig;
  states: State[];
}

interface State {
  range: Range;
  cleanUp: () => void;
  staticRange: StaticRange;
  distance: number;
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

  handle();
};

const handle = () => {
  mutationObserver.disconnect();
  try {
    let textIndex = getTextIndex(document.body);
    injections = injections.map((injection) => {
      const unchangedStates = injection.states.filter(
        ({ range, cleanUp, staticRange }) => {
          if (isEqualRange(range, staticRange)) {
            return true;
          }

          cleanUp();
          textIndex = getTextIndex(document.body);
          return false;
        }
      );

      const { nearestRanges, minDistance } = getNearestRanges(
        textIndex,
        injection.config.textQuoteSelector,
        Math.min(...unchangedStates.map(({ distance }) => distance))
      );

      return {
        ...injection,
        states: [
          ...unchangedStates,
          ...nearestRanges.flatMap((nearestRange) => {
            if (
              unchangedStates.some((state) =>
                isEqualRange(state.range, nearestRange)
              )
            )
              return [];

            const { range, cleanUp } = injection.config.inject(nearestRange);
            textIndex = getTextIndex(document.body);

            return [
              {
                range,
                cleanUp,
                staticRange: new StaticRange(range),
                distance: minDistance,
              },
            ];
          }),
        ],
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

const isEqualRange = (a: AbstractRange, b: AbstractRange) =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset;
