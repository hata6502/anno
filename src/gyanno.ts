// @ts-expect-error
import eaw from "eastasianwidth";

interface Annotation {
  description: string;
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
    &.text {
      position: absolute;
      color: red;
      font-family: monospace;
      font-size: 10px;
      transform-origin: top left;
      white-space: pre;

      &::selection {
        background: rgb(0, 0, 255, 0.125);
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
          const xs = boundingPoly.vertices.map(({ x }) => x);
          // @ts-expect-error
          const ys = boundingPoly.vertices.map(({ y }) => y);

          return {
            description,
            paddingCount: 0,
            breakCount: 0,
            minX: Math.min(...xs),
            minY: Math.min(...ys),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
          };
        }
      );

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

      return { annotations, scale };
    })();
  cache.set(url, annotationsPromise);
  const { annotations, scale } = await annotationsPromise;

  const imageBoxElement = document.querySelector(".image-box-component");
  if (!imageBoxElement) {
    return;
  }
  const imageBoxRect = imageBoxElement.getBoundingClientRect();

  const imageViewerRect = document
    .querySelector(".image-box-component .image-viewer")
    ?.getBoundingClientRect();
  if (!imageViewerRect || !imageViewerRect.width || !imageViewerRect.height) {
    return;
  }
  const overlayElements = annotations.flatMap((annotation) => {
    const style = getStyle(annotation);

    const boxWidth = (style.width / scale.width) * imageViewerRect.width;
    const boxHeight = (style.height / scale.height) * imageViewerRect.height;

    const boxLength = Math.max(boxWidth, boxHeight);
    const fontSize = Math.min(boxWidth, boxHeight);

    const textScale = fontSize / 10;
    const textLength = eaw.length(annotation.description) * 0.5 * fontSize;

    const textElement = document.createElement("span");

    textElement.textContent = `${annotation.description}${" ".repeat(
      annotation.paddingCount
    )}`;
    textElement.classList.add("gyanno", "text");

    textElement.style.left = `${
      (style.left / scale.width) * imageViewerRect.width -
      imageBoxRect.left +
      imageViewerRect.left +
      scrollX
    }px`;
    textElement.style.top = `${
      (style.top / scale.height) * imageViewerRect.height -
      imageBoxRect.top +
      imageViewerRect.top +
      scrollY
    }px`;

    textElement.style.letterSpacing = `${
      (boxLength - textLength) / annotation.description.length / textScale
    }px`;
    textElement.style.transform = `scale(${textScale})`;
    textElement.style.writingMode = style.isHorizontal
      ? "horizontal-tb"
      : "vertical-rl";

    const breakElement = document.createElement("span");
    breakElement.innerHTML = "<br />".repeat(annotation.breakCount);
    breakElement.classList.add("gyanno", "break");

    return [textElement, breakElement];
  });

  for (const overlayElement of overlayElements) {
    imageBoxElement.append(overlayElement);
  }
  cleanUp = () => {
    for (const overlayElement of overlayElements) {
      overlayElement.remove();
    }
  };
};

const getStyle = ({ description, minX, minY, maxX, maxY }: Annotation) => {
  let width = maxX - minX;
  let height = maxY - minY;
  if (description.length === 1) {
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

  const padding = getIsIntersected(0.5) ? "" : " ";
  const neighbor = {
    description: `${a.description}${padding}${b.description}`,
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
