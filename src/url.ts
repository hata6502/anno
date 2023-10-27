export const annoProtocolMap = new Map([
  ["http:", "anno:"],
  ["https:", "annos:"],
]);

export const encodeForScrapboxReadableLink = (uriComponent: string) => {
  let encoded = encodeURIComponent(uriComponent);

  encoded = encoded.replaceAll("%20", "+");

  for (const match of uriComponent.matchAll(
    /[\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Han}]/gu
  )) {
    encoded = encoded.replace(encodeURIComponent(match[0]), match[0]);
  }

  return encoded;
};

export const getAnnolink = (url: string) => {
  let replacedURL = url;
  for (const [protocol, annoProtocol] of annoProtocolMap) {
    if (replacedURL.startsWith(protocol)) {
      replacedURL = replacedURL.replace(protocol, annoProtocol);
    }
  }
  return replacedURL;
};
