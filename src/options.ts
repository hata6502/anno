import { initialStorageValues } from "./storage";

addEventListener("error", async (event) => {
  alert(event.error);
});

alert(globalThis.chrome);

(async () => {
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
})();
