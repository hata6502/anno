import { initialStorageValues } from "./storage";

const annoProjectNameInputElement = document.querySelector(
  "#anno-project-name-input"
);
if (!(annoProjectNameInputElement instanceof HTMLInputElement)) {
  throw new Error("Couldn't find the input element");
}

annoProjectNameInputElement.addEventListener("input", () =>
  chrome.storage.sync.set({
    annoProjectName: annoProjectNameInputElement.value,
  })
);

const { annoProjectName } = await chrome.storage.sync.get(initialStorageValues);
annoProjectNameInputElement.value = annoProjectName;
