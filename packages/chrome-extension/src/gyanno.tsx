import { useTranslation } from "react-controlled-translation";
import stringWidth from "string-width";

import clsx from "clsx";
import { FunctionComponent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

/** OCRによって検出された矩形領域 */
interface Annotation {
  text: string;
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
        touch-action: pinch-zoom;
      }

      &.segment {
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
        display: flex;
        align-items: center;
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
overlayerElement.translate = false;
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
  const [resize, setResize] = useState<[number, number]>();
  const [selecting, setSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<[number, number]>();
  const [selectionEnd, setSelectionEnd] = useState<[number, number]>();

  const selectedRect = useMemo<[number, number, number, number]>(
    () =>
      (selectionStart &&
        selectionEnd && [
          Math.min(selectionStart[0], selectionEnd[0]),
          Math.min(selectionStart[1], selectionEnd[1]),
          Math.max(selectionStart[0], selectionEnd[0]),
          Math.max(selectionStart[1], selectionEnd[1]),
        ]) || [-16, -16, -16, -16],
    [selectionStart, selectionEnd]
  );
  const [backupedRect, setBackupedRect] = useState(selectedRect);

  const [selectedSegmentElements, setSelectedSegmentElements] = useState<
    HTMLElement[]
  >([]);

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
                    text: description,
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

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleClick = async () => {
      if (matchMedia("(pointer: coarse)").matches) {
        await navigator.clipboard.writeText(
          selectedRectRef.current?.innerText ?? ""
        );
      }
    };
    overlayerElement.addEventListener("click", handleClick);

    const detectCursor = ([x, y]: [number, number]) => {
      const edge = matchMedia("(pointer: fine)").matches ? 4 : 8;
      const centerX = (selectedRect[0] + selectedRect[2]) / 2;
      const centerY = (selectedRect[1] + selectedRect[3]) / 2;

      if (
        selectedRect[0] + edge <= x &&
        x <= selectedRect[2] - edge &&
        selectedRect[1] + edge <= y &&
        y <= selectedRect[3] - edge
      ) {
        return "grab";
      } else if (
        x <= selectedRect[0] - edge ||
        selectedRect[2] + edge <= x ||
        y <= selectedRect[1] - edge ||
        selectedRect[3] + edge <= y
      ) {
        return "crosshair";
      } else if (x <= centerX && y <= centerY) {
        return "nw-resize";
      } else if (centerX <= x && centerY <= y) {
        return "se-resize";
      } else if (x <= centerX && centerY <= y) {
        return "sw-resize";
      } else if (centerX <= x && y <= centerY) {
        return "ne-resize";
      }
      return cursor;
    };

    const handlePointerDown = (event: PointerEvent) => {
      // 右クリックの時はGyazoのコンテキストメニューを表示させる
      if (event.button !== 0) {
        overlayerElement.style.pointerEvents = "none";
        return;
      }

      const overlayerRect = overlayerElement.getBoundingClientRect();
      const x = event.clientX - overlayerRect.left;
      const y = event.clientY - overlayerRect.top;

      const detectedCursor = detectCursor([x, y]);
      setCursor(detectedCursor);

      switch (detectedCursor) {
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
          setResize([x, y]);
          break;
        }

        case "grabbing":
        case "wait": {
          break;
        }

        default: {
          throw new Error(
            `Unexpected cursor: ${detectedCursor satisfies never}`
          );
        }
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);

    const handlePointerMove = (event: PointerEvent) => {
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
      } else if (resize) {
        const deltaX = x - resize[0];
        const deltaY = y - resize[1];

        const nextSelectedRect = [...selectedRect];
        switch (cursor) {
          case "nw-resize": {
            nextSelectedRect[0] += deltaX;
            nextSelectedRect[1] += deltaY;

            if (selectedRect[2] <= nextSelectedRect[0]) {
              setCursor("ne-resize");
            } else if (selectedRect[3] <= nextSelectedRect[1]) {
              setCursor("sw-resize");
            }
            break;
          }

          case "se-resize": {
            nextSelectedRect[2] += deltaX;
            nextSelectedRect[3] += deltaY;

            if (nextSelectedRect[2] <= selectedRect[0]) {
              setCursor("sw-resize");
            } else if (nextSelectedRect[3] <= selectedRect[1]) {
              setCursor("ne-resize");
            }
            break;
          }

          case "sw-resize": {
            nextSelectedRect[0] += deltaX;
            nextSelectedRect[3] += deltaY;

            if (selectedRect[2] <= nextSelectedRect[0]) {
              setCursor("se-resize");
            } else if (nextSelectedRect[3] <= selectedRect[1]) {
              setCursor("nw-resize");
            }
            break;
          }

          case "ne-resize": {
            nextSelectedRect[2] += deltaX;
            nextSelectedRect[1] += deltaY;

            if (nextSelectedRect[2] <= selectedRect[0]) {
              setCursor("nw-resize");
            } else if (selectedRect[3] <= nextSelectedRect[1]) {
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

        setResize([x, y]);
      } else {
        setCursor(detectCursor([x, y]));
      }
    };
    document.addEventListener("pointermove", handlePointerMove);

    const reset = () => {
      if (grab) {
        setCursor("grab");
      }

      setGrab(undefined);
      setSelecting(false);
      setResize(undefined);
    };

    const handlePointerUp = () => {
      reset();
      setBackupedRect(selectedRect);
    };
    document.addEventListener("pointerup", handlePointerUp);

    const handlePointerCancel = () => {
      reset();
      setSelectionStart([backupedRect[0], backupedRect[1]]);
      setSelectionEnd([backupedRect[2], backupedRect[3]]);
    };
    document.addEventListener("pointercancel", handlePointerCancel);

    const handleSelectionChange = () => {
      if (
        matchMedia("(pointer: fine)").matches &&
        selection.containsNode(selectAllDetectorElement, true)
      ) {
        const overlayerRect = overlayerElement.getBoundingClientRect();
        setSelectionStart([0, 0]);
        setSelectionEnd([overlayerRect.width, overlayerRect.height]);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCursor("crosshair");
        setSelectionStart([-16, -16]);
        setSelectionEnd([-16, -16]);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      overlayerElement.removeEventListener("click", handleClick);

      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerCancel);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [backupedRect, cursor, grab, resize, selectedRect, selecting]);

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
    if (matchMedia("(pointer: fine)").matches && selectedText) {
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
          annotation={annotation}
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
            (grab || selecting || resize) && "selecting"
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

  const translatedText = useTranslation(annotation.text);
  const segments = useMemo(
    () =>
      [...new Intl.Segmenter().segment(translatedText)].map(
        ({ segment }) => segment
      ),
    [translatedText]
  );

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const element = ref.current;

    for (const segment of segments) {
      const spanElement = document.createElement("span");
      spanElement.classList.add("gyanno", "segment");
      spanElement.dataset.annotationIndex = String(annotationIndex);
      spanElement.textContent = segment;
      element.append(spanElement);
    }

    return () => {
      element.textContent = "";
    };
  }, [annotationIndex, segments]);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    ref.current.style.letterSpacing = "0";
    ref.current.style.fontSize = `${defaultFontSize}px`;
    ref.current.style.width = "";
    ref.current.style.height = "";
    const textRect = ref.current.getBoundingClientRect();
    const actual = Math.max(textRect.width, textRect.height);

    ref.current.style.letterSpacing = `${
      Math.max(expected - actual, 0) / segments.length
    }px`;
    ref.current.style.fontSize = `${
      defaultFontSize * Math.min(expected / actual, 1)
    }px`;
    ref.current.style.width = `${width}px`;
    ref.current.style.height = `${height}px`;
  }, [defaultFontSize, expected, segments]);

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
      }}
    />
  );
};

