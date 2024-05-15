import { FunctionComponent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/** OCRによって検出された矩形領域 */
interface Annotation {
  /** 書かれているテキスト */
  description: string;
  /** 次のAnnotationと何行分の空白があるか */
  breakCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Scale {
  width: number;
  height: number;
}

const styleElement = document.createElement("style");
styleElement.textContent = `
  .image-box-component {
    /* annoで置いたアイコンやマーカー向けの調整 */
    .anno {
      &.icon {
        position: absolute;
        opacity: 0.5;

        &:active, &:focus, &:hover {
          opacity: unset;
        }
      }

      &.marker {
        color: transparent;
        opacity: 0.25;

        &::selection {
          background: rgb(0, 0, 128);
        }
      }
    }

    .gyanno {
      &.overlayer {
        position: absolute;
        pointer-events: auto;
      }

      &.text {
        position: absolute;
        color: transparent;
        cursor: auto;
        font-family: sans-serif;
        user-select: text;
        white-space: pre;

        &.horizontal {
          writing-mode: horizontal-tb;
        }

        &.vertical {
          writing-mode: vertical-rl;
        }

        /*
         * Chrome内蔵の翻訳機能を使うと、<font>タグが入ったりする
         * "& *::selection"と書けば、翻訳機能を使ってもスタイルが当たる
         */
        &::selection, & *::selection {
          background: #cceeff;
          color: #000000;
        }
      }

      &.break {
        visibility: hidden;
      }
    }
  }

  .select-all-detector {
    position: absolute;

    &::after {
      content: "\\200b";
    }
  }
`;
document.head.append(styleElement);

const selection = getSelection();
if (!selection) {
  throw new Error("No selection");
}

const cache = new Map<
  string,
  Promise<{ annotations: Annotation[]; scale: Scale } | undefined>
>();

const overlayerElement = document.createElement("div");
overlayerElement.classList.add("gyanno", "overlayer");
overlayerElement.addEventListener("click", (event) => {
  // テキスト選択と画像拡大の操作が干渉しないようにする
  event.stopPropagation();
});

// https://dev.to/chromiumdev/detecting-select-all-on-the-web-2alo
const selectAllDetectorElement = document.createElement("div");
selectAllDetectorElement.classList.add("select-all-detector");
document.body.append(selectAllDetectorElement);

const Overlayer: FunctionComponent = () => {
  const [handleResult, setHandleResult] = useState<{
    annotations: Annotation[];
    scale: Scale;
  }>();
  const [, setRenderCount] = useState(0);

  useEffect(() => {
    const handle = async () => {
      const imageBoxElement = document.querySelector(".image-box-component");
      if (!(imageBoxElement instanceof HTMLElement)) {
        return;
      }

      if (selection.containsNode(selectAllDetectorElement, true)) {
        selection.removeAllRanges();
        const range = new Range();
        range.selectNode(overlayerElement);
        selection.addRange(range);
      }

      imageBoxElement.style.pointerEvents = selection.isCollapsed ? "" : "none";

      const containsOverlayer = selection.containsNode(overlayerElement, true);
      document.body.style.userSelect = containsOverlayer ? "none" : "";

      setHandleResult(
        await (() => {
          const match = location.pathname.match(/^\/([0-9a-z]{32})$/);
          if (!match) {
            return;
          }

          const url = `/${encodeURIComponent(match[1])}.json`;
          const fetching =
            cache.get(url) ??
            (async () => {
              let json;
              while (true) {
                const response = await fetch(url);
                if (!response.ok) {
                  throw new Error(response.statusText);
                }
                json = await response.json();

                if (!json.metadata || json.has_mp4) {
                  return;
                }
                if (json.metadata.ocrAnnotations) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 5000));
              }

              const annotations: Annotation[] =
                json.metadata.ocrAnnotations.map(
                  // @ts-expect-error
                  ({ description, boundingPoly }) => {
                    // @ts-expect-error
                    const xs = boundingPoly.vertices.map(({ x }) => x ?? 0);
                    // @ts-expect-error
                    const ys = boundingPoly.vertices.map(({ y }) => y ?? 0);

                    return {
                      description,
                      breakCount: 0,
                      minX: Math.min(...xs),
                      minY: Math.min(...ys),
                      maxX: Math.max(...xs),
                      maxY: Math.max(...ys),
                    };
                  }
                );

              // Annotationが細分化されていると、テキスト選択の挙動が破滅しやすくなる気がする
              // 隣接するAnnotationを結合して、Annotation数を減らす
              for (let aIndex = 0; aIndex < annotations.length - 1; aIndex++) {
                const bIndex = aIndex + 1;
                const a = annotations[aIndex];
                const b = annotations[bIndex];

                const mergedAnnotation = getNeighborAnnotation(a, b);
                if (mergedAnnotation) {
                  annotations[aIndex] = mergedAnnotation;
                  annotations.splice(bIndex, 1);
                  if (aIndex >= 1) {
                    aIndex--;
                  }
                }
              }

              for (const [aIndex, a] of annotations.slice(0, -1).entries()) {
                const b = annotations[aIndex + 1];

                const aStyle = getStyle(a);
                const bStyle = getStyle(b);

                a.breakCount = Math.min(
                  Math.round(
                    Math.abs(
                      (aStyle.isHorizontal
                        ? bStyle.top - aStyle.top
                        : aStyle.left +
                          aStyle.width -
                          (bStyle.left + bStyle.width)) / aStyle.size
                    )
                  ),
                  // テキストを全選択してコピペすると、
                  //
                  //
                  //
                  //
                  //
                  // 長大な改行が入ることがあった
                  // 改行は最大2行までに
                  //
                  // 制限する
                  2
                );
              }

              return { annotations, scale: json.scale };
            })();
          cache.set(url, fetching);
          return fetching;
        })()
      );

      setRenderCount((renderCount) => renderCount + 1);
    };

    const mutationObserver = new MutationObserver(async (mutations) => {
      if (
        mutations.some(
          (mutation) =>
            mutation.target instanceof Element &&
            mutation.target.matches(".anno")
        )
      ) {
        return;
      }

      await handle();
    });
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    const resizeObserver = new ResizeObserver(handle);
    resizeObserver.observe(document.body);

    document.addEventListener("selectionchange", handle);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("selectionchange", handle);
    };
  }, []);

  if (!handleResult) {
    return;
  }

  const imageBoxElement = document.querySelector(".image-box-component");
  if (!imageBoxElement) {
    return;
  }
  const imageBoxRect = imageBoxElement.getBoundingClientRect();

  const imageViewerElement = imageBoxElement.querySelector(".image-viewer");
  if (!imageViewerElement) {
    return;
  }
  const imageViewerRect = imageViewerElement.getBoundingClientRect();

  overlayerElement.style.left = `${
    imageViewerRect.right - imageBoxRect.left
  }px`;
  overlayerElement.style.top = `${imageViewerRect.top - imageBoxRect.top}px`;
  if (overlayerElement.parentNode !== imageBoxElement) {
    imageBoxElement.append(overlayerElement);
  }

  return (
    <>
      {handleResult.annotations.map((annotation, annotationIndex) => (
        <GyannoText
          key={annotationIndex}
          annotation={annotation}
          imageViewerRect={imageViewerRect}
          scale={handleResult.scale}
        />
      ))}
    </>
  );
};
createRoot(overlayerElement).render(<Overlayer />);

