import { useTranslation } from "react-safe-translation";

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

interface Result {
  annotations: Annotation[];
  scale: Scale;
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
        overflow: hidden;
      }

      &.segment {
        /* selected-backgroundに余白を作るため */
        display: inline-block;

        &.selected {
          color: #000000;
        }
      }

      &.selected-background {
        position: absolute;
        background: #cceeff;
      }

      &.selected-rect {
        position: absolute;
        border: 1px solid #ffffff;
        font-size: 0;
        outline: 1px dotted #000000;
        outline-offset: -1px;
    
        &.selecting {
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

const cache = new Map<string, Promise<Result | null | undefined>>();

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
  const [cursor, setCursor] = useState<
    | "crosshair"
    | "grab"
    | "grabbing"
    | "wait"
    | "nw-resize"
    | "se-resize"
    | "sw-resize"
    | "ne-resize"
  >("crosshair");
  const [result, setResult] = useState<Result | null>();
  const [, setRenderCount] = useState(0);

  const [grab, setGrab] = useState<[number, number]>();
  const [selecting, setSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<[number, number]>();
  const [selectionEnd, setSelectionEnd] = useState<[number, number]>();
  const [selectedSegmentElements, setSelectedSegmentElements] = useState<
    HTMLElement[]
  >([]);
  const [resizing, setResizing] = useState(false);

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

      setResult(
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
              setCursor("wait");
              try {
                while (true) {
                  const response = await fetch(url);
                  if (!response.ok) {
                    throw new Error(response.statusText);
                  }
                  json = await response.json();

                  if (!json.metadata || json.has_mp4) {
                    return null;
                  }
                  if (json.metadata.ocrAnnotations) {
                    break;
                  }
                  if (json.metadata.ocr?.processed) {
                    return null;
                  }
                  await new Promise((resolve) => setTimeout(resolve, 5000));
                }
              } finally {
                setCursor("crosshair");
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

      switch (cursor) {
        case "crosshair": {
          setSelecting(true);
          setSelectionStart([x, y]);
          setSelectionEnd([x, y]);
          break;
        }

        case "grab": {
          setGrab([x, y]);
          setCursor("grabbing");
          break;
        }

        case "nw-resize":
        case "se-resize":
        case "sw-resize":
        case "ne-resize": {
          setResizing(true);
          break;
        }

        case "grabbing":
        case "wait":
          break;

        default:
          throw new Error(`Unexpected cursor: ${cursor satisfies never}`);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);

    const handlePointerMove = (event: PointerEvent) => {
      if (!selectedRect) {
        return;
      }

      overlayerElement.style.pointerEvents = "";

      const overlayerRect = overlayerElement.getBoundingClientRect();
      const x = event.clientX - overlayerRect.left;
      const y = event.clientY - overlayerRect.top;

      if (grab) {
        const deltaX = x - grab[0];
        const deltaY = y - grab[1];
        setSelectionStart([selectedRect[0] + deltaX, selectedRect[1] + deltaY]);
        setSelectionEnd([selectedRect[2] + deltaX, selectedRect[3] + deltaY]);

        setGrab([x, y]);
      } else if (selecting) {
        setSelectionEnd([x, y]);
      } else if (resizing) {
        const nextSelectedRect = [...selectedRect];
        switch (cursor) {
          case "nw-resize": {
            nextSelectedRect[0] = x;
            nextSelectedRect[1] = y;

            if (selectedRect[2] <= x) {
              setCursor("ne-resize");
            } else if (selectedRect[3] <= y) {
              setCursor("sw-resize");
            }
            break;
          }

          case "se-resize": {
            nextSelectedRect[2] = x;
            nextSelectedRect[3] = y;

            if (x <= selectedRect[0]) {
              setCursor("sw-resize");
            } else if (y <= selectedRect[1]) {
              setCursor("ne-resize");
            }
            break;
          }

          case "sw-resize": {
            nextSelectedRect[0] = x;
            nextSelectedRect[3] = y;

            if (selectedRect[2] <= x) {
              setCursor("se-resize");
            } else if (y <= selectedRect[1]) {
              setCursor("nw-resize");
            }
            break;
          }

          case "ne-resize": {
            nextSelectedRect[2] = x;
            nextSelectedRect[1] = y;

            if (x <= selectedRect[0]) {
              setCursor("nw-resize");
            } else if (selectedRect[3] <= y) {
              setCursor("se-resize");
            }
            break;
          }

          case "crosshair":
          case "grab":
          case "grabbing":
          case "wait":
            break;

          default:
            throw new Error(`Unexpected cursor: ${cursor satisfies never}`);
        }

        setSelectionStart([nextSelectedRect[0], nextSelectedRect[1]]);
        setSelectionEnd([nextSelectedRect[2], nextSelectedRect[3]]);
      } else {
        const edge = 8;
        const centerX = (selectedRect[0] + selectedRect[2]) / 2;
        const centerY = (selectedRect[1] + selectedRect[3]) / 2;

        if (
          selectedRect[0] + edge <= x &&
          x <= selectedRect[2] - edge &&
          selectedRect[1] + edge <= y &&
          y <= selectedRect[3] - edge
        ) {
          setCursor("grab");
        } else if (
          x <= selectedRect[0] - edge ||
          selectedRect[2] + edge <= x ||
          y <= selectedRect[1] - edge ||
          selectedRect[3] + edge <= y
        ) {
          setCursor("crosshair");
        } else if (x <= centerX && y <= centerY) {
          setCursor("nw-resize");
        } else if (centerX <= x && centerY <= y) {
          setCursor("se-resize");
        } else if (x <= centerX && centerY <= y) {
          setCursor("sw-resize");
        } else if (centerX <= x && y <= centerY) {
          setCursor("ne-resize");
        }
      }
    };
    document.addEventListener("pointermove", handlePointerMove);

    const handlePointerUp = () => {
      if (grab) {
        setCursor("grab");
      }

      setGrab(undefined);
      setSelecting(false);
      setResizing(false);
    };
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [cursor, grab, resizing, selectedRect, selecting]);

  useEffect(() => {
    if (!result || !selectedRectRef.current) {
      return;
    }

    const selectedSegmentElements = [];
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
        selectedSegmentElements.push(segmentElement);
      } else {
        segmentElement.classList.remove("selected");
      }
    }
    setSelectedSegmentElements(selectedSegmentElements);

    const selectedTexts = selectedSegmentElements.map(
      (segmentElement) => segmentElement.textContent
    );
    const selectedAnnotationIndexes = selectedSegmentElements.map(
      (segmentElement) => Number(segmentElement.dataset.annotationIndex)
    );
    for (const annotationIndex of new Set(selectedAnnotationIndexes)) {
      selectedTexts.splice(
        selectedAnnotationIndexes.lastIndexOf(annotationIndex) + 1,
        0,
        "\n".repeat(result.annotations[annotationIndex].breakCount)
      );
    }
    const selectedText = selectedTexts.join("");

    selectedRectRef.current.innerText = selectedText;
    // imageViewer外では、Web標準のテキスト選択を使えるようにする
    if (selectedText) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(selectedRectRef.current);
      selection.addRange(range);
    }
  }, [result, selectedRect]);

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

  overlayerElement.style.display = result === null ? "none" : "";
  overlayerElement.style.left = `${imageViewerRect.left - imageBoxRect.left}px`;
  overlayerElement.style.top = `${imageViewerRect.top - imageBoxRect.top}px`;
  overlayerElement.style.width = `${imageViewerRect.width}px`;
  overlayerElement.style.height = `${imageViewerRect.height}px`;
  overlayerElement.style.cursor = cursor;
  if (overlayerElement.parentNode !== imageBoxElement) {
    imageBoxElement.append(overlayerElement);
  }

  if (!result) {
    return;
  }

  return (
    <>
      {selectedSegmentElements.map((segmentElement, segmentElementIndex) => {
        const segmentRect = segmentElement.getBoundingClientRect();
        return (
          <div
            key={segmentElementIndex}
            className="gyanno selected-background"
            style={{
              left: segmentRect.left - imageViewerRect.left,
              top: segmentRect.top - imageViewerRect.top,
              width: segmentRect.width,
              height: segmentRect.height,
            }}
          />
        );
      })}

      {result.annotations.map((annotation, annotationIndex) => (
        <GyannoText
          key={annotationIndex}
          defaultAnnotation={annotation}
          annotationIndex={annotationIndex}
          imageViewerRect={imageViewerRect}
          scale={result.scale}
        />
      ))}

      {selectedRect && (
        <div
          ref={selectedRectRef}
          className={clsx(
            "gyanno",
            "selected-rect",
            (grab || selecting || resizing) && "selecting"
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
  defaultAnnotation: Annotation;
  annotationIndex: number;
  imageViewerRect: DOMRect;
  scale: Scale;
}> = ({ defaultAnnotation, annotationIndex, imageViewerRect, scale }) => {
  const translatedText = useTranslation(defaultAnnotation.segments.join(""));
  const [annotation, setAnnotation] = useState(defaultAnnotation);
  useEffect(() => {
    setAnnotation((annotation) => ({
      ...annotation,
      segments: [...new Intl.Segmenter().segment(translatedText)].map(
        ({ segment }) => segment
      ),
    }));
  }, [translatedText]);

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

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    ref.current.style.fontSize = `${defaultFontSize}px`;
    ref.current.style.letterSpacing = "0";
    const textRect = ref.current.getBoundingClientRect();
    const actual = Math.max(textRect.width, textRect.height);

    const letterSpacing = (expected - actual) / annotation.segments.length;
    setLetterSpacing(Math.max(letterSpacing, 0));
    setFontSize(defaultFontSize + Math.min(letterSpacing, 0));
  }, [annotation, defaultFontSize, expected]);

  return (
    <div
      ref={ref}
      translate="no"
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
  // 例えば「it」2文字だと、widthよりもheightの方が大きいため、縦書きとして判定されてしまう
  // 実際には横書きであることが多いため、2文字以下の場合は横書きとして判定させる
  if (segments.length < 3) {
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
