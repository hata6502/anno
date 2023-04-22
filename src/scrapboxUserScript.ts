import type { ExternalBackgroundMessage } from "./background";
import { annoProtocolMap } from "./url";

const EXTENSION_ID = process.env.EXTENSION_ID;
if (!EXTENSION_ID) {
  throw new Error("EXTENSION_ID is not defined");
}

// @ts-expect-error
scrapbox.PageMenu.addMenu({
  title: "Collaborate anno",
  image: "https://i.gyazo.com/1e3dbb79088aa1627d7e092481848df5.png",
  onClick: async () => {
    // @ts-expect-error
    const projectName = scrapbox.Project.name;
    // @ts-expect-error
    const pageTitle = scrapbox.Page.title;

    const pageResponse = await fetch(
      `https://scrapbox.io/api/pages/${encodeURIComponent(
        projectName
      )}/${encodeURIComponent(pageTitle)}`
    );
    if (!pageResponse.ok) {
      throw new Error(`Failed to fetch page: ${pageResponse.status}`);
    }
    const page = await pageResponse.json();

    const annolinks = page.links.filter((link: string) =>
      [...annoProtocolMap].some(([, annoProtocol]) =>
        link.startsWith(annoProtocol)
      )
    );

    const collaborateMessage: ExternalBackgroundMessage = {
      type: "collaborate",
      projectName,
      pageTitle,
      annolinks,
    };
    chrome.runtime.sendMessage(EXTENSION_ID, collaborateMessage);
  },
});
