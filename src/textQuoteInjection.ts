// @ts-expect-error
import * as textQuote from "dom-anchor-text-quote";

export type CleanUpTextQuoteInjection = (props: unknown) => void;

export interface TextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface TextQuoteInjectionConfig {
  textQuoteSelector: TextQuoteSelector;
  inject: (match: Range) => unknown;
  cleanUp: CleanUpTextQuoteInjection;
}

type CleanUpTask = [CleanUpTextQuoteInjection, unknown];

export const injectByTextQuote = (configs: TextQuoteInjectionConfig[]) => {
  let cleanUpTasks: CleanUpTask[] = [];

  const cleanUp = () =>
    cleanUpTasks.forEach((cleanUpTask) => cleanUpTask[0](cleanUpTask[1]));

  const inject = () => {
    cleanUp();

    cleanUpTasks = configs.flatMap((config) => {
      const range = textQuote.toRange(document.body, config.textQuoteSelector);

      return range ? [[config.cleanUp, config.inject(range)]] : [];
    });
  };

  inject();

  let timeoutID: number | undefined;

  const mutationObserver = new MutationObserver(() => {
    clearTimeout(timeoutID);

    timeoutID = window.setTimeout(() => {
      mutationObserver.disconnect();
      inject();
      observeMutation();
    });
  });

  const observeMutation = () =>
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

  observeMutation();

  return () => {
    mutationObserver.disconnect();
    cleanUp();
  };
};

export const getTextQuoteSelectorfromSelection = ():
  | TextQuoteSelector
  | undefined => {
  const selection = getSelection();

  if (!selection || selection.rangeCount < 1) {
    return;
  }

  return textQuote.fromRange(document.body, selection.getRangeAt(0));
};