const GyannoText: FunctionComponent<{
  annotation: Annotation;
  imageViewerRect: DOMRect;
  scale: Scale;
}> = ({ annotation, imageViewerRect, scale }) => {
  const style = getStyle(annotation);
  const width = (style.width / scale.width) * imageViewerRect.width;
  const height = (style.height / scale.height) * imageViewerRect.height;

  const expected = Math.max(width, height);
  const fontSize = Math.min(width, height);

  const [letterSpacing, setLetterSpacing] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const element = ref.current;

    const adjust = () => {
      element.style.letterSpacing = "0";
      const textRect = element.getBoundingClientRect();
      const actual = Math.max(textRect.width, textRect.height);
      const segments = [
        ...new Intl.Segmenter().segment(element.textContent ?? ""),
      ].map((segment) => segment.segment);
      setLetterSpacing((expected - actual) / segments.length);
    };
    adjust();

    // Chrome内蔵の翻訳機能によるテキスト変更を検知する
    const mutationObserver = new MutationObserver(adjust);
    mutationObserver.observe(element, {
      subtree: true,
      characterData: true,
    });
    return () => {
      mutationObserver.disconnect();
    };
  }, [expected]);

  return (
    <span
      ref={ref}
      className={`gyanno text ${
        style.isHorizontal ? "horizontal" : "vertical"
      }`}
      style={{
        right:
          (1 - (style.left + style.width) / scale.width) *
          imageViewerRect.width,
        top: (style.top / scale.height) * imageViewerRect.height,
        fontSize,
        letterSpacing,
      }}
    >
      {annotation.description}

      {[...Array(annotation.breakCount).keys()].map((breakIndex) => (
        // 見えない<br>を置くと、テキスト選択してコピペしたときに改行が入る
        <br key={breakIndex} className="gyanno break" />
      ))}
    </span>
  );
};

const getStyle = ({ description, minX, minY, maxX, maxY }: Annotation) => {
  let width = maxX - minX;
  let height = maxY - minY;
  // 例えば「A」1文字だと、widthよりもheightの方が大きいため、縦書きとして判定されてしまう
  // 実際には横書きであることが多いため、1文字の場合は必ず横書きとして判定させる
  if (description.length < 2) {
    width = height = Math.max(width, height);
  }

  return {
    left: minX,
    top: minY,
    width,
    height,
    isHorizontal: width >= height,
    size: Math.min(width, height),
  };
};

const getNeighborAnnotation = (a: Annotation, b: Annotation) => {
  const aStyle = getStyle(a);
  const bStyle = getStyle(b);

  const getIsIntersected = (margin: number) =>
    aStyle.left + aStyle.width + aStyle.size * margin >=
      bStyle.left - bStyle.size * margin &&
    aStyle.top + aStyle.height + aStyle.size * margin >=
      bStyle.top - bStyle.size * margin &&
    bStyle.left + bStyle.width + bStyle.size * margin >=
      aStyle.left - aStyle.size * margin &&
    bStyle.top + bStyle.height + bStyle.size * margin >=
      aStyle.top - aStyle.size * margin;
  if (!getIsIntersected(0.5)) {
    return;
  }

  const neighbor = {
    description: `${a.description}${getIsIntersected(0.125) ? "" : " "}${
      b.description
    }`,
    breakCount: 0,
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };

  const neighborStyle = getStyle(neighbor);
  if (
    Math.abs(neighborStyle.size - aStyle.size) >= aStyle.size * 0.5 ||
    Math.abs(neighborStyle.size - bStyle.size) >= bStyle.size * 0.5
  ) {
    return;
  }

  return neighbor;
};
