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
    .image-viewer {
      user-select: none;
    }

    .anno {
      &.icon {
        opacity: 0.75;

        &:active, &:focus, &:hover {
          opacity: unset;
        }
      }

      &.marker {
        color: transparent;
        opacity: 0.25;

        &::selection {
          background: rgb(0, 0, 255);
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
        overflow: hidden;
        white-space: pre;

        &.horizontal {
          writing-mode: horizontal-tb;
        }

        &.vertical {
          writing-mode: vertical-rl;
        }

        &::selection {
          background: rgb(0, 0, 255, 0.25);
        }
      }

      &.break {
        visibility: hidden;
      }
    }

    .gyanno.text.horizontal .anno.marker {
      vertical-align: top;
    }

    .gyanno.text.vertical .anno.marker {
      vertical-align: bottom;
    }
  }
`;
document.head.append(styleElement);

const cache = new Map<
  string,
  Promise<{ annotations: Annotation[]; scale: Scale } | undefined>
>();
const gyanno = async () => {
  const selection = getSelection();
  if (!selection) {
    return;
  }

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

      const annotations: Annotation[] = json.metadata.ocrAnnotations.map(
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

      for (const annotation of annotations) {
        const style = getStyle(annotation);

        annotation.minX -= style.size / 4;
        annotation.minY -= style.size / 4;
        annotation.maxX += style.size / 4;
        annotation.maxY += style.size / 4;
      }

      return { annotations, scale: json.scale };
    })();
  cache.set(url, fetching);
  const response = await fetching;
  if (!response) {
    return;
  }
  const { annotations, scale } = response;

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
  if (!imageViewerRect.width || !imageViewerRect.height) {
    return;
  }

  const handleSelectionchange = () => {
    const containsOverlayer = selection.containsNode(overlayerElement, true);
    document.body.style.userSelect = containsOverlayer ? "none" : "";
  };
  document.addEventListener("selectionchange", handleSelectionchange);

  const overlayerElement = document.createElement("div");
  overlayerElement.classList.add("gyanno", "overlayer");
  overlayerElement.style.left = `${imageViewerRect.left - imageBoxRect.left}px`;
  overlayerElement.style.top = `${imageViewerRect.top - imageBoxRect.top}px`;
  imageBoxElement.append(overlayerElement);

  for (const annotation of annotations) {
    const style = getStyle(annotation);
    const width = (style.width / scale.width) * imageViewerRect.width;
    const height = (style.height / scale.height) * imageViewerRect.height;

    const textElement = document.createElement("span");
    textElement.textContent = `${annotation.segments.join("")}${" ".repeat(
      annotation.paddingCount
    )}`;
    textElement.classList.add(
      "gyanno",
      "text",
      style.isHorizontal ? "horizontal" : "vertical"
    );

    textElement.style.left = `${
      (style.left / scale.width) * imageViewerRect.width
    }px`;
    textElement.style.top = `${
      (style.top / scale.height) * imageViewerRect.height
    }px`;
    textElement.style.fontSize = textElement.style.lineHeight = `${Math.min(
      width,
      height
    )}px`;

    textElement.addEventListener("click", (event) => {
      // Prevent zooming out.
      event.stopPropagation();
    });

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

  return () => {
    document.removeEventListener("selectionchange", handleSelectionchange);
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

let cleanUp: (() => void) | undefined;
const handle = async () => {
  mutationObserver.disconnect();
  try {
    const nextCleanUp = await gyanno();
    cleanUp?.();
    cleanUp = nextCleanUp;
  } finally {
    // Prevent infinite loop.
    setTimeout(() => {
      mutationObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
  }
};
const mutationObserver = new MutationObserver(handle);
new ResizeObserver(handle).observe(document.body);

export {};
