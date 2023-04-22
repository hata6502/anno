import type { ExternalBackgroundMessage } from "./background";
import { annoProtocolMap } from "./url";

const EXTENSION_ID = process.env.EXTENSION_ID;
if (!EXTENSION_ID) {
  throw new Error("EXTENSION_ID is not defined");
}

const annoImageURL = "https://i.gyazo.com/1e3dbb79088aa1627d7e092481848df5.png";
const menuTitle = "Collaborate with anno";
// @ts-expect-error
scrapbox.PageMenu.addMenu({
  title: menuTitle,
  image: annoImageURL,
  onClick: () => {
    if (!collaborateMessage) {
      return;
    }

    chrome.runtime.sendMessage(EXTENSION_ID, collaborateMessage);
  },
});
const disabledMenuTitle =
  "Can't Collaborate with anno because this Scrapbox page has no annolinks. ";
// @ts-expect-error
scrapbox.PageMenu.addMenu({
  title: disabledMenuTitle,
  image: annoImageURL,
  onClick: () => {
    open(
      "https://scrapbox.io/anno/Can't_Collaborate_with_anno_because_this_Scrapbox_page_has_no_annolinks."
    );
  },
});

const styleElement = document.createElement("style");
document.head.append(styleElement);
const setStyle = ({ isEnabled }: { isEnabled: boolean }) => {
  styleElement.textContent = `
    #${CSS.escape(menuTitle)} {
      ${isEnabled ? "" : "display: none;"}
    }

    #${CSS.escape(disabledMenuTitle)} {
      filter: saturate(0%);
      opacity: 0.5;
      ${isEnabled ? "display: none;" : ""}
    }
  `;
};
setStyle({ isEnabled: false });

let collaborateMessage: ExternalBackgroundMessage | undefined;
const fetchAnnolinks = async () => {
  // @ts-expect-error
  const projectName = scrapbox.Project.name;
  // @ts-expect-error
  const pageTitle = scrapbox.Page.title;
  if (!pageTitle) {
    return;
  }

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

  collaborateMessage = {
    type: "collaborate",
    projectName,
    pageTitle,
    annolinks,
  };
  setStyle({ isEnabled: Boolean(annolinks.length) });
};
fetchAnnolinks();
// @ts-expect-error
scrapbox.on("page:changed", fetchAnnolinks);
