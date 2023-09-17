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
    position: absolute;
    color: red;
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

    const padding = getIsIntersected(0.25) ? "" : " ";
    const neighbor = {
      description: `${a.description}${padding}${b.description}`,
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
      console.time("merge");

      let mergedAnnotations;
      do {
        mergedAnnotations = undefined;
        for (const [aIndex, a] of annotations.slice(0, -1).entries()) {
          const bIndex = aIndex + 1;
          const b = annotations[bIndex];

          mergedAnnotations = getNeighborAnnotation(a, b);
          if (mergedAnnotations) {
            annotations[aIndex] = mergedAnnotations;
            annotations.splice(bIndex, 1);
            break;
          }
        }
      } while (mergedAnnotations);
      console.log(annotations.length);
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
    const style = getStyle(annotation);

    const boxWidth = (style.width / scale.width) * imageViewerRect.width;
    const boxHeight = (style.height / scale.height) * imageViewerRect.height;

    const boxLength = Math.max(boxWidth, boxHeight);
    const fontSize = Math.min(boxWidth, boxHeight);

    const textScale = fontSize / 10;
    const textLength = eaw.length(annotation.description) * 0.5 * fontSize;

    const divElement = document.createElement("div");

    divElement.textContent = annotation.description;
    divElement.classList.add("gyanno");

    divElement.style.left = `${
      (style.left / scale.width) * imageViewerRect.width +
      imageViewerRect.left +
      scrollX
    }px`;
    divElement.style.top = `${
      (style.top / scale.height) * imageViewerRect.height +
      imageViewerRect.top +
      scrollY
    }px`;

    divElement.style.letterSpacing = `${
      (boxLength - textLength) / annotation.description.length / textScale
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
