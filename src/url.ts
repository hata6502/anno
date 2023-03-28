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
  // Prevent detection anno page title as external link.
  annoURL.protocol =
    new Map([
      ["http:", "anno:"],
      ["https:", "annos:"],
    ]).get(annoURL.protocol) ?? annoURL.protocol;
  return decodeURI(String(annoURL));
};
