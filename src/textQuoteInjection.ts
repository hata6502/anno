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
  cleanUp?: CleanUpTextQuoteInjection;
  range?: Range;
}

export const injectByTextQuote = (nextConfigs: TextQuoteInjectionConfig[]) => {
  const nextConfigIDs = nextConfigs.map(({ id }) => id);
  for (const { config, cleanUp } of injections) {
    if (nextConfigIDs.includes(config.id)) {
      continue;
    }

    cleanUp?.();
  }

  injections = nextConfigs.map((nextConfig) => ({
    ...injections.find(({ config }) => config.id === nextConfig.id),
    config: nextConfig,
  }));

  handleMutation();
};

let injections: Injection[] = [];
const handleMutation = () => {
  mutationObserver.disconnect();

  injections = injections.map(({ config, cleanUp, range }) => {
    let nextCleanUp = cleanUp;
    let nextRange = range;

    const currentRange: Range | undefined = textQuote
      .toRanges(document.body, config.textQuoteSelector)
      .at(0)?.range;
    if (
      nextRange?.startContainer !== currentRange?.startContainer ||
      nextRange?.startOffset !== currentRange?.startOffset ||
      nextRange?.endContainer !== currentRange?.endContainer ||
      nextRange?.endOffset !== currentRange?.endOffset
    ) {
      nextCleanUp?.();
      nextRange = textQuote
        .toRanges(document.body, config.textQuoteSelector)
        .at(0)?.range;

      nextCleanUp = nextRange ? config.inject(nextRange) : undefined;
      nextRange = textQuote
        .toRanges(document.body, config.textQuoteSelector)
        .at(0)?.range;
    }

    return { config, cleanUp: nextCleanUp, range: nextRange };
  });

  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
};
const mutationObserver = new MutationObserver(handleMutation);
