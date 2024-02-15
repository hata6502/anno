const handleDocumentChange = () => {
  if (!document.querySelector(".page")) {
    return;
  }
  mutationObserver.disconnect();

  const scriptElement = document.createElement("script");
  scriptElement.src = chrome.runtime.getURL("dist/scrapboxUserScript.js");
  document.body.append(scriptElement);
};
const mutationObserver = new MutationObserver(handleDocumentChange);
handleDocumentChange();
mutationObserver.observe(document, {
  subtree: true,
  childList: true,
  characterData: true,
});
