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
    &.overlayer {
      position: absolute;
    }

    &.text {
      position: absolute;
      color: transparent;
      white-space: pre;

      &::selection {
        background: rgb(0, 0, 255, 0.25);
      }
    }

    &.break {
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

      for (let aIndex = 1; aIndex < annotations.length; aIndex++) {
        const b = annotations[aIndex - 1];
        const bRect = [
          [b.minX, b.minY],
          [b.maxX, b.minY],
          [b.maxX, b.maxY],
          [b.minX, b.maxY],
        ];

        const distances = annotations.slice(aIndex).map((a) => {
          const aRect = [
            [a.minX, a.minY],
            [a.maxX, a.minY],
            [a.maxX, a.maxY],
            [a.minX, a.maxY],
          ];
          return Math.min(
            ...aRect.flatMap(([ax, ay]) =>
              bRect.map(([bx, by]) => Math.hypot(ax - bx, ay - by))
            )
          );
        });

        const minIndex = distances.indexOf(Math.min(...distances)) + aIndex;
        [annotations[aIndex], annotations[minIndex]] = [
          annotations[minIndex],
          annotations[aIndex],
        ];
      }

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

  const overlayerElement = document.createElement("div");
  overlayerElement.classList.add("gyanno", "overlayer");
  overlayerElement.style.left = `${imageViewerRect.left - imageBoxRect.left}px`;
  overlayerElement.style.top = `${imageViewerRect.top - imageBoxRect.top}px`;
  overlayerElement.style.width = `${imageViewerRect.width}px`;
  overlayerElement.style.height = `${imageViewerRect.height}px`;
  imageBoxElement.append(overlayerElement);

  for (const annotation of annotations) {
    const style = getStyle(annotation);
    const width = (style.width / scale.width) * imageViewerRect.width;
    const height = (style.height / scale.height) * imageViewerRect.height;

    const textElement = document.createElement("span");
    textElement.textContent = `${annotation.segments.join("")}${" ".repeat(
      annotation.paddingCount
    )}`;
    textElement.classList.add("gyanno", "text");

    textElement.style.left = `${
      (style.left / scale.width) * imageViewerRect.width
    }px`;
    textElement.style.top = `${
      (style.top / scale.height) * imageViewerRect.height
    }px`;
    textElement.style.fontSize = `${Math.min(width, height)}px`;
    textElement.style.writingMode = style.isHorizontal
      ? "horizontal-tb"
      : "vertical-rl";

    overlayerElement.append(textElement);

    const textRect = textElement.getBoundingClientRect();
    textElement.style.letterSpacing = `${
      (Math.max(width, height) - Math.max(textRect.width, textRect.height)) /
      annotation.segments.length
    }px`;

    for (const _break of Array(annotation.breakCount)) {
      const breakElement = document.createElement("br");
      breakElement.classList.add("gyanno", "break");
      overlayerElement.append(breakElement);
    }
  }

  cleanUp = () => {
    overlayerElement.remove();
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
