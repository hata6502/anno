import { initialStorageValues } from "./storage";

const { watchlist, annoProjectName } = await chrome.storage.sync.get(
  initialStorageValues
);

for (const [watchlistIndex, watchlistInputElement] of document
  .querySelectorAll(".watchlist-input")
  .entries()) {
  if (!(watchlistInputElement instanceof HTMLInputElement)) {
    throw new Error("Couldn't find the input element");
  }
  watchlistInputElement.addEventListener("input", async () => {
    const { watchlist } = await chrome.storage.sync.get(initialStorageValues);
    chrome.storage.sync.set({
      watchlist: [
        ...watchlist.slice(0, watchlistIndex),
        watchlistInputElement.value,
        ...watchlist.slice(watchlistIndex + 1),
      ],
    });
  });
  watchlistInputElement.value = watchlist[watchlistIndex];
}

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
annoProjectNameInputElement.value = annoProjectName;
