export const getAnnoPageTitle = (url: string) => {
  const annoURL = new URL(url);
  // Prevent detection anno page title as external link.
  annoURL.protocol =
    new Map([
      ["http:", "anno:"],
      ["https:", "annos:"],
    ]).get(annoURL.protocol) ?? annoURL.protocol;
  return decodeURI(String(annoURL));
};

export const getPageURL = (url: string) => {
  const pageURL = new URL(url);
  pageURL.hash = "";
  pageURL.search = "";
  return String(pageURL);
};
