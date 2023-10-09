import { FunctionComponent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  TextIndex,
  TextQuoteSelector,
  getTextIndex,
  textQuoteSelectorAll,
} from "text-quote-selector";

export interface TextQuoteInjectionConfig {
  //id: string;
  textQuoteSelector: TextQuoteSelector;
  inject: Inject;
}

interface Injection {
  config: TextQuoteInjectionConfig;
  states: State[];
}

type Inject = (range: Range) => State;

interface State {
  range: Range;
  cleanUp: () => void;
}

const root = createRoot(document.createDocumentFragment());
export const injectByTextQuote = (configs: TextQuoteInjectionConfig[]) => {
  root.render(<Injections configs={configs} />);
};

const Injections: FunctionComponent<{
  configs: TextQuoteInjectionConfig[];
}> = ({ configs }) => {
  const textIndex = getTextIndex(document.body);
  const [, setRenderCount] = useState(0);

  useEffect(() => {
    const handle = () => {
      mutationObserver.disconnect();
      try {
        setRenderCount((renderCount) => renderCount + 1);
      } finally {
        mutationObserver.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      }
    };

    const mutationObserver = new MutationObserver(handle);
    const resizeObserver = new ResizeObserver(handle);
    resizeObserver.observe(document.body);
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  return configs.map((config, configIndex) => (
    <Injection key={configIndex} config={config} textIndex={textIndex} />
  ));
};

const Injection: FunctionComponent<{
  config: TextQuoteInjectionConfig;
  textIndex: TextIndex;
}> = ({ config, textIndex }) =>
  getNearestRanges(textIndex, config.textQuoteSelector).map(
    (range, rangeIndex) => (
      <TextQuoteInjectionRange
        key={rangeIndex}
        inject={config.inject}
        range={range}
      />
    )
  );

const TextQuoteInjectionRange: FunctionComponent<{
  inject: Inject;
  range: Range;
}> = ({ inject, range }) => {
  const ref = useRef<State>();
  if (
    !ref.current ||
    ref.current.range.startContainer !== range.startContainer ||
    ref.current.range.startOffset !== range.startOffset ||
    ref.current.range.endContainer !== range.endContainer ||
    ref.current.range.endOffset !== range.endOffset
  ) {
    ref.current?.cleanUp();
    ref.current = inject(range);
  }

  return null;
};

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
