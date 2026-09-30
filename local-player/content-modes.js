(function attachContentModes(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StbPlayContentModes = api;
}(globalThis, function createContentModes() {
  const restrictedWords = /(?:adult|xxx|porn|erotic|sex(?:y)?|18\s*(?:\+|plus)|x-rated|hentai)/i;
  const restrictedRatings = /(?:18\s*(?:\+|plus)|\bA\b|NC[- ]?17|XXX|\bX{1,3}\b)/i;

  function normalizeMode(value) {
    return ["all", "adult-free", "adult-only"].includes(String(value || "").toLowerCase())
      ? String(value).toLowerCase()
      : "all";
  }

  function isRestrictedCategory(category) {
    return Boolean(category?.locked || category?.adultLocked || restrictedWords.test(String(category?.title || category?.name || "")));
  }

  function isRestrictedChannel(channel, categories = []) {
    if (channel?.adultLocked || restrictedWords.test(String(channel?.name || channel?.title || ""))) return true;
    const id = String(channel?.genreId ?? channel?.categoryId ?? "");
    const category = categories.find((item) => String(item?.id ?? "") === id);
    return isRestrictedCategory(category);
  }

  function isRestrictedMedia(item, categories = []) {
    const title = String(item?.title || item?.name || "");
    const rating = String(item?.rating || item?.rating_imdb || item?.kinopoisk_rating || "").trim();
    const categoryTitle = String(item?.categoryTitle || item?.genre || item?.category_name || "");
    const id = String(item?.categoryId ?? item?.category_id ?? "");
    const category = categories.find((entry) => String(entry?.id ?? "") === id);
    return Boolean(item?.adultLocked || item?.categoryLocked || isRestrictedCategory(category) ||
      restrictedWords.test(title) || restrictedWords.test(categoryTitle) || restrictedRatings.test(rating));
  }

  function isVisibleInMode(mode, restricted) {
    const normalized = normalizeMode(mode);
    if (normalized === "adult-free") return !restricted;
    if (normalized === "adult-only") return Boolean(restricted);
    return true;
  }

  function canDisplayInMode(mode, restricted, unlocked = false) {
    const normalized = normalizeMode(mode);
    if (normalized === "adult-only") return Boolean(restricted && unlocked);
    return isVisibleInMode(normalized, restricted);
  }

  return { normalizeMode, isRestrictedCategory, isRestrictedChannel, isRestrictedMedia, isVisibleInMode, canDisplayInMode };
}));
