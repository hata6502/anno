// @ts-expect-error
import eaw from "eastasianwidth";

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
  .anno {
    &.icon {
      position: absolute;
      opacity: 0.5;

      &:active, &:focus, &:hover {
        opacity: unset;
      }
    }

    &.marker {
      background: rgb(255, 255, 0, 0.25);
      color: transparent;
    }
  }

  .gyanno {
    &.overlay {
      position: absolute;
      font-family: monospace;
      font-size: 10px;
      transform-origin: top left;
      white-space: pre;
    }

    &.break {
      position: absolute;
      visibility: hidden;
    }

    &.segment {
      color: transparent;

      &::selection {
        background: rgb(0, 0, 255, 0.25);
      }
    }
  }
`;
document.head.append(styleElement);

const cache = new Map<
  string,
  Promise<{ annotations: Annotation[]; scale: Scale }>
>();
let cleanUp: (() => void) | undefined;
const gyanno = async () => {
  const selection = getSelection();
  if (!selection || !selection.isCollapsed) {
    return;
  }

  cleanUp?.();
  cleanUp = undefined;

  const match = location.pathname.match(/^\/([0-9a-z]{32})$/);
  if (!match) {
    return;
  }
  const url = `https://gyazo.com/${encodeURIComponent(match[1])}.json`;
  const annotationsPromise =
    cache.get(url) ??
    (async () => {
      const response = await fetch(url);
      const { scale, metadata } = await response.json();

      const annotations: Annotation[] = (metadata.ocrAnnotations ?? []).map(
        // @ts-expect-error
        ({ description, boundingPoly }) => {
          // @ts-expect-error
          const xs = boundingPoly.vertices.map(({ x }) => x ?? 0);
          // @ts-expect-error
          const ys = boundingPoly.vertices.map(({ y }) => y ?? 0);

          return {
            segments: [...new Intl.Segmenter().segment(description)].map(
              (segment) => segment.segment
            ),
            paddingCount: 0,
            breakCount: 0,
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
          };
        }
      );
      console.log(annotations.length);
      console.time("optimize");

      let mergedAnnotation;
      do {
        mergedAnnotation = undefined;
        for (const [aIndex, a] of annotations.slice(0, -1).entries()) {
          const bIndex = aIndex + 1;
          const b = annotations[bIndex];

          mergedAnnotation = getNeighborAnnotation(a, b);
          if (mergedAnnotation) {
            annotations[aIndex] = mergedAnnotation;
            annotations.splice(bIndex, 1);
            break;
          }
        }
      } while (mergedAnnotation);

      for (const [aIndex, a] of annotations.slice(0, -1).entries()) {
        const b = annotations[aIndex + 1];

        const aStyle = getStyle(a);
        const bStyle = getStyle(b);

        const breakCount = Math.round(
          Math.abs(
            (aStyle.isHorizontal
              ? bStyle.top - aStyle.top
              : aStyle.left + aStyle.width - (bStyle.left + bStyle.width)) /
              aStyle.size
          )
        );
        a.breakCount = breakCount;

        if (!breakCount) {
          a.paddingCount = Math.round(
            Math.abs(
              (aStyle.isHorizontal
                ? bStyle.left - (aStyle.left + aStyle.width)
                : bStyle.top - (aStyle.top + aStyle.height)) / aStyle.size
            )
          );
        }
      }

      console.timeEnd("optimize");
      console.log(annotations.length);
      return { annotations, scale };
    })();
  cache.set(url, annotationsPromise);
  const { annotations, scale } = await annotationsPromise;

  const imageBoxElement = document.querySelector(".image-box-component");
  if (!imageBoxElement) {
    return;
  }
  const imageBoxRect = imageBoxElement.getBoundingClientRect();

  const imageViewerElement = document.querySelector(
    ".image-box-component .image-viewer"
  );
  if (!imageViewerElement) {
    return;
  }
  const imageViewerRect = imageViewerElement.getBoundingClientRect();
  if (!imageViewerRect.width || !imageViewerRect.height) {
    return;
  }

  const overlayElements: Element[] = [];
  const segmentElements: HTMLElement[] = [];
  for (const annotation of annotations) {
    const style = getStyle(annotation);

    const boxWidth = (style.width / scale.width) * imageViewerRect.width;
    const boxHeight = (style.height / scale.height) * imageViewerRect.height;

    const boxLength = Math.max(boxWidth, boxHeight);
    const fontSize = Math.min(boxWidth, boxHeight);

    const textScale = fontSize / 10;
    const textLength =
      eaw.length(annotation.segments.join("")) * 0.5 * fontSize;

    const overlayElement = document.createElement("span");
    overlayElement.classList.add("gyanno", "overlay");

    overlayElement.style.left = `${
      (style.left / scale.width) * imageViewerRect.width +
      imageViewerRect.left -
      imageBoxRect.left
    }px`;
    overlayElement.style.top = `${
      (style.top / scale.height) * imageViewerRect.height +
      imageViewerRect.top -
      imageBoxRect.top
    }px`;

    overlayElement.style.letterSpacing = `${
      (boxLength - textLength) / annotation.segments.length / textScale
    }px`;
    overlayElement.style.transform = `scale(${textScale})`;
    overlayElement.style.writingMode = style.isHorizontal
      ? "horizontal-tb"
      : "vertical-rl";

    for (const segment of [
      ...annotation.segments,
      ...Array(annotation.paddingCount).map(() => " "),
    ]) {
      const segmentElement = document.createElement("span");
      segmentElement.textContent = segment;
      segmentElement.classList.add("gyanno", "segment");

      segmentElement.addEventListener("pointerdown", () => {
        if (segmentElement.style.userSelect !== "none") {
          return;
        }

        selection.removeAllRanges();
      });

      overlayElement.append(segmentElement);
      segmentElements.push(segmentElement);
    }

    const breakElement = document.createElement("span");
    breakElement.innerHTML = "<br />".repeat(annotation.breakCount);
    breakElement.classList.add("gyanno", "break");
    overlayElement.append(breakElement);

    overlayElements.push(overlayElement);
  }
  for (const overlayElement of overlayElements) {
    imageBoxElement.append(overlayElement);
  }

  const handleSelectionchange = () => {
    const isSegmentSelected = segmentElements.some((segmentElement) =>
      selection.containsNode(segmentElement, true)
    );
    document.body.style.userSelect = isSegmentSelected ? "none" : "";

    let isPrevSelected = !isSegmentSelected;
    for (const segmentElement of segmentElements) {
      isPrevSelected ||= selection.containsNode(segmentElement, true);
      segmentElement.style.userSelect = isPrevSelected ? "text" : "none";
    }
  };

  document.addEventListener("selectionchange", handleSelectionchange);
  handleSelectionchange();

  cleanUp = () => {
    for (const overlayElement of overlayElements) {
      overlayElement.remove();
    }

    document.removeEventListener("selectionchange", handleSelectionchange);
  };
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

  if (!getIsIntersected(1)) {
    return;
  }

  const neighbor = {
    segments: [
      ...a.segments,
      ...(getIsIntersected(0.5) ? [] : [" "]),
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

const handle = async () => {
  mutationObserver.disconnect();
  try {
    await gyanno();
  } finally {
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
};
const mutationObserver = new MutationObserver(handle);
new ResizeObserver(handle).observe(document.body);

export {};
