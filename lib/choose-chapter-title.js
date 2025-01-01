"use strict";

module.exports = (chapterData, chapterTitleStyle) => {
  if (chapterTitleStyle === "original") {
    if (!chapterData.originalTitle) {
      throw new Error(`originalTitle not found in chapter data for ${chapterData.url}`);
    }
    return chapterData.originalTitle;
  }
  if (chapterTitleStyle === "simplified") {
    if (!chapterData.simplifiedTitle) {
      throw new Error(`simplifiedTitle not found in chapter data for ${chapterData.url}`);
    }
    return chapterData.simplifiedTitle;
  }
  if (chapterTitleStyle === "character-names") {
    if (!chapterData.characterNamesTitle) {
      if (!chapterData.simplifiedTitle) {
        throw new Error(`Neither characterNamesTitle nor simplifiedTitle found in chapter data for ${chapterData.url}`);
      }
      return chapterData.simplifiedTitle;
    }
    return chapterData.characterNamesTitle;
  }

  throw new Error(`Invalid chapter title style: ${chapterTitleStyle}`);
};
