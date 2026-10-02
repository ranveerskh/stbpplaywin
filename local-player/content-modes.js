(function attachContentModes(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StbPlayContentModes = api;
}(globalThis, function createContentModes() {
  const restrictedWords = /(?:adult|xxx|porn|erotic|sex(?:y)?|18\s*(?:\+|plus)|x-rated|hentai)/i;
  const restrictedRatings = /(?:\b18\s*(?:\+|plus|a)(?!\w)|\bTV[- ]?MA\b|\bR(?:[- ]?rated)?\b|\bMA\s*15\+(?!\w)|\bR\s*18\+(?!\w)|\bNC[- ]?17\b|\bAO\b|\bA\b|\bX{1,3}\b)/i;

  function normalizeMode(value) {
    return ["all", "adult-free", "adult-only"].includes(String(value || "").toLowerCase())
      ? String(value).toLowerCase()
      : "all";
  }

  function isRestrictedCategory(category) {
    return Boolean(category?.locked || category?.adultLocked || restrictedWords.test(String(category?.title || category?.name || "")));
  }

  function isCategoryVisibleInMode(mode, category, learnedRestricted = false) {
    const normalized = normalizeMode(mode);
    if (normalized === "all") return true;
    const explicitlyRestricted = isRestrictedCategory(category);
    if (normalized === "adult-only") return explicitlyRestricted || Boolean(learnedRestricted);
    // Keep mixed categories in Adult-Free mode and filter their items separately.
    return !explicitlyRestricted;
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

  function isVisibleOnHome(mode, restricted, unlocked = false) {
    const normalized = normalizeMode(mode);
    if (normalized === "adult-only") return Boolean(restricted && unlocked);
    return !restricted;
  }

  function themeForMode(mode, selectedTheme) {
    if (normalizeMode(mode) === "adult-only") return "pink";
    return ["dark", "light", "midnight"].includes(selectedTheme) ? selectedTheme : "dark";
  }

  function categoryFindingKey(kind, categoryId) {
    return `${String(kind || "vod")}:${String(categoryId ?? "")}`;
  }

  function getCategoryFinding(cache, kind, categoryId) {
    return cache?.[categoryFindingKey(kind, categoryId)] || null;
  }

  function setCategoryFinding(cache, kind, categoryId, restricted, checkedAt = Date.now(), progress = {}) {
    const key = categoryFindingKey(kind, categoryId);
    const previous = cache?.[key];
    return {
      ...(cache && typeof cache === "object" ? cache : {}),
      [key]: {
        ...(previous && typeof previous === "object" ? previous : {}),
        restricted: Boolean(restricted || previous?.restricted),
        checkedAt: Number(checkedAt) || Date.now(),
        ...progress,
      },
    };
  }

  function needsCategoryCheck(cache, kind, categoryId, now = Date.now(), ttlMs = 0) {
    const finding = getCategoryFinding(cache, kind, categoryId);
    if (finding?.complete === false) return true;
    return !finding || Number(now) - Number(finding.checkedAt || 0) >= Math.max(0, Number(ttlMs) || 0);
  }

  function categoryScanPage(cache, kind, categoryId) {
    const finding = getCategoryFinding(cache, kind, categoryId);
    return finding?.complete === false ? Math.max(0, Number(finding.nextPage) || 0) : 0;
  }

  return {
    normalizeMode,
    isRestrictedCategory,
    isCategoryVisibleInMode,
    isRestrictedChannel,
    isRestrictedMedia,
    isVisibleInMode,
    canDisplayInMode,
    isVisibleOnHome,
    themeForMode,
    categoryFindingKey,
    getCategoryFinding,
    setCategoryFinding,
    needsCategoryCheck,
    categoryScanPage,
  };
}));
