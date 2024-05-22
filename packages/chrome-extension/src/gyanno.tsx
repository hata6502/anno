import clsx from "clsx";
import { FunctionComponent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/** OCRによって検出された矩形領域 */
interface Annotation {
  segments: string[];
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
    .gyanno {
      &.overlayer {
        position: absolute;
        cursor: crosshair;
        overflow: hidden;
      }

      &.segment {
        &.selected {
          background: #cceeff;
          color: #000000;
        }
      }

      &.selected-rect {
        position: absolute;
        border: 1px solid #ffffff;
        cursor: grab;
        font-size: 0;
        outline: 1px dotted #000000;
        outline-offset: -1px;
        white-space: pre;
    
        &.grabbing {
          cursor: grabbing;
          user-select: none;
        }
    
        &.selecting {
          cursor: unset;
          user-select: none;
        }
      }

      &.text {
        position: absolute;
        color: transparent;
        font-family: ui-monospace;
        user-select: none;
        white-space: pre;

        &.horizontal {
          writing-mode: horizontal-tb;
        }

        &.vertical {
          writing-mode: vertical-rl;
        }
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

  const [grab, setGrab] = useState<[number, number]>();
  const [selecting, setSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<[number, number]>();
  const [selectionEnd, setSelectionEnd] = useState<[number, number]>();
  const selectedRect = useMemo(
    () =>
      selectionStart &&
      selectionEnd &&
      ([
        Math.min(selectionStart[0], selectionEnd[0]),
        Math.min(selectionStart[1], selectionEnd[1]),
        Math.max(selectionStart[0], selectionEnd[0]),
        Math.max(selectionStart[1], selectionEnd[1]),
      ] as const),
    [selectionStart, selectionEnd]
  );

  const selectedRectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = async () => {
      const imageBoxElement = document.querySelector(".image-box-component");
      if (!(imageBoxElement instanceof HTMLElement)) {
        return;
      }

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
              overlayerElement.style.cursor = "wait";
              try {
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
                  if (json.metadata.ocr?.processed) {
                    return;
                  }
                  await new Promise((resolve) => setTimeout(resolve, 5000));
                }
              } finally {
                overlayerElement.style.cursor = "";
              }

              const annotations = (json.metadata.ocrAnnotations as any[]).map(
                ({ description, boundingPoly }): Annotation => {
                  // @ts-expect-error
                  const xs = boundingPoly.vertices.map(({ x }) => x ?? 0);
                  // @ts-expect-error
                  const ys = boundingPoly.vertices.map(({ y }) => y ?? 0);
                  return {
                    segments: [
                      ...new Intl.Segmenter().segment(description),
                    ].map(({ segment }) => segment),
                    breakCount: 0,
                    minX: Math.min(...xs),
                    minY: Math.min(...ys),
                    maxX: Math.max(...xs),
                    maxY: Math.max(...ys),
                  };
                }
              );

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
                  Math.floor(
                    Math.abs(
                      (aStyle.isHorizontal
                        ? bStyle.top - aStyle.top
                        : aStyle.left +
                          aStyle.width -
                          (bStyle.left + bStyle.width)) / aStyle.size
                    )
                  ),
                  // テキストを全選択してコピペすると、長大な改行が入ることがあった
                  // 改行は最大2行までに制限する
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

    const handleSelectionChange = () => {
      if (selection.containsNode(selectAllDetectorElement, true)) {
        const overlayerRect = overlayerElement.getBoundingClientRect();
        setSelectionStart([0, 0]);
        setSelectionEnd([overlayerRect.width, overlayerRect.height]);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      // 右クリックの時はGyazoのコンテキストメニューを表示させる
      if (event.button !== 0) {
        overlayerElement.style.pointerEvents = "none";
        return;
      }

      const overlayerRect = overlayerElement.getBoundingClientRect();
      const x = event.clientX - overlayerRect.left;
      const y = event.clientY - overlayerRect.top;

      if (
        selectedRect &&
        selectedRect[0] <= x &&
        x <= selectedRect[2] &&
        selectedRect[1] <= y &&
        y <= selectedRect[3]
      ) {
        setGrab([x, y]);
        return;
      }

      setSelecting(true);
      setSelectionStart([x, y]);
      setSelectionEnd([x, y]);
    };
    document.addEventListener("pointerdown", handlePointerDown);

    const handlePointerMove = (event: PointerEvent) => {
      overlayerElement.style.pointerEvents = "";

      const overlayerRect = overlayerElement.getBoundingClientRect();
      const x = event.clientX - overlayerRect.left;
      const y = event.clientY - overlayerRect.top;

      if (grab && selectedRect) {
        const deltaX = x - grab[0];
        const deltaY = y - grab[1];
        setSelectionStart([selectedRect[0] + deltaX, selectedRect[1] + deltaY]);
        setSelectionEnd([selectedRect[2] + deltaX, selectedRect[3] + deltaY]);
        setGrab([x, y]);
      }

      if (selecting) {
        setSelectionEnd([x, y]);
      }
    };
    document.addEventListener("pointermove", handlePointerMove);

    const handlePointerUp = () => {
      setGrab(undefined);
      setSelecting(false);
    };
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [grab, selectedRect, selecting]);

  useEffect(() => {
    if (!handleResult || !selectedRectRef.current) {
      return;
    }

    const selectedSegments = [];
    const overlayerRect = overlayerElement.getBoundingClientRect();
    for (const segmentElement of document.querySelectorAll(".gyanno.segment")) {
      if (!(segmentElement instanceof HTMLElement)) {
        continue;
      }

      const segmentRect = segmentElement.getBoundingClientRect();
      const segmentCenterX =
        segmentRect.left + segmentRect.width / 2 - overlayerRect.left;
      const segmentCenterY =
        segmentRect.top + segmentRect.height / 2 - overlayerRect.top;

      if (
        selectedRect &&
        selectedRect[0] <= segmentCenterX &&
        segmentCenterX <= selectedRect[2] &&
        selectedRect[1] <= segmentCenterY &&
        segmentCenterY <= selectedRect[3]
      ) {
        segmentElement.classList.add("selected");
        selectedSegments.push({
          annotationIndex: Number(segmentElement.dataset.annotationIndex),
          text: segmentElement.textContent,
        });
      } else {
        segmentElement.classList.remove("selected");
      }
    }

    for (const annotationIndex of new Set(
      selectedSegments.map(({ annotationIndex }) => annotationIndex)
    )) {
      const lastSelectedSegmentIndex = selectedSegments
        .map(({ annotationIndex }) => annotationIndex)
        .lastIndexOf(annotationIndex);

      selectedSegments.splice(lastSelectedSegmentIndex + 1, 0, {
        annotationIndex,
        text: "\n".repeat(handleResult.annotations[annotationIndex].breakCount),
      });
    }

    selectedRectRef.current.textContent = selectedSegments
      .map(({ text }) => text)
      .join("");
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(selectedRectRef.current);
    selection.addRange(range);
  }, [handleResult, selectedRect]);

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
  // 画面遷移した直後だとimageViewerRectが0pxになることがあるため、待機する
  if (!imageViewerRect.width || !imageViewerRect.height) {
    throw new Promise((resolve) => setTimeout(resolve));
  }

  overlayerElement.style.left = `${imageViewerRect.left - imageBoxRect.left}px`;
  overlayerElement.style.top = `${imageViewerRect.top - imageBoxRect.top}px`;
  overlayerElement.style.width = `${imageViewerRect.width}px`;
  overlayerElement.style.height = `${imageViewerRect.height}px`;
  if (overlayerElement.parentNode !== imageBoxElement) {
    imageBoxElement.append(overlayerElement);
  }

  if (!handleResult) {
    return;
  }

  return (
    <>
      {handleResult.annotations.map((annotation, annotationIndex) => (
        <GyannoText
          key={annotationIndex}
          annotation={annotation}
          annotationIndex={annotationIndex}
          imageViewerRect={imageViewerRect}
          scale={handleResult.scale}
        />
      ))}

      {selectedRect && (
        <div
          ref={selectedRectRef}
          className={clsx(
            "gyanno",
            "selected-rect",
            grab && "grabbing",
            selecting && "selecting"
          )}
          style={{
            left: selectedRect[0],
            top: selectedRect[1],
            width: selectedRect[2] - selectedRect[0],
            height: selectedRect[3] - selectedRect[1],
          }}
          // 右クリック時にselectedRectのコンテキストメニューを表示させる
          onPointerDown={(event) => {
            if (event.button !== 0) {
              event.stopPropagation();
            }
          }}
        />
      )}
    </>
  );
};
createRoot(overlayerElement).render(<Overlayer />);

const GyannoText: FunctionComponent<{
  annotation: Annotation;
  annotationIndex: number;
  imageViewerRect: DOMRect;
  scale: Scale;
}> = ({ annotation, annotationIndex, imageViewerRect, scale }) => {
  const style = getStyle(annotation);
  const width = (style.width / scale.width) * imageViewerRect.width;
  const height = (style.height / scale.height) * imageViewerRect.height;

  const defaultFontSize = Math.min(width, height);
  const expected = Math.max(width, height);

  const [fontSize, setFontSize] = useState(defaultFontSize);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const element = ref.current;

    // Chrome内蔵の翻訳機能によるテキスト変更を検知する
    const mutationObserver = new MutationObserver(() => {
      element.style.fontSize = `${defaultFontSize}px`;
      element.style.letterSpacing = "0";
      const textRect = element.getBoundingClientRect();
      const actual = Math.max(textRect.width, textRect.height);

      const letterSpacing = (expected - actual) / annotation.segments.length;
      setLetterSpacing(Math.max(letterSpacing, 0));
      setFontSize(defaultFontSize + Math.min(letterSpacing, 0));
    });
    mutationObserver.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    return () => {
      mutationObserver.disconnect();
    };
  }, [annotation, defaultFontSize, expected]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const element = ref.current;

    for (const segment of annotation.segments) {
      const spanElement = document.createElement("span");
      spanElement.classList.add("gyanno", "segment");
      spanElement.dataset.annotationIndex = String(annotationIndex);
      spanElement.textContent = segment;
      element.append(spanElement);
    }

    return () => {
      element.textContent = "";
    };
  }, [annotation, annotationIndex]);

  return (
    <div
      ref={ref}
      className={clsx(
        "gyanno",
        "text",
        style.isHorizontal ? "horizontal" : "vertical"
      )}
      style={{
        left: (style.left / scale.width) * imageViewerRect.width,
        top: (style.top / scale.height) * imageViewerRect.height,
        fontSize,
        letterSpacing,
      }}
    />
  );
};

const getStyle = ({ segments, minX, minY, maxX, maxY }: Annotation) => {
  let width = maxX - minX;
  let height = maxY - minY;
  // 例えば「A」1文字だと、widthよりもheightの方が大きいため、縦書きとして判定されてしまう
  // 実際には横書きであることが多いため、1文字の場合は必ず横書きとして判定させる
  if (segments.length < 2) {
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

  const neighbor: Annotation = {
    segments: [
      ...a.segments,
      ...(getIsIntersected(0.125) ? [] : [" "]),
      ...b.segments,
    ],
    breakCount: b.breakCount,
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
