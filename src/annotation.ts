import { Annodata } from "./background";

document.body.style.margin = "0px";

const searchParams = new URLSearchParams(location.search);
const id = searchParams.get("id");
if (!id) {
  throw new Error("id is empty. ");
}

// @ts-expect-error
const { [id]: annodata } = await chrome.storage.session.get(id);
const { url, description, iconImageURL } = annodata as Annodata;

const linkElement = document.createElement("a");
linkElement.href = url;
linkElement.rel = "noopener";
linkElement.target = "_blank";
linkElement.title = description;

const imageElement = document.createElement("img");
imageElement.src = iconImageURL;
imageElement.style.verticalAlign = "middle";
imageElement.style.width = "20px";
imageElement.style.height = "20px";
linkElement.append(imageElement);

document.body.append(linkElement);
