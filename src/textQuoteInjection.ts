// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";

export type CleanUpTextQuoteInjection = () => void;

export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface TextQuoteInjectionConfig {
  textQuoteSelector: TextQuoteSelector;
  inject: (match: Range) => CleanUpTextQuoteInjection;
}

interface Injection {
  config: TextQuoteInjectionConfig;
  cleanUp?: CleanUpTextQuoteInjection;
  range?: Range;
}

export const injectByTextQuote = (configs: TextQuoteInjectionConfig[]) => {
  let injections: Injection[] = configs.map((config) => ({ config }));

  const inject = () => {
    injections = injections.map(({ config, cleanUp, range }) => {
      let nextCleanUp = cleanUp;
      let nextRange = range;

      const currentRange: Range | undefined = textQuote.toRange(
        document.body,
        config.textQuoteSelector
      );
      if (
        nextRange?.startContainer !== currentRange?.startContainer ||
        nextRange?.startOffset !== currentRange?.startOffset ||
        nextRange?.endContainer !== currentRange?.endContainer ||
        nextRange?.endOffset !== currentRange?.endOffset
      ) {
        nextCleanUp?.();
        nextRange = textQuote.toRange(document.body, config.textQuoteSelector);

        nextCleanUp = nextRange ? config.inject(nextRange) : undefined;
        nextRange = textQuote.toRange(document.body, config.textQuoteSelector);
      }

      return { config, cleanUp: nextCleanUp, range: nextRange };
    });
  };

  const handleMutation = () => {
    mutationObserver.disconnect();
    inject();
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  };
  const mutationObserver = new MutationObserver(handleMutation);
  handleMutation();

  return () => {
    mutationObserver.disconnect();
    for (const { cleanUp } of injections) {
      cleanUp?.();
    }
  };
};
