import { useEffect, useState } from "react";

export const useTranslation = (text: string) => {
  const [translatedText, setTranslatedText] = useState(text);

  useEffect(() => {
    const hiddenElement = document.createElement("span");
    hiddenElement.translate = true;
    hiddenElement.style.display = "none";
    hiddenElement.innerText = text;
    document.body.append(hiddenElement);

    const handleTranslation = () => {
      translationObserver.disconnect();
      try {
        setTranslatedText(hiddenElement.innerText);
      } finally {
        translationObserver.observe(hiddenElement, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      }
    };
    const translationObserver = new MutationObserver(handleTranslation);
    handleTranslation();

    return () => {
      translationObserver.disconnect();
      hiddenElement.remove();
    };
  }, [text]);

  return translatedText;
};
