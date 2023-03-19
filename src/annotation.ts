import { Annodata } from "./background";

document.body.style.margin = "0px";

const searchParams = new URLSearchParams(location.search);
const id = searchParams.get("id");
if (!id) {
  throw new Error("id is empty. ");
}

const { [id]: annodata } = await chrome.storage.local.get(id);
const { url, description, iconImageURL, iconSize } = annodata as Annodata;

const linkElement = document.createElement("a");
linkElement.href = url;
linkElement.rel = "noopener";
linkElement.target = "_blank";
linkElement.title = description;

const imageElement = document.createElement("img");
imageElement.src = iconImageURL;
imageElement.style.verticalAlign = "middle";
imageElement.style.width = `${iconSize}px`;
imageElement.style.height = `${iconSize}px`;
linkElement.append(imageElement);

document.body.append(linkElement);
