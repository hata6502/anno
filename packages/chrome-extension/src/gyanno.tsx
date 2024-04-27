import { FunctionComponent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

interface Annotation {
  segments: string[];
  paddingCount: number;
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
        user-select: text;
      }

      &.text {
        position: absolute;
        color: transparent;
        cursor: auto;
        font-family: monospace;
        white-space: pre;

        &.horizontal {
          writing-mode: horizontal-tb;
        }

        &.vertical {
          writing-mode: vertical-rl;
        }

        &::selection {
          background: #ccccff;
          color: #000000;
        }
      }

      &.break {
        visibility: hidden;
      }
    }
  }
`;
document.head.append(styleElement);

const cache = new Map<
  string,
  Promise<{ annotations: Annotation[]; scale: Scale } | undefined>
>();

const selection = getSelection();
if (!selection) {
  throw new Error("No selection");
}

document.addEventListener("selectionchange", () => {
  const containsOverlayer = selection.containsNode(overlayerElement, true);
  document.body.style.userSelect = containsOverlayer ? "none" : "";
});

const overlayerElement = document.createElement("div");
overlayerElement.classList.add("gyanno", "overlayer");
overlayerElement.addEventListener("click", (event) => {
  // Prevent zooming out.
  event.stopPropagation();
});

const Overlayer: FunctionComponent = () => {
  const [handleResult, setHandleResult] = useState<{
    annotations: Annotation[];
    scale: Scale;
  }>();
  const [, setRenderCount] = useState(0);

  useEffect(() => {
    const handle = async () => {
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
                      segments: [
                        ...new Intl.Segmenter().segment(description),
                      ].map((segment) => segment.segment),
                      paddingCount: 0,
                      breakCount: 0,
                      minX: Math.min(...xs),
                      minY: Math.min(...ys),
                      maxX: Math.max(...xs),
                      maxY: Math.max(...ys),
                    };
                  }
                );

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

                const breakCount = Math.min(
                  Math.floor(
                    Math.abs(
                      (aStyle.isHorizontal
                        ? bStyle.top - aStyle.top
                        : aStyle.left +
                          aStyle.width -
                          (bStyle.left + bStyle.width)) / aStyle.size
                    )
                  ),
                  2
                );
                a.breakCount = breakCount;

                if (!breakCount) {
                  a.paddingCount = Math.min(
                    Math.floor(
                      Math.abs(
                        (aStyle.isHorizontal
                          ? bStyle.left - (aStyle.left + aStyle.width)
                          : bStyle.top - (aStyle.top + aStyle.height)) /
                          aStyle.size
                      )
                    ),
                    2
                  );
                }
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

  return handleResult.annotations.map((annotation, annotationIndex) => (
    <GyannoText
      key={`${annotationIndex}-${imageViewerRect.width}-${imageViewerRect.height}-${handleResult.scale.width}-${handleResult.scale.height}`}
      annotation={annotation}
      imageViewerRect={imageViewerRect}
      scale={handleResult.scale}
    />
  ));
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
  const segmentLength = annotation.segments.length;
  const defaultFontSize = Math.min(width, height);

  const [fontSize, setFontSize] = useState(defaultFontSize);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    const textRect = ref.current.getBoundingClientRect();
    const expected = Math.max(width, height);
    const actual = Math.max(textRect.width, textRect.height);

    const letterSpacing = (expected - actual) / segmentLength;
    setFontSize(defaultFontSize + Math.min(letterSpacing, 0));
    setLetterSpacing(Math.max(letterSpacing, 0));
  }, [height, segmentLength, width]);

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
      {annotation.segments.join("")}
      {" ".repeat(annotation.paddingCount)}

      {[...Array(annotation.breakCount).keys()].map((breakIndex) => (
        <br key={breakIndex} className="gyanno break" />
      ))}
    </span>
  );
};

const getStyle = ({ segments, minX, minY, maxX, maxY }: Annotation) => {
  let width = maxX - minX;
  let height = maxY - minY;
  if (segments.length === 1) {
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
    segments: [
      ...a.segments,
      ...(getIsIntersected(0.25) ? [] : [" "]),
      ...b.segments,
    ],
    paddingCount: 0,
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
