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
    text-align-last: justify;
    white-space: nowrap;
    user-select: text;

    &::selection {
      background-color: rgb(0, 0, 255, 0.125);
    }
  }
`;
document.head.append(styleElement);

const cache = new Map<string, Promise<any>>();
let cleanUp: (() => void) | undefined;
let prevInjections = [];
const gyanno = async () => {
  const selection = getSelection();
  if (!selection || !selection.isCollapsed) {
    return;
  }

  const match = location.pathname.match(/^\/([0-9a-z]{32})/);
  if (!match) {
    return;
  }
  const url = `https://gyazo.com/${encodeURIComponent(match[1])}.json`;
  const responsePromise =
    cache.get(url) ??
    (async () => {
      const response = await fetch(url);
      return response.json();
    })();
  cache.set(url, responsePromise);
  const { scale, metadata } = await responsePromise;

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

  const injections = metadata.ocrAnnotations.map(
    ({ description, boundingPoly }) => {
      const minX = boundingPoly.vertices[0].x;
      const minY = boundingPoly.vertices[0].y;
      const maxX = boundingPoly.vertices[2].x;
      const maxY = boundingPoly.vertices[2].y;

      const width = maxX - minX;
      const height = maxY - minY;

      return {
        description,
        left:
          scrollX +
          imageViewerRect.left +
          (minX / scale.width) * imageViewerRect.width,
        top:
          scrollY +
          imageViewerRect.top +
          (minY / scale.height) * imageViewerRect.height,
        width: (width / scale.width) * imageViewerRect.width,
        height: (height / scale.height) * imageViewerRect.height,
        fontSize: Math.min(
          (width / scale.width) * imageViewerRect.width,
          (height / scale.height) * imageViewerRect.height
        ),
        writingMode: width < height ? "vertical-lr" : "horizontal-tb",
      };
    }
  );
  if (JSON.stringify(injections) === JSON.stringify(prevInjections)) {
    return;
  }

  cleanUp?.();
  cleanUp = undefined;

  // 実験なので、いったん拡大機能を止める。
  imageViewerElement.style.cursor = "unset";
  imageViewerElement.style.pointerEvents = "none";
  document.querySelector(
    ".image-box-component .image-close-btn-bg"
  ).style.display = "none";

  const divElements = injections.map(
    ({ description, left, top, width, height, fontSize, writingMode }) => {
      const divElement = document.createElement("div");
      divElement.textContent = description;
      divElement.classList.add("gyanno");
      divElement.style.left = `${left}px`;
      divElement.style.top = `${top}px`;
      divElement.style.width = `${width}px`;
      divElement.style.height = `${height}px`;
      divElement.style.fontSize = `${fontSize}px`;
      divElement.style.writingMode = writingMode;
      return divElement;
    }
  );
  prevInjections = injections;

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
  resizeObserver.disconnect();
  mutationObserver.disconnect();
  try {
    await gyanno();
  } finally {
    resizeObserver.observe(document.body);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
};
const resizeObserver = new ResizeObserver(handle);
const mutationObserver = new MutationObserver(handle);
handle();

export {};
