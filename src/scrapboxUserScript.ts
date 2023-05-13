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
const setStyle = ({ isCollaboratable }: { isCollaboratable: boolean }) => {
  styleElement.textContent = `
    #${CSS.escape(menuTitle)} {
      ${isCollaboratable ? "" : "display: none;"}
    }

    #${CSS.escape(disabledMenuTitle)} {
      filter: saturate(0%);
      ${isCollaboratable ? "display: none;" : ""}
    }
  `;
};

let collaborateMessage: ExternalBackgroundMessage | undefined;
const checkCollaboratable = async () => {
  // @ts-expect-error
  const pageTitle = scrapbox.Page.title;
  if (!pageTitle) {
    return;
  }

  const annolinks: string[] = [];
  JSON.stringify(
    // @ts-expect-error
    scrapbox.Page.lines,
    (_key, value: unknown) => {
      const annolink = extractAnnolink(value);
      if (annolink) {
        annolinks.push(annolink);
      }

      return value;
    }
  );
  const uniqueAnnolinks = [...new Set(annolinks)];

  collaborateMessage = {
    type: "collaborate",
    // @ts-expect-error
    projectName: scrapbox.Project.name,
    pageTitle,
    annolinks: uniqueAnnolinks,
  };
  setStyle({ isCollaboratable: Boolean(uniqueAnnolinks.length) });
};
checkCollaboratable();
// @ts-expect-error
scrapbox.on("lines:changed", checkCollaboratable);
// @ts-expect-error
scrapbox.on("page:changed", checkCollaboratable);

const extractAnnolink = (value: unknown) => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (!("type" in value) || value.type !== "link") {
    return;
  }
  if (
    !("unit" in value) ||
    typeof value.unit !== "object" ||
    value.unit === null
  ) {
    return;
  }
  const { unit } = value;

  if ("project" in unit) {
    return;
  }
  if (!("page" in unit) || typeof unit.page !== "string") {
    return;
  }
  const { page } = unit;

  if (
    [...annoProtocolMap].every(
      ([, annoProtocol]) => !page.startsWith(annoProtocol)
    )
  ) {
    return;
  }

  return page;
};