const getStyle = ({ text, minX, minY, maxX, maxY }: Annotation) => {
  const width = maxX - minX;
  const height = maxY - minY;
  // 例えば「it」2文字だと、widthよりもheightの方が大きいため、縦書きとして判定されてしまう
  // 実際には横書きであることが多いため、2文字以下の場合は横書きとして判定させる
  const isHorizontal = stringWidth(text) < 3 || width >= height;
  return {
    left: minX,
    top: minY,
    width,
    height,
    isHorizontal,
    size: isHorizontal ? height : width,
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

  const insertsLatinSpace =
    stringWidth(
      [...new Intl.Segmenter().segment(a.text)].at(-1)?.segment ?? ""
    ) < 2 &&
    stringWidth(
      [...new Intl.Segmenter().segment(b.text)].at(0)?.segment ?? ""
    ) < 2 &&
    !getIsIntersected(0.0625);

  const neighbor: Annotation = {
    text: `${a.text}${insertsLatinSpace ? " " : ""}${b.text}`,
    breakCount: b.breakCount,
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };

  const neighborStyle = getStyle(neighbor);
  if (
    (neighborStyle.size - aStyle.size) / aStyle.size >= 0.5 ||
    (neighborStyle.size - bStyle.size) / bStyle.size >= 0.5
  ) {
    return;
  }

  return neighbor;
};
