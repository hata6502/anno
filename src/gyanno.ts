// Gyazo Teamsとかでは動かないかも。
// どこのページ使おうか。
//   画像ページ?
//   print?
//   Chrome Extension独自?
// 縦書きのとき、l to rになっているため複数行の選択が難しい。
// アイコンなしモード?
// ガタガタの黄色annotation修正
//   vertical-align: top;  横方向のときだけ。
//   color: transparent
//   もっと薄く

// @ts-expect-error
import eaw from "eastasianwidth";

interface Annotation {
  description: string;
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
  :root {
    /*
     * 実験なので、いったん画像以外では範囲選択できないようにする。
     * 画像内の範囲選択が乱れにくくなる。
     */
    user-select: none;
  }

  .anno {
    &.icon {
      position: absolute;
      opacity: 0.25;

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
    position: absolute;
    color: transparent;
    font-family: monospace;
    font-size: 10px;
    transform-origin: top left;
    user-select: text;
    white-space: nowrap;

    &::selection {
      background: rgb(0, 0, 255, 0.125);
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

  const imageViewerElement = document.querySelector(
    ".image-box-component .image-viewer"
  );
  if (!(imageViewerElement instanceof HTMLElement)) {
    return;
  }
  const imageViewerRect = imageViewerElement.getBoundingClientRect();
  if (!imageViewerRect.width || !imageViewerRect.height) {
    return;
  }

  const getStyle = ({
    annotation,
    scale,
  }: {
    annotation: Annotation;
    scale: Scale;
  }) => {
    let width =
      ((annotation.maxX - annotation.minX) / scale.width) *
      imageViewerRect.width;
    let height =
      ((annotation.maxY - annotation.minY) / scale.height) *
      imageViewerRect.height;
    if (annotation.description.length === 1) {
      width = height = Math.max(width, height);
    }

    return {
      left: (annotation.minX / scale.width) * imageViewerRect.width,
      top: (annotation.minY / scale.height) * imageViewerRect.height,
      width,
      height,
      fontSize: Math.min(width, height),
    };
  };

  const getNeighborAnnotation = ({
    a,
    b,
    scale,
  }: {
    a: Annotation;
    b: Annotation;
    scale: Scale;
  }) => {
    const aStyle = getStyle({ annotation: a, scale });
    const bStyle = getStyle({ annotation: b, scale });
    if (
      aStyle.left + aStyle.width + aStyle.fontSize / 2 <
        bStyle.left - bStyle.fontSize / 2 ||
      aStyle.top + aStyle.height + aStyle.fontSize / 2 <
        bStyle.top - bStyle.fontSize / 2 ||
      bStyle.left + bStyle.width + bStyle.fontSize / 2 <
        aStyle.left - aStyle.fontSize / 2 ||
      bStyle.top + bStyle.height + bStyle.fontSize / 2 <
        aStyle.top - aStyle.fontSize / 2
    ) {
      return;
    }

    const neighbor = {
      description: `${a.description}${b.description}`,
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
    };

    const neighborStyle = getStyle({ annotation: neighbor, scale });
    if (
      Math.abs(neighborStyle.fontSize - aStyle.fontSize) >=
        aStyle.fontSize / 2 ||
      Math.abs(neighborStyle.fontSize - bStyle.fontSize) >= bStyle.fontSize / 2
    ) {
      return;
    }

    return neighbor;
  };

  cleanUp?.();
  cleanUp = undefined;

  const match = location.pathname.match(/^\/([0-9a-z]{32})/);
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
        ({ description, boundingPoly }) => ({
          description,
          minX: boundingPoly.vertices[0].x,
          minY: boundingPoly.vertices[0].y,
          maxX: boundingPoly.vertices[2].x,
          maxY: boundingPoly.vertices[2].y,
        })
      );
      console.log(annotations);
      console.time("merge");

      let mergedAnnotations;
      do {
        mergedAnnotations = undefined;
        for (const [aIndex, a] of annotations.entries()) {
          for (const [bIndex, b] of annotations.slice(aIndex + 1).entries()) {
            mergedAnnotations = getNeighborAnnotation({ a, b, scale });
            if (mergedAnnotations) {
              annotations[aIndex] = mergedAnnotations;
              annotations.splice(bIndex + aIndex + 1, 1);
              break;
            }
          }
          if (mergedAnnotations) {
            break;
          }
        }
      } while (mergedAnnotations);
      console.log(annotations);
      console.timeEnd("merge");
      return { annotations, scale };
    })();
  cache.set(url, annotationsPromise);
  const { annotations, scale } = await annotationsPromise;

  // 実験なので、いったん拡大機能を止める。
  imageViewerElement.style.cursor = "unset";
  imageViewerElement.style.pointerEvents = "none";
  document.querySelector(
    ".image-box-component .image-close-btn-bg"
  ).style.display = "none";

  const divElements = annotations.map((annotation) => {
    const style = getStyle({ annotation, scale });
    const textScale = style.fontSize / 10;
    const textWidth = (eaw.length(annotation.description) / 2) * style.fontSize;

    const divElement = document.createElement("div");

    divElement.textContent = annotation.description;
    divElement.classList.add("gyanno");

    divElement.style.left = `${style.left + imageViewerRect.left + scrollX}px`;
    divElement.style.top = `${style.top + imageViewerRect.top + scrollY}px`;
    divElement.style.letterSpacing = `${
      (Math.max(style.width, style.height) - textWidth) /
      annotation.description.length /
      textScale
    }px`;
    divElement.style.transform = `scale(${textScale})`;
    divElement.style.writingMode =
      style.width >= style.height ? "horizontal-tb" : "vertical-rl";

    return divElement;
  });

  for (const divElement of divElements) {
    document.body.append(divElement);
  }
  cleanUp = () => {
    for (const divElement of divElements) {
      divElement.remove();
    }
  };
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
