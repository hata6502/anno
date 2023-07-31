import { initialStorageValues } from "./storage";

const { annoProjectName } = await chrome.storage.local.get(
  initialStorageValues
);

const annoProjectNameInputElement = document.querySelector(
  "#anno-project-name-input"
);
if (!(annoProjectNameInputElement instanceof HTMLInputElement)) {
  throw new Error("Couldn't find the input element");
}
annoProjectNameInputElement.addEventListener("input", () =>
  chrome.storage.local.set({
    annoProjectName: annoProjectNameInputElement.value,
  })
);
annoProjectNameInputElement.value = annoProjectName;
