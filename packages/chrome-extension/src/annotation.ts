import type { BackgroundMessage } from "./background";

export interface IframeData {
  url: string;
  description: string;
  iconURL: string;
  iconWidth: number;
  iconHeight: number;
}

document.body.style.margin = "0px";

const searchParams = new URLSearchParams(location.search);
const id = searchParams.get("id");
if (!id) {
  throw new Error("id is empty. ");
}

const { [id]: iframeData } = await chrome.storage.local.get(id);
const { url, description, iconURL, iconWidth, iconHeight }: IframeData =
  iframeData;

const linkElement = document.createElement("a");
linkElement.href = url;
linkElement.rel = "noopener";
linkElement.target = "_blank";
linkElement.title = description;
linkElement.addEventListener("click", (event) => {
  event.preventDefault();

  const openMessage: BackgroundMessage = { type: "open", url };
  chrome.runtime.sendMessage(openMessage);
});

const imageElement = document.createElement("img");
imageElement.src = iconURL;
imageElement.style.verticalAlign = "middle";
imageElement.style.width = `${iconWidth}px`;
imageElement.style.height = `${iconHeight}px`;
linkElement.append(imageElement);

document.body.append(linkElement);
