export const annoProtocolMap = new Map([
  ["http:", "anno:"],
  ["https:", "annos:"],
]);

export const encodeForScrapboxReadableLink = (uriComponent: string) => {
  let encoded = encodeURIComponent(uriComponent);

  for (const match of uriComponent.matchAll(
    /[\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Han}]/gu
  )) {
    encoded = encoded.replace(encodeURIComponent(match[0]), match[0]);
  }

  return encoded;
};

export const getAnnolink = (url: string) => {
  const annoURL = new URL(url);
  const annoProtocol = annoProtocolMap.get(annoURL.protocol);
  if (!annoProtocol) {
    throw new Error(`Unknown protocol: ${annoURL.protocol}`);
  }
  annoURL.protocol = annoProtocol;
  return String(annoURL);
};
