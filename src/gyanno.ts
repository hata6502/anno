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

  .gyanno {
    position: absolute;
    color: transparent;
    font-family: monospace;
    font-size: 10px;
    user-select: text;

    &::selection {
      background-color: rgb(0, 0, 255, 0.125);
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
      left:
        scrollX +
        imageViewerRect.left +
        (annotation.minX / scale.width) * imageViewerRect.width,
      top:
        scrollY +
        imageViewerRect.top +
        (annotation.minY / scale.height) * imageViewerRect.height,
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
      Math.abs(neighborStyle.fontSize - aStyle.fontSize) >= aStyle.fontSize ||
      Math.abs(neighborStyle.fontSize - bStyle.fontSize) >= bStyle.fontSize
    ) {
      return;
    }

    return neighbor;
  };

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

      const annotations: Annotation[] = metadata.ocrAnnotations.map(
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
      return { annotations, scale };
    })();
  cache.set(url, annotationsPromise);
  const { annotations, scale } = await annotationsPromise;

  cleanUp?.();
  cleanUp = undefined;

  // 実験なので、いったん拡大機能を止める。
  imageViewerElement.style.cursor = "unset";
  imageViewerElement.style.pointerEvents = "none";
  document.querySelector(
    ".image-box-component .image-close-btn-bg"
  ).style.display = "none";

  const divElements = annotations.flatMap((annotation) => {
    const style = getStyle({ annotation, scale });
    const segments = [...new Intl.Segmenter().segment(annotation.description)];
    const isHorizontal = style.width >= style.height;

    return segments.map((segment, segmentIndex) => {
      const divElement = document.createElement("div");

      divElement.textContent = segment.segment;
      divElement.classList.add("gyanno");

      divElement.style.transform = `scale(${style.fontSize / 10})`;
      divElement.style.writingMode = isHorizontal
        ? "horizontal-tb"
        : "vertical-rl";

      const positionRate = segmentIndex / segments.length;
      if (isHorizontal) {
        divElement.style.left = `${positionRate * style.width + style.left}px`;
        divElement.style.top = `${style.top}px`;
      } else {
        divElement.style.left = `${style.left}px`;
        divElement.style.top = `${positionRate * style.height + style.top}px`;
      }

      return divElement;
    });
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
