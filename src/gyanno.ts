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
    &.flickering-preventer {
      position: absolute;
      width: 16px;
      height: 16px;
      background: rgb(255, 0, 0, 0.25);
    }

    &.overlay {
      position: absolute;
      color: transparent;
      font-family: monospace;
      white-space: pre;
      z-index: 1;

      &::selection {
        background: rgb(0, 0, 255, 0.25);
      }
    }

    &.break {
      position: absolute;
      visibility: hidden;
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

  let isSelectingByPointer = false;
  const flickeringPreventerElement = document.createElement("div");
  flickeringPreventerElement.classList.add("gyanno", "flickering-preventer");

  const overlayElements = annotations.map((annotation) => {
    const style = getStyle(annotation);

    const boxWidth = (style.width / scale.width) * imageViewerRect.width;
    const boxHeight = (style.height / scale.height) * imageViewerRect.height;

    const boxLength = Math.max(boxWidth, boxHeight);
    const fontSize = Math.max(Math.min(boxWidth, boxHeight), 10);
    const textLength =
      eaw.length(annotation.segments.join("")) * 0.5 * fontSize;

    const overlayElement = document.createElement("span");
    overlayElement.textContent = `${annotation.segments.join("")}${" ".repeat(
      annotation.paddingCount
    )}`;
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

    overlayElement.style.fontSize = `${fontSize}px`;
    overlayElement.style.letterSpacing = `${
      (boxLength - textLength) / annotation.segments.length
    }px`;
    overlayElement.style.writingMode = style.isHorizontal
      ? "horizontal-tb"
      : "vertical-rl";

    overlayElement.addEventListener("mousedown", () => {
      isSelectingByPointer = true;
    });

    overlayElement.addEventListener("mouseleave", (event) => {
      if (!isSelectingByPointer) {
        return;
      }

      const overlayRect = overlayElement.getBoundingClientRect();

      const isPrev = style.isHorizontal
        ? event.clientX < overlayRect.left + overlayRect.width / 2
        : event.clientY < overlayRect.top + overlayRect.height / 2;

      imageBoxElement.insertBefore(
        flickeringPreventerElement,
        isPrev ? overlayElement : overlayElement.nextSibling
      );
    });

    const breakElement = document.createElement("span");
    breakElement.innerHTML = "<br />".repeat(annotation.breakCount);
    breakElement.classList.add("gyanno", "break");
    overlayElement.append(breakElement);

    return overlayElement;
  });
  for (const overlayElement of overlayElements) {
    imageBoxElement.append(overlayElement);
  }

  const handleBodyPointermove = (event) => {
    flickeringPreventerElement.style.left = `${
      event.clientX - imageBoxRect.left - 8
    }px`;
    flickeringPreventerElement.style.top = `${
      event.clientY - imageBoxRect.top - 8
    }px`;
  };
  document.body.addEventListener("mousemove", handleBodyPointermove);

  const handleBodyPointerup = () => {
    isSelectingByPointer = false;
  };
  document.body.addEventListener("mouseup", handleBodyPointerup);

  cleanUp = () => {
    document.body.removeEventListener("mouseup", handleBodyPointerup);
    document.body.removeEventListener("mousemove", handleBodyPointermove);
    for (const overlayElement of overlayElements) {
      overlayElement.remove();
    }
    flickeringPreventerElement.remove();
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
