/*
=========================================================
 STB PLAY IPTV Player
 VERSION: 1.8.16 live catalogue fallback, content modes, themes, and update policy
 File: app.js
=========================================================
*/

const APP_VERSION = "1.8.16";
const DASHBOARD_HERO_INTERVAL_MS = 8000;
const CONTENT_MODES = window.StbPlayContentModes;
const UPDATE_POLICY_CACHE_KEY = "stbPlayVerifiedUpdatePolicy";

const state = {
  catalog: null,
  category: "all",
  query: "",
  selected: null,
  hls: null,
  liveRetryToken: 0,
  liveScrollTop: 0,

  parentalUnlocked: false,
  parentalConfigured: false,
  pendingUnlockAction: null,

  hiddenGroups: new Set(JSON.parse(localStorage.getItem("hiddenGroups") || "[]")),
  hiddenChannels: new Set(JSON.parse(localStorage.getItem("hiddenChannels") || "[]")),
  favoriteChannels: new Set(JSON.parse(localStorage.getItem("favoriteChannels") || "[]")),
  favoriteMedia: new Set(JSON.parse(localStorage.getItem("favoriteMedia") || "[]").map(String)),
  watchHistory: JSON.parse(localStorage.getItem("watchHistory") || "{}"),
  watchMeta: JSON.parse(localStorage.getItem("watchMeta") || "{}"),
  homePicks: JSON.parse(localStorage.getItem("netplusHomePicks") || "{}"),
  dashboardHeroItem: null,
  dashboardHeroItems: [],
  dashboardHeroIndex: 0,
  dashboardHeroTimer: null,
  dashboardHeroPaused: false,

  editingGroups: false,
  editingChannels: false,
  theme: localStorage.getItem("theme") || "dark",
  contentMode: CONTENT_MODES?.normalizeMode(localStorage.getItem("stbPlayContentMode")) || "all",
  portals: [],
  activePortalId: null,
  subscription: null,
  recoveryConfigured: false,
  latestUpdateUrl: "",
  analytics: {
    enabled: localStorage.getItem("stbPlayAnonymousAnalytics") !== "0",
    installationId: localStorage.getItem("stbPlayAnalyticsInstallationId") || "",
    heartbeatTimer: null,
    lastCrashAt: 0,
    lastUpdateNotice: "",
  },

  vod: {
    categories: [],
    categoryId: null,
    query: "",
    filter: "all",
    items: [],
    itemIds: new Set(),
    selected: null,
    page: 0,
    total: 0,
    loading: false,
    ended: false,
    loadToken: 0,
    hls: null,
    retryToken: 0,
    linkRecoveries: 0,
    categoryScrollTop: 0,
    searchResults: null,
    searchToken: 0,
    searching: false,
    searchIndexing: false,
    searchIndexedItems: 0,
    searchTotalItems: 0,
    localIndex: [],
    localIndexReady: false,
    localIndexBuilding: false,
    localIndexError: "",
    localIndexSyncActive: false,
    localIndexSyncToken: 0,
    localIndexServerCursor: 0,
    localIndexLastSavedAt: 0,
    rateLimitRetries: 0,
    duplicatePageRetries: 0,
    requestController: null,
    shelves: [],
    shelvesLoaded: false,
    shelvesLoading: false,
    shelvesLoadedItems: 0,
    subtitleTracks: [],
    subtitleRequestToken: 0,
  },

  contentType: "vod",
  series: {
    categories: [], categoryId: null, query: "", items: [], itemIds: new Set(),
    selected: null, page: 0, total: 0, loading: false, ended: false, loadToken: 0,
    hls: null, episodeScrollTop: 0, episodeScrollSeason: "", episodeScrollPositions: {},
  },
  liveWatchdogTimer: null,
  liveAutoVlcTimer: null,
  liveLastFragmentAt: 0,
  liveStableSince: 0,
  liveRecoveryInFlight: false,
  liveRecoveryHistory: [],
  liveAuthRetries: 0,
  liveCatalogRefreshes: 0,
  externalPlayer: { live: null, vod: null },
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  topbar: $("#topbar"),
  modebar: $("#modebar"),

  setup: $("#setup"),
  setupForm: $("#setupForm"),
  setupError: $("#setupError"),
  connectButton: $("#connectButton"),
  serviceId: $("#serviceId"),
  portalNickname: $("#portalNickname"),
  portalUrl: $("#portalUrl"),
  mac: $("#mac"),
  parentalPin: $("#parentalPin"),

  status: $("#status"),
  appFullscreenButton: $("#appFullscreenButton"),
  settingsButton: $("#settingsButton"),

  workspace: $("#workspace"),
  categories: $("#categories"),
  channels: $("#channels"),
  groupCount: $("#groupCount"),
  channelCount: $("#channelCount"),
  search: $("#search"),
  editGroupsButton: $("#editGroupsButton"),
  editChannelsButton: $("#editChannelsButton"),

  playerContainer: $("#playerContainer"),
  video: $("#video"),
  placeholder: $("#placeholder"),
  videoLoading: $("#videoLoading"),
  customControls: $("#customControls"),
  controlTitle: $("#controlTitle"),
  controlEpg: $("#controlEpg"),
  progressContainer: $("#progressContainer"),
  progressBar: $("#progressBar"),
  playPauseBtn: $("#playPauseBtn"),
  muteBtn: $("#muteBtn"),
  volumeSlider: $("#volumeSlider"),
  timeDisplay: $("#timeDisplay"),
  fullscreenBtn: $("#fullscreenBtn"),
  playerModeBadge: $("#playerModeBadge"),
  nowPlaying: $("#nowPlaying"),
  notice: $("#notice"),
  noticeText: $("#noticeText"),
  playInVlcButton: $("#playInVlcButton"),

  vodWorkspace: $("#vodWorkspace"),
  dashboardWorkspace: $("#dashboardWorkspace"),
  dashboardHero: $("#dashboardHero"),
  dashboardHeroBackdrop: $("#dashboardHeroBackdrop"),
  dashboardHeroArtwork: $("#dashboardHeroArtwork"),
  dashboardHeroEyebrow: $("#dashboardHeroEyebrow"),
  dashboardHeroTitle: $("#dashboardHeroTitle"),
  dashboardHeroMeta: $("#dashboardHeroMeta"),
  dashboardHeroDescription: $("#dashboardHeroDescription"),
  dashboardHeroPlay: $("#dashboardHeroPlay"),
  dashboardHeroFavorite: $("#dashboardHeroFavorite"),
  dashboardHeroDots: $("#dashboardHeroDots"),
  dashboardHeroPrev: $("#dashboardHeroPrev"),
  dashboardHeroNext: $("#dashboardHeroNext"),
  dashboardActions: $("#dashboardActions"),
  recommendedGrid: $("#recommendedGrid"),
  recommendedReason: $("#recommendedReason"),
  latestShelves: $("#latestShelves"),
  popularGrid: $("#popularGrid"),
  favoritesWorkspace: $("#favoritesWorkspace"),
  continueWatching: $("#continueWatching"),
  favoriteChannelsGrid: $("#favoriteChannelsGrid"),
  favoriteMediaGrid: $("#favoriteMediaGrid"),
  vodSearch: $("#vodSearch"),
  vodCategories: $("#vodCategories"),
  vodCategoryTitle: $("#vodCategoryTitle"),
  vodCategoryMeta: $("#vodCategoryMeta"),
  vodGrid: $("#vodGrid"),
  vodLoadMore: $("#vodLoadMore"),
  vodLoadSpinner: $("#vodLoadSpinner"),
  vodEndMessage: $("#vodEndMessage"),
  vodLoadMoreButton: $("#vodLoadMoreButton"),

  vodPlayerSection: $("#vodPlayerSection"),
  vodPlayerContainer: $("#vodPlayerContainer"),
  vodVideo: $("#vodVideo"),
  vodVideoLoading: $("#vodVideoLoading"),
  vodNotice: $("#vodNotice"),
  vodNoticeText: $("#vodNoticeText"),
  vodPlayInVlcButton: $("#vodPlayInVlcButton"),
  vodPlayerControls: $("#vodPlayerControls"),
  vodControlTitle: $("#vodControlTitle"),
  vodProgressContainer: $("#vodProgressContainer"),
  vodProgressBar: $("#vodProgressBar"),
  vodPlayPauseBtn: $("#vodPlayPauseBtn"),
  vodMuteBtn: $("#vodMuteBtn"),
  vodVolumeSlider: $("#vodVolumeSlider"),
  vodTimeDisplay: $("#vodTimeDisplay"),
  vodSubtitleSelect: $("#vodSubtitleSelect"),
  closeVodPlayerButton: $("#closeVodPlayerButton"),
  vodFullscreenBtn: $("#vodFullscreenBtn"),

  vodModal: $("#vodModal"),
  vodClose: $("#vodClose"),
  vodModalPoster: $("#vodModalPoster"),
  vodModalTitle: $("#vodModalTitle"),
  vodModalMeta: $("#vodModalMeta"),
  vodModalDescription: $("#vodModalDescription"),
  vodPlayButton: $("#vodPlayButton"),
  vodResumeButton: $("#vodResumeButton"),
  vodFavoriteButton: $("#vodFavoriteButton"),

  qualityModal: $("#qualityModal"),
  qualityClose: $("#qualityClose"),
  qualityModalTitle: $("#qualityModalTitle"),
  qualityModalDescription: $("#qualityModalDescription"),
  qualityOptions: $("#qualityOptions"),

  seriesWorkspace: $("#seriesWorkspace"),
  seriesSearch: $("#seriesSearch"),
  seriesCategories: $("#seriesCategories"),
  seriesCategoryTitle: $("#seriesCategoryTitle"),
  seriesCategoryMeta: $("#seriesCategoryMeta"),
  seriesGrid: $("#seriesGrid"),
  seriesLoadMore: $("#seriesLoadMore"),
  seriesLoadSpinner: $("#seriesLoadSpinner"),
  seriesEndMessage: $("#seriesEndMessage"),
  seriesPlayerSection: $("#seriesPlayerSection"),
  seriesVideo: $("#seriesVideo"),
  seriesVideoLoading: $("#seriesVideoLoading"),
  closeSeriesPlayerButton: $("#closeSeriesPlayerButton"),
  seriesModal: $("#seriesModal"),
  seriesClose: $("#seriesClose"),
  seriesModalPoster: $("#seriesModalPoster"),
  seriesModalTitle: $("#seriesModalTitle"),
  seriesModalMeta: $("#seriesModalMeta"),
  seriesModalDescription: $("#seriesModalDescription"),
  seriesSeasonSelect: $("#seriesSeasonSelect"),
  seriesEpisodes: $("#seriesEpisodes"),
  seriesResumeButton: $("#seriesResumeButton"),
  seriesFavoriteButton: $("#seriesFavoriteButton"),

  pinModal: $("#pinModal"),
  closePinModal: $("#closePinModal"),
  pinUnlockForm: $("#pinUnlockForm"),
  unlockPin: $("#unlockPin"),
  unlockPinError: $("#unlockPinError"),
  unlockPinButton: $("#unlockPinButton"),

  settingsModal: $("#settingsModal"),
  closeSettingsButton: $("#closeSettingsButton"),
  themeSelect: $("#themeSelect"),
  playerSelect: $("#playerSelect"),
  subscriptionPlan: $("#subscriptionPlan"),
  subscriptionExpiry: $("#subscriptionExpiry"),
  subscriptionStatus: $("#subscriptionStatus"),
  languageSelect: $("#languageSelect"),
  subtitleSelect: $("#subtitleSelect"),
  supportButton: $("#supportButton"),
  checkUpdatesButton: $("#checkUpdatesButton"),
  updateStatus: $("#updateStatus"),
  firstStartWarningModal: $("#firstStartWarningModal"),
  firstStartReadButton: $("#firstStartReadButton"),
  newParentalPin: $("#newParentalPin"),
  currentParentalPin: $("#currentParentalPin"),
  updatePinButton: $("#updatePinButton"),
  generateRecoveryCodeButton: $("#generateRecoveryCodeButton"),
  forgotParentalPinButton: $("#forgotParentalPinButton"),
  recoveryCodePanel: $("#recoveryCodePanel"),
  recoveryCodeValue: $("#recoveryCodeValue"),
  forgotPinModal: $("#forgotPinModal"),
  closeForgotPinModal: $("#closeForgotPinModal"),
  forgotPinForm: $("#forgotPinForm"),
  recoveryCodeInput: $("#recoveryCodeInput"),
  recoveryNewPin: $("#recoveryNewPin"),
  recoveryPinError: $("#recoveryPinError"),
  recoverPinButton: $("#recoverPinButton"),
  pinNotice: $("#pinNotice"),
  resetDiagnosticButton: $("#resetDiagnosticButton"),
  downloadDiagnosticButton: $("#downloadDiagnosticButton"),
  diagnosticNotice: $("#diagnosticNotice"),
  analyticsEnabled: $("#analyticsEnabled"),
  resetPortalButton: $("#resetPortalButton"),
  refreshContentButton: $("#refreshContentButton"),
  clearHistoryButton: $("#clearHistoryButton"),
  clearCacheButton: $("#clearCacheButton"),
  contentNotice: $("#contentNotice"),
  localCatalogueStatus: $("#localCatalogueStatus"),
  loadLocalCatalogueButton: $("#loadLocalCatalogueButton"),
  castingStatus: $("#castingStatus"),
  shareButton: $("#shareButton"),
  portalList: $("#portalList"),
  addPortalButton: $("#addPortalButton"),
  portalEditorModal: $("#portalEditorModal"),
  closePortalEditor: $("#closePortalEditor"),
  portalEditorForm: $("#portalEditorForm"),
  portalEditorTitle: $("#portalEditorTitle"),
  portalEditorId: $("#portalEditorId"),
  portalEditorNickname: $("#portalEditorNickname"),
  portalEditorUrl: $("#portalEditorUrl"),
  portalEditorMac: $("#portalEditorMac"),
  portalEditorNotice: $("#portalEditorNotice"),
  portalLoadingModal: $("#portalLoadingModal"),
  portalLoadingTitle: $("#portalLoadingTitle"),
  portalLoadingStatus: $("#portalLoadingStatus"),
  portalProgressBar: $("#portalProgressBar"),
  portalProgressLabel: $("#portalProgressLabel"),
  portalProgressPhase: $("#portalProgressPhase"),
  portalLoadingError: $("#portalLoadingError"),
  portalLoadingBackButton: $("#portalLoadingBackButton"),
  updateToast: $("#updateToast"),
  updateToastTitle: $("#updateToastTitle"),
  updateToastText: $("#updateToastText"),
  updateToastDownload: $("#updateToastDownload"),
  dismissUpdateToast: $("#dismissUpdateToast"),
  downloadUpdateButton: $("#downloadUpdateButton"),
  contentModeSelect: $("#contentModeSelect"),
  unlockContentModeButton: $("#unlockContentModeButton"),
  updateRequiredOverlay: $("#updateRequiredOverlay"),
  updateRequiredStatus: $("#updateRequiredStatus"),
  updateRequiredRetry: $("#updateRequiredRetry"),
  updateRequiredDownload: $("#updateRequiredDownload"),
};

let updateToastTimer = null;

async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const ANALYTICS_EVENTS = new Set([
  "app_opened",
  "first_run",
  "heartbeat",
  "portal_load_success",
  "portal_load_failed",
  "playback_started",
  "playback_failed",
  "vlc_fallback",
  "update_available",
  "update_downloaded",
  "update_installed",
  "crash_reported",
  "feature_used",
]);

function createAnalyticsInstallationId() {
  try {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
}

function getAnalyticsInstallationId() {
  if (state.analytics.installationId) return state.analytics.installationId;
  state.analytics.installationId = createAnalyticsInstallationId();
  try { localStorage.setItem("stbPlayAnalyticsInstallationId", state.analytics.installationId); } catch {}
  return state.analytics.installationId;
}

function getAnalyticsPlatform() {
  const value = String(window.stbPlay?.platform || "").toLowerCase();
  if (["win32", "darwin", "linux"].includes(value)) return value;
  const agent = String(navigator.userAgent || "").toLowerCase();
  if (agent.includes("windows")) return "win32";
  if (agent.includes("mac os")) return "darwin";
  return "linux";
}

function analyticsMeta(details = {}) {
  const output = {};
  const player = String(details.player || "").trim().toLowerCase();
  const screen = String(details.screen || "").trim().toLowerCase();
  const errorType = String(details.errorType || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const reason = String(details.reason || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (["internal", "vlc", "auto"].includes(player)) output.player = player;
  if (["setup", "live", "vod", "series", "update", "app"].includes(screen)) output.screen = screen;
  if (errorType) output.errorType = errorType.slice(0, 48);
  if (reason) output.reason = reason.slice(0, 48);
  if (Number.isFinite(Number(details.durationSec))) {
    output.durationSec = Math.max(0, Math.min(86_400, Math.round(Number(details.durationSec))));
  }
  if (typeof details.success === "boolean") output.success = details.success;
  for (const key of ["fromVersion", "toVersion"]) {
    const value = String(details[key] || "").trim();
    if (/^\d+\.\d+\.\d+$/.test(value)) output[key] = value;
  }
  if (Number.isInteger(Number(details.statusCode)) && Number(details.statusCode) >= 100 && Number(details.statusCode) <= 599) {
    output.statusCode = Number(details.statusCode);
  }
  return output;
}

function trackAnalytics(name, details = {}) {
  if (!state.analytics.enabled || !ANALYTICS_EVENTS.has(name)) return;
  const payload = {
    installationId: getAnalyticsInstallationId(),
    name,
    version: APP_VERSION,
    platform: getAnalyticsPlatform(),
    meta: analyticsMeta(details),
  };
  fetch("/api/analytics/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});
}

function analyticsErrorType(error, fallback = "unknown") {
  const status = Number(error?.status || 0);
  if (status === 401 || /authorization|authoriz/i.test(String(error?.message || error || ""))) return "authorization";
  if (status === 404 || /no longer available|stale/i.test(String(error?.message || error || ""))) return "stale-channel";
  if (status === 415 || /codec|decode/i.test(String(error?.message || error || ""))) return "unsupported-codec";
  if (/network|timeout|fetch/i.test(String(error?.message || error || ""))) return "network";
  return fallback;
}

function installAnalyticsErrorHandlers() {
  if (window.__stbPlayAnalyticsHandlersInstalled) return;
  window.__stbPlayAnalyticsHandlersInstalled = true;
  const report = (errorType) => {
    const now = Date.now();
    if (now - state.analytics.lastCrashAt < 5_000) return;
    state.analytics.lastCrashAt = now;
    trackAnalytics("crash_reported", { screen: "app", errorType });
  };
  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) return;
    report(String(event.error?.name || "runtime-error").toLowerCase());
  });
  window.addEventListener("unhandledrejection", (event) => {
    report(String(event.reason?.name || "unhandled-rejection").toLowerCase());
  });
}

function startAnalyticsLifecycle() {
  installAnalyticsErrorHandlers();
  const previousVersion = (() => {
    try { return localStorage.getItem("stbPlayLastSeenVersion") || ""; } catch { return ""; }
  })();
  if (!previousVersion) trackAnalytics("first_run", { screen: "setup" });
  else if (previousVersion !== APP_VERSION) {
    trackAnalytics("update_installed", {
      screen: "update",
      fromVersion: previousVersion,
      toVersion: APP_VERSION,
    });
  }
  try { localStorage.setItem("stbPlayLastSeenVersion", APP_VERSION); } catch {}
  trackAnalytics("app_opened", { screen: "app" });
  clearInterval(state.analytics.heartbeatTimer);
  state.analytics.heartbeatTimer = window.setInterval(
    () => trackAnalytics("heartbeat", { screen: "app" }),
    30 * 60 * 1000
  );
}

/* v1.7.0 starts a clean index namespace so cards from the older partial
   catalogue cannot produce false 404s after an update. */
const VOD_INDEX_DB = "netplus-local-catalog-v1.7.0";
const VOD_INDEX_STORE = "metadata";

function openVodIndexDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("Local catalogue storage is unavailable."));
    const requestDb = indexedDB.open(VOD_INDEX_DB, 1);
    requestDb.onupgradeneeded = () => requestDb.result.createObjectStore(VOD_INDEX_STORE, { keyPath: "key" });
    requestDb.onsuccess = () => resolve(requestDb.result);
    requestDb.onerror = () => reject(requestDb.error || new Error("Could not open local catalogue storage."));
  });
}

async function readLocalVodIndex() {
  try {
    const db = await openVodIndexDb();
    return await new Promise((resolve, reject) => {
      const requestIndex = db.transaction(VOD_INDEX_STORE, "readonly").objectStore(VOD_INDEX_STORE).get("active");
      requestIndex.onsuccess = () => {
        const record = requestIndex.result;
        /* Accept an older record shape, but treat it as partial because
           the old build never stored a completion marker. */
        resolve({
          items: Array.isArray(record?.items) ? record.items : [],
          complete: record?.complete === true,
          indexedItems: Number(record?.indexedItems) || 0,
          totalItems: Number(record?.totalItems) || 0,
        });
      };
      requestIndex.onerror = () => reject(requestIndex.error);
    });
  } catch { return { items: [], complete: false, indexedItems: 0, totalItems: 0 }; }
}

async function writeLocalVodIndex(items, complete = false, indexedItems = items.length, totalItems = 0) {
  const db = await openVodIndexDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(VOD_INDEX_STORE, "readwrite");
    transaction.objectStore(VOD_INDEX_STORE).put({
      key: "active",
      savedAt: Date.now(),
      items,
      complete: Boolean(complete),
      indexedItems: Number(indexedItems) || items.length,
      totalItems: Number(totalItems) || 0,
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function clearLocalVodIndex() {
  try {
    const db = await openVodIndexDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(VOD_INDEX_STORE, "readwrite");
      transaction.objectStore(VOD_INDEX_STORE).delete("active");
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {}
}

function localCategoryMatches(item) {
  const category = vodCategoryById(state.vod.categoryId);
  if (!category || category.id === "*") return true;
  const itemCategoryId = String(item.categoryId ?? "").trim();
  if (itemCategoryId) return itemCategoryId === String(category.id);
  const needle = String(category.title || "").trim().toLowerCase();
  return Boolean(needle) && String(item.categoryTitle || "").trim().toLowerCase() === needle;
}

function normalizeTitleSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function strictTitleSearchMatch(item, query) {
  const needle = normalizeTitleSearchText(query);
  if (!needle) return false;
  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(?:^| )${escapedNeedle}(?=$| )`, "u");
  return [
    item?.title,
    item?.name,
    item?.oldTitle,
    item?.alternateTitle,
    item?.originalTitle,
  ].some((value) => matcher.test(normalizeTitleSearchText(value)));
}

function searchLocalVodIndex(query) {
  return state.vod.localIndex.filter((item) => {
    if (!localCategoryMatches(item)) return false;
    if (state.vod.filter === "series" && item.kind !== "series" && item.isSeries !== true) return false;
    if (state.vod.filter === "movie" && (item.kind === "series" || item.isSeries === true)) return false;
    return strictTitleSearchMatch(item, query);
  }).slice(0, 100);
}

function mergeVodLocalIndex(items) {
  const byId = new Map((state.vod.localIndex || []).map((item) => [String(item.id), item]));
  for (const item of items || []) {
    if (!item?.id) continue;
    byId.set(String(item.id), { ...byId.get(String(item.id)), ...item, id: String(item.id) });
  }
  state.vod.localIndex = [...byId.values()];
  state.vod.localIndexReady = false;
  state.vod.searchIndexedItems = Math.max(state.vod.searchIndexedItems || 0, state.vod.localIndex.length);
}

let vodShelvesPromise = null;
let vodShelvesPollTimer = null;
async function loadVodShelves() {
  if (state.vod.shelvesLoaded) return state.vod.shelves;
  if (vodShelvesPromise) return vodShelvesPromise;
  state.vod.shelvesLoading = true;
  renderLocalCatalogueStatus();
  vodShelvesPromise = (async () => {
    try {
      const result = await request("/api/vod/shelves");
      state.vod.shelves = Array.isArray(result.shelves) ? result.shelves : [];
      state.vod.shelvesLoadedItems = Number(result.loadedItems) ||
        state.vod.shelves.reduce((sum, shelf) => sum + (shelf.items?.length || 0), 0);
      mergeVodLocalIndex(state.vod.shelves.flatMap((shelf) => shelf.items || []));
      state.vod.shelvesLoaded = !result.loading;
      state.vod.shelvesLoading = Boolean(result.loading);
      if (state.vod.localIndex.length) {
        await writeLocalVodIndex(
          state.vod.localIndex,
          false,
          state.vod.localIndex.length,
          state.vod.searchTotalItems
        ).catch(() => {});
      }
      renderLocalCatalogueStatus();
      if (!elements.dashboardWorkspace.hidden) renderDashboard();
      if (state.vod.query.trim().length >= 3) {
        state.vod.searchResults = searchLocalVodIndex(state.vod.query);
        renderVodGrid();
      }
      if (result.loading) {
        clearTimeout(vodShelvesPollTimer);
        vodShelvesPollTimer = setTimeout(() => {
          void loadVodShelves().catch(() => {});
        }, 1_500);
      }
      return state.vod.shelves;
    } finally {
      state.vod.shelvesLoading = !state.vod.shelvesLoaded;
      vodShelvesPromise = null;
      renderLocalCatalogueStatus();
    }
  })();
  return vodShelvesPromise;
}

let localIndexSyncTimer;
async function syncVodIndex() {
  if (state.vod.localIndexSyncActive) return;
  const syncToken = ++state.vod.localIndexSyncToken;
  state.vod.localIndexSyncActive = true;
  const cached = await readLocalVodIndex();
  if (cached.items.length) {
    state.vod.localIndex = cached.items;
    state.vod.localIndexReady = cached.complete;
    state.vod.searchIndexedItems = cached.indexedItems || cached.items.length;
    state.vod.searchTotalItems = cached.totalItems || 0;
    /* A partial cache is only a useful preview. Start the server cursor at
       zero so a restarted server cannot make us skip its first rows. */
    state.vod.localIndexServerCursor = cached.complete ? cached.items.length : 0;
  }
  if (cached.complete) {
    state.vod.localIndexBuilding = false;
    state.vod.localIndexSyncActive = false;
    renderLocalCatalogueStatus();
    return;
  }
  state.vod.localIndexBuilding = true;
  state.vod.localIndexLastSavedAt = 0;
  renderLocalCatalogueStatus();
  const poll = async () => {
    if (syncToken !== state.vod.localIndexSyncToken) return;
    try {
      const result = await request(
        `/api/vod/index?after=${encodeURIComponent(state.vod.localIndexServerCursor || 0)}`
      );
      state.vod.searchIndexedItems = Number(result.indexedItems) || 0;
      state.vod.searchTotalItems = Number(result.totalItems) || 0;
      if (result.reset) state.vod.localIndex = [];
      if (Array.isArray(result.items) && result.items.length) {
        const byId = new Map(state.vod.localIndex.map((item) => [String(item.id), item]));
        for (const item of result.items) {
          if (item?.id != null) byId.set(String(item.id), item);
        }
        state.vod.localIndex = [...byId.values()];
      }
      state.vod.localIndexServerCursor = state.vod.searchIndexedItems;
      state.vod.localIndexReady = Boolean(result.complete);
      const shouldSave =
        result.complete ||
        !state.vod.localIndexLastSavedAt ||
        Date.now() - state.vod.localIndexLastSavedAt >= 10_000;
      if (shouldSave && state.vod.localIndex.length) {
        await writeLocalVodIndex(
          state.vod.localIndex,
          result.complete,
          state.vod.searchIndexedItems,
          state.vod.searchTotalItems
        );
        state.vod.localIndexLastSavedAt = Date.now();
      }
      if (state.vod.query.trim().length >= 3) {
        state.vod.searchResults = searchLocalVodIndex(state.vod.query);
        renderVodGrid();
      }
      if (result.error) state.vod.localIndexError = result.error;
      state.vod.localIndexBuilding = !result.complete;
      renderLocalCatalogueStatus();
      if (!result.complete) localIndexSyncTimer = setTimeout(poll, 2200);
      else { state.vod.localIndexSyncActive = false; renderLocalCatalogueStatus(); }
    } catch (error) {
      if (syncToken !== state.vod.localIndexSyncToken) return;
      state.vod.localIndexError = error.message || "Could not load the local catalogue.";
      state.vod.localIndexBuilding = false;
      state.vod.localIndexSyncActive = false;
      renderLocalCatalogueStatus();
    }
  };
  poll();
}

function renderLocalCatalogueStatus() {
  if (!elements.localCatalogueStatus) return;
  const items = state.vod.localIndex || [];
  const movies = items.filter((item) => item.kind !== "series" && item.isSeries !== true).length;
  const series = items.length - movies;
  const channels = state.catalog?.channels?.length || 0;
  const indexed = state.vod.searchIndexedItems || items.length;
  const total = state.vod.searchTotalItems;
  if (state.vod.localIndexError) {
    elements.localCatalogueStatus.textContent = `Local catalogue error: ${state.vod.localIndexError}`;
    return;
  }
  const progress = total ? ` · indexed ${indexed.toLocaleString()} of ${total.toLocaleString()}` : "";
  const shelves = state.vod.shelvesLoaded
    ? ` · ${state.vod.shelves.length.toLocaleString()} shelves loaded`
    : state.vod.shelvesLoading ? " · loading category shelves…" : "";
  elements.localCatalogueStatus.textContent = state.vod.localIndexBuilding
    ? `Local catalogue loading${progress}${shelves} · ${movies.toLocaleString()} movies · ${series.toLocaleString()} series · ${channels.toLocaleString()} channels`
    : `Local metadata ready${shelves} · ${items.length.toLocaleString()} titles · ${movies.toLocaleString()} movies · ${series.toLocaleString()} series · ${channels.toLocaleString()} channels`;
}

/* v1.6.6: browser/HLS events are sent without any portal URL,
   MAC, token, cookie, or user-entered credentials. */
function recordClientDiagnostic(event, details = {}) {
  fetch("/api/diagnostics/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, details }),
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});
}

function hlsDiagnosticDetails(data) {
  return {
    type: String(data?.type || ""),
    details: String(data?.details || ""),
    fatal: Boolean(data?.fatal),
    reason: String(data?.reason || ""),
    responseCode: Number(data?.response?.code || 0) || undefined,
    frag: data?.frag
      ? {
          sn: data.frag.sn,
          level: data.frag.level,
          duration: data.frag.duration,
        }
      : undefined,
  };
}

function setStatus(text, online = false) {
  const span = elements.status?.querySelector("span");
  if (span) span.textContent = text;
  elements.status?.classList.toggle("online", online);
}

function showNotice(message = "", fallback = null) {
  if (!elements.notice) return;
  if (elements.noticeText) elements.noticeText.textContent = message;
  else elements.notice.textContent = message;
  setExternalPlayerFallback("live", fallback);
  elements.notice.hidden = !message;
}

function setExternalPlayerFallback(kind, fallback = null) {
  const isVod = kind === "vod";
  const button = isVod ? elements.vodPlayInVlcButton : elements.playInVlcButton;
  state.externalPlayer[kind] = fallback?.stream
    ? { stream: String(fallback.stream), title: String(fallback.title || "STB PLAY") }
    : null;
  if (!button) return;
  button.hidden = !state.externalPlayer[kind];
  button.disabled = false;
  button.textContent = "Play in VLC";
}

function showVodNotice(message = "", fallback = null) {
  if (!elements.vodNotice) return;
  if (elements.vodNoticeText) elements.vodNoticeText.textContent = message;
  else elements.vodNotice.textContent = message;
  setExternalPlayerFallback("vod", fallback);
  elements.vodNotice.hidden = !message;
}

async function playInVlc(kind, fallbackOverride = null, automatic = false) {
  const fallback = fallbackOverride || state.externalPlayer[kind];
  if (!fallback) return;
  const button = kind === "vod" ? elements.vodPlayInVlcButton : elements.playInVlcButton;
  if (!button) return;

  state.externalPlayer[kind] = fallback;
  button.disabled = true;
  button.textContent = "Opening VLC…";
  if (automatic) button.hidden = true;
  try {
    await request("/api/play-vlc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stream: fallback.stream, title: fallback.title }),
    });
    recordClientDiagnostic("client.external_player_launched", {
      kind,
      title: fallback.title,
    });
    trackAnalytics(automatic ? "vlc_fallback" : "playback_started", {
      screen: kind === "vod" ? "vod" : "live",
      player: "vlc",
      reason: automatic ? "internal-player-fallback" : "user-selected-vlc",
      success: true,
    });
    button.textContent = "Opened in VLC";
    setTimeout(() => {
      if (state.externalPlayer[kind]?.stream !== fallback.stream) return;
      button.disabled = false;
      button.textContent = "Play in VLC";
      if (automatic) button.hidden = true;
    }, 2500);
  } catch (error) {
    const message = error.message || "VLC could not be opened.";
    trackAnalytics("playback_failed", {
      screen: kind === "vod" ? "vod" : "live",
      player: "vlc",
      errorType: analyticsErrorType(error, "vlc-launch"),
      statusCode: error.status,
      success: false,
    });
    if (kind === "vod") showVodNotice(message, fallback);
    else showNotice(message, fallback);
  }
}

function openPreferredExternalPlayer(kind, stream, title, options = {}) {
  const { automatic = false } = options;
  const fallback = { stream: String(stream || ""), title: String(title || "STB PLAY") };
  if (!fallback.stream) return false;
  if (kind === "live" && automatic) {
    clearTimeout(state.liveAutoVlcTimer);
    state.liveAutoVlcTimer = null;
    clearInterval(state.liveWatchdogTimer);
    state.liveWatchdogTimer = null;
    destroyHls("live");
    stopMedia(elements.video);
    elements.videoLoading.hidden = true;
    elements.customControls.hidden = true;
  }
  const message = automatic
    ? "Built-in playback is still buffering. Opening VLC…"
    : "Opening in VLC…";
  if (kind === "vod") {
    if (automatic) {
      showVodNotice(message);
      state.externalPlayer.vod = fallback;
      elements.vodPlayInVlcButton.hidden = true;
    } else showVodNotice(message, fallback);
  } else if (automatic) {
    showNotice(message);
    state.externalPlayer.live = fallback;
    elements.playInVlcButton.hidden = true;
  } else showNotice(message, fallback);
  void playInVlc(kind, fallback, automatic);
  return true;
}

function initials(name) {
  return String(name || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]).join("").toUpperCase() || "TV";
}

function formatTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function applyTheme() {
  if (!["dark", "light", "midnight"].includes(state.theme)) state.theme = "dark";
  document.body.className = `theme-${state.theme}`;
  if (elements.themeSelect) elements.themeSelect.value = state.theme;
}

function persistSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function applyPreferences() {
  if (elements.languageSelect) elements.languageSelect.value = localStorage.getItem("appLanguage") || "en";
  if (elements.subtitleSelect) elements.subtitleSelect.value = localStorage.getItem("subtitlePreference") || "off";
  if (elements.playerSelect) elements.playerSelect.value = getDefaultPlayer();
  if (elements.analyticsEnabled) elements.analyticsEnabled.checked = state.analytics.enabled;
  if (elements.contentModeSelect) elements.contentModeSelect.value = state.contentMode;
  updateContentModeUnlockButton();
}

function updateContentModeUnlockButton() {
  if (elements.unlockContentModeButton) {
    elements.unlockContentModeButton.hidden = state.contentMode !== "adult-only" || state.parentalUnlocked;
  }
}

function unlockContentMode() {
  requestParentalUnlock(() => {
    state.parentalUnlocked = true;
    renderContentModeScreens();
  });
}

function renderContentModeScreens() {
  renderCategories();
  renderChannels();
  renderVodCategories();
  renderVodGrid();
  renderSeriesCategories();
  renderSeriesGrid();
  renderDashboard();
  renderFavorites();
  updateContentModeUnlockButton();
}

function setContentMode(value, verified = false) {
  const nextMode = CONTENT_MODES?.normalizeMode(value) || "all";
  if (nextMode === "adult-only" && !verified && !state.parentalUnlocked) {
    if (elements.contentModeSelect) elements.contentModeSelect.value = state.contentMode;
    requestParentalUnlock(() => {
      state.parentalUnlocked = true;
      setContentMode(nextMode, true);
    });
    return;
  }

  const previousMode = state.contentMode;
  state.contentMode = nextMode;
  if (nextMode !== "adult-only") state.parentalUnlocked = false;
  localStorage.setItem("stbPlayContentMode", nextMode);
  if (elements.contentModeSelect) elements.contentModeSelect.value = nextMode;
  if (state.selected?.kind === "live" && (
    !canDisplayRestrictedContent(isRestrictedLiveChannel(state.selected)) ||
    (!state.parentalUnlocked && (categoryById(state.selected.genreId)?.locked || state.selected.adultLocked))
  )) {
    stopLivePlayback(true);
  }
  if (state.vod.selected && (
    !canDisplayRestrictedContent(isRestrictedMedia(state.vod.selected)) ||
    (!state.parentalUnlocked && isRestrictedMedia(state.vod.selected))
  )) {
    resetVodPlayer();
    elements.vodPlayerSection.hidden = true;
    state.vod.selected = null;
  }
  if (previousMode !== nextMode) state.category = "all";
  renderContentModeScreens();
}

function getDefaultPlayer() {
  const value = String(localStorage.getItem("defaultPlayer") || "auto").toLowerCase();
  return ["auto", "internal", "vlc"].includes(value) ? value : "auto";
}

function isMediaFavorite(item) {
  return Boolean(item?.id) && state.favoriteMedia.has(String(item.id));
}

function toggleMediaFavorite(item) {
  if (!item?.id) return false;
  const id = String(item.id);
  if (state.favoriteMedia.has(id)) state.favoriteMedia.delete(id);
  else state.favoriteMedia.add(id);
  persistSet("favoriteMedia", state.favoriteMedia);
  return state.favoriteMedia.has(id);
}

function saveWatchHistory() {
  localStorage.setItem("watchHistory", JSON.stringify(state.watchHistory));
  localStorage.setItem("watchMeta", JSON.stringify(state.watchMeta));
}

function categoryById(id) {
  return state.catalog?.categories?.find((category) => category.id === id);
}

function isRestrictedLiveChannel(channel) {
  return CONTENT_MODES?.isRestrictedChannel(channel, state.catalog?.categories || []) ||
    Boolean(categoryById(channel?.genreId)?.locked || channel?.adultLocked);
}

function contentModeAllows(restricted) {
  return CONTENT_MODES?.isVisibleInMode(state.contentMode, restricted) ?? true;
}

function canDisplayRestrictedContent(restricted) {
  return contentModeAllows(restricted) && !(state.contentMode === "adult-only" && restricted && !state.parentalUnlocked);
}

function isRestrictedMedia(item) {
  return CONTENT_MODES?.isRestrictedMedia(item, state.vod.categories) ?? isRestrictedVodItem(item);
}

function vodCategoryById(id) {
  return state.vod.categories.find((category) => category.id === id);
}

function stopMedia(video) {
  if (!video) return;
  try { video.pause(); } catch {}
  video.removeAttribute("src");
  try { video.load(); } catch {}
}

function destroyHls(key) {
  const hls = key === "live" ? state.hls : state.vod.hls;
  if (hls) {
    try { hls.destroy(); } catch {}
  }
  if (key === "live") state.hls = null;
  else state.vod.hls = null;
}

function stopLivePlayback(clearSelection = false) {
  state.liveRetryToken += 1;
  clearInterval(state.liveWatchdogTimer);
  state.liveWatchdogTimer = null;
  clearTimeout(state.liveAutoVlcTimer);
  state.liveAutoVlcTimer = null;
  state.liveRecoveryInFlight = false;
  state.liveRecoveryHistory = [];
  state.liveStableSince = 0;
  clearTimeout(liveControlTimeout);
  destroyHls("live");
  stopMedia(elements.video);
  if (elements.videoLoading) elements.videoLoading.hidden = true;
  if (elements.customControls) {
    elements.customControls.hidden = true;
    elements.customControls.classList.remove("active");
  }
  setExternalPlayerFallback("live", null);
  if (clearSelection) state.selected = null;
}

function stopVodPlayback() {
  state.vod.retryToken += 1;
  clearTimeout(vodControlTimeout);
  destroyHls("vod");
  stopMedia(elements.vodVideo);
  if (elements.vodVideoLoading) elements.vodVideoLoading.hidden = true;
  if (elements.vodPlayerControls) {
    elements.vodPlayerControls.hidden = true;
    elements.vodPlayerControls.classList.remove("active");
  }
  if (elements.vodPlayerSection) elements.vodPlayerSection.hidden = true;
  if (elements.vodNotice) elements.vodNotice.hidden = true;
  setExternalPlayerFallback("vod", null);
  document.body.classList.remove("vod-playing");
}

function showSetup() {
  stopLivePlayback(true);
  stopVodPlayback();
  stopDashboardHeroRotation();
  elements.setup.hidden = false;
  elements.topbar.hidden = true;
  elements.modebar.hidden = true;
  elements.workspace.hidden = true;
  elements.vodWorkspace.hidden = true;
  elements.seriesWorkspace.hidden = true;
  elements.dashboardWorkspace.hidden = true;
  elements.favoritesWorkspace.hidden = true;
  elements.settingsModal.hidden = true;
  elements.vodModal.hidden = true;
  elements.pinModal.hidden = true;
  elements.setupError.hidden = true;
  if (elements.mac && !elements.mac.value) elements.mac.value = generatedMac();
  setStatus("Setup required");
  requestAnimationFrame(() => {
    /* Reconfigure must be immediately usable with a keyboard. */
    elements.mac?.focus();
  });
}

/* =====================================================
   MODE
===================================================== */

function setMode(mode) {
  const isLive = mode === "live";
  const isContent = mode === "content";
  const isDashboard = mode === "dashboard";
  const isFavorites = mode === "favorites";

  if (!isDashboard) stopDashboardHeroRotation();
  if (isLive) stopVodPlayback();
  else stopLivePlayback(false);

  const lockAgain = !isContent && state.parentalUnlocked;
  if (!isContent) state.parentalUnlocked = false;

  if (!isContent) stopVodPlayback();
  elements.workspace.hidden = !isLive;
  elements.dashboardWorkspace.hidden = !isDashboard;
  elements.favoritesWorkspace.hidden = !isFavorites;
  // Movies and series share one provider catalogue. The legacy series
  // workspace remains in the markup only for backwards compatibility.
  elements.vodWorkspace.hidden = !isContent;
  elements.seriesWorkspace.hidden = true;

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  if (lockAgain) renderContentModeScreens();

  if (mode === "settings") {
    elements.settingsModal.hidden = false;
    return;
  }
  if (isDashboard) {
    renderDashboard();
    if (!state.vod.categories.length) loadVodCategories();
  }
  if (isFavorites) renderFavorites();
  if (isContent && !state.vod.categories.length) loadVodCategories();
  updateContentModeUnlockButton();
}

function clearVodSearchState() {
  /* Navigation into the shared catalogue is a fresh All view. Cancel any
     pending search work so an old Home/search callback cannot repaint it. */
  clearTimeout(vodSearchTimer);
  clearTimeout(vodSearchPollTimer);
  state.vod.searchToken += 1;
  state.vod.query = "";
  state.vod.searchResults = null;
  state.vod.searching = false;
  state.vod.searchIndexing = false;
  state.vod.searchIndexedItems = 0;
  state.vod.searchTotalItems = 0;
  if (elements.vodSearch) elements.vodSearch.value = "";
}

async function openContentBrowser() {
  state.parentalUnlocked = false;
  clearVodSearchState();
  state.vod.filter = "all";
  setMode("content");
  if (!state.vod.categories.length) {
    await loadVodCategories();
  }
  if (!state.vod.categories.length) return;
  const allCategory = state.vod.categories.find((category) => category.id === "*") || state.vod.categories[0];
  if (!allCategory) {
    renderVodCategories();
    renderVodGrid();
    return;
  }

  /* Home playback can leave the mixed catalogue on a type filter while the
     selected provider category is still `*`. Re-render that same category
     after restoring All; otherwise the sidebar changes but the old empty
     grid stays on screen until another category is clicked. */
  if (state.vod.categoryId !== allCategory.id || !state.vod.items.length) {
    await selectVodCategory(allCategory.id);
  } else {
    renderVodCategories();
    renderVodGrid();
  }
}

async function restoreVodBrowserAfterPlayback() {
  clearVodSearchState();
  state.vod.filter = "all";
  if (!state.vod.categories.length) {
    await loadVodCategories();
  }
  if (!state.vod.categories.length) return;
  const allCategory = state.vod.categories.find((category) => category.id === "*") || state.vod.categories[0];
  if (!allCategory) return;

  if (state.vod.categoryId !== allCategory.id || !state.vod.items.length) {
    await selectVodCategory(allCategory.id);
    return;
  }
  renderVodCategories();
  renderVodGrid();
}

function setContentType(type) {
  // Compatibility shim for saved dashboard/favourite entries from v1.4.
  setVodFilter(type === "series" ? "series" : type === "movie" ? "movie" : "all");
}

function setVodFilter(filter) {
  state.contentType = "vod";
  state.vod.filter = ["all", "movie", "series"].includes(filter) ? filter : "all";
  document.querySelectorAll(".content-type-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.contentFilter === state.vod.filter);
  });
  renderVodGrid();
  setMode("content");
}

/* =====================================================
   MAC / PIN INPUT
   Locally administered 02 series.
   02A4B6123456 => 02:A4:B6:12:34:56
===================================================== */

function formatMacValue(raw) {
  const hex = String(raw || "")
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .slice(0, 12);

  return (hex.match(/.{1,2}/g) || []).join(":");
}

function keepCaretAtEnd(input) {
  requestAnimationFrame(() => {
    try {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    } catch {}
  });
}

if (elements.mac) {
  elements.mac.removeAttribute("readonly");
  elements.mac.removeAttribute("disabled");
  elements.mac.readOnly = false;
  elements.mac.disabled = false;
  elements.mac.value = formatMacValue(elements.mac.value);

  /* Do not rewrite the value on every keystroke. A pre-filled 17-character
     MAC made the old handler discard the first replacement character. */
  elements.mac.addEventListener("blur", () => {
    elements.mac.value = formatMacValue(elements.mac.value);
  });

  elements.mac.addEventListener("paste", (event) => {
    const value = event.clipboardData?.getData("text");
    if (!value) return;
    event.preventDefault();
    elements.mac.value = formatMacValue(value);
    keepCaretAtEnd(elements.mac);
  });
}

for (const input of [elements.parentalPin, elements.unlockPin, elements.currentParentalPin, elements.newParentalPin, elements.recoveryNewPin]) {
  if (!input) continue;
  input.removeAttribute("readonly");
  input.removeAttribute("disabled");
  input.readOnly = false;
  input.disabled = false;
  input.setAttribute("inputmode", "numeric");
  input.addEventListener("input", () => {
    const clean = input.value.replace(/\D/g, "").slice(0, 4);
    if (input.value !== clean) input.value = clean;
  });
}

function generatedMac() {
  /* 02 marks this as a locally administered, unicast MAC-style identifier.
     The remaining bytes are random and editable by the user. */
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `02:${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join(":").toUpperCase()}`;
}

function showPortalEditor(portal = null) {
  if (!elements.portalEditorModal) return;
  elements.portalEditorTitle.textContent = portal ? "Edit Portal" : "Add Portal";
  elements.portalEditorId.value = portal?.id || "";
  elements.portalEditorNickname.value = portal?.nickname || "";
  elements.portalEditorUrl.value = portal?.portalUrl || "";
  const reusableMac = state.portals[0]?.mac || elements.mac?.value || generatedMac();
  elements.portalEditorMac.value = formatMacValue(portal?.mac || reusableMac);
  elements.portalEditorNotice.hidden = true;
  elements.portalEditorModal.hidden = false;
  requestAnimationFrame(() => elements.portalEditorNickname.focus());
}

function renderPortalList() {
  if (!elements.portalList) return;
  const nodes = state.portals.map((portal) => {
    const row = document.createElement("div"); row.className = "portal-row";
    const copy = document.createElement("div"); copy.className = "portal-row-copy";
    const title = document.createElement("strong"); title.textContent = portal.nickname || "Portal";
    const meta = document.createElement("small"); meta.textContent = portal.id === state.activePortalId ? "Active portal" : "Available portal";
    copy.append(title, meta);
    const actions = document.createElement("div"); actions.className = "portal-row-actions";
    const activate = document.createElement("button"); activate.type = "button"; activate.textContent = portal.id === state.activePortalId ? "Active" : "Use"; activate.disabled = portal.id === state.activePortalId;
    activate.addEventListener("click", () => activatePortal(portal.id));
    const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Edit"; edit.addEventListener("click", () => showPortalEditor(portal));
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = "Delete portal"; remove.disabled = state.portals.length < 2; remove.addEventListener("click", () => deletePortal(portal.id));
    actions.append(activate, edit, remove); row.append(copy, actions); return row;
  });
  elements.portalList.replaceChildren(...(nodes.length ? nodes : [Object.assign(document.createElement("p"), { className: "list-note", textContent: "No portals added yet." })]));
}

async function loadPortals() {
  const result = await request("/api/portals");
  state.portals = Array.isArray(result.portals) ? result.portals : [];
  state.activePortalId = result.activePortalId || state.portals[0]?.id || null;
  state.subscription = result.subscription || state.subscription;
  try { state.subscription = (await request("/api/subscription")).subscription || state.subscription; } catch { /* profile data is optional */ }
  renderPortalList();
  renderSubscription();
}

function renderSubscription() {
  const subscription = state.subscription;
  if (!elements.subscriptionPlan || !elements.subscriptionExpiry || !elements.subscriptionStatus) return;
  const date = subscription?.expiryDate ? new Date(subscription.expiryDate) : null;
  const expired = date && !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
  elements.subscriptionPlan.textContent = subscription?.plan || "Subscription details";
  elements.subscriptionExpiry.textContent = subscription?.unlimited
    ? "Expiry date: No expiry · Unlimited"
    : subscription?.expiryDate && date && !Number.isNaN(date.getTime())
      ? `Expiry date: ${new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date)}`
      : "Expiry date: Not provided by provider";
  elements.subscriptionStatus.textContent = expired ? "Expired" : subscription?.status || (subscription?.expiryDate || subscription?.unlimited ? "Active" : "Provider data");
  elements.subscriptionStatus.classList.toggle("is-expired", Boolean(expired));
}

async function activatePortal(id) {
  try { const result = await request("/api/portals/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); state.portals = result.portals || state.portals; state.activePortalId = result.activePortalId || id; renderPortalList(); await refreshPortalWithProgress(state.portals.find((portal) => portal.id === state.activePortalId)?.nickname || "Portal"); setSettingsNotice("Active portal changed. Content refreshed."); }
  catch (error) { setSettingsNotice(error.message, false); }
}

function setPortalLoadingProgress(value, phase, status) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if (elements.portalProgressBar) elements.portalProgressBar.style.width = `${progress}%`;
  if (elements.portalProgressLabel) elements.portalProgressLabel.textContent = `${progress}%`;
  if (elements.portalProgressPhase) elements.portalProgressPhase.textContent = phase || "Working";
  if (elements.portalLoadingStatus && status) elements.portalLoadingStatus.textContent = status;
  elements.portalLoadingModal?.querySelector(".portal-progress")?.setAttribute("aria-valuenow", String(progress));
}

function showPortalLoading(title) {
  if (!elements.portalLoadingModal) return;
  elements.portalLoadingTitle.textContent = `${title || "Portal"} · Loading`;
  elements.portalLoadingError.hidden = true;
  elements.portalLoadingBackButton.hidden = true;
  elements.portalLoadingModal.classList.remove("is-error");
  setPortalLoadingProgress(0, "Starting", "Connecting to portal…");
  elements.portalLoadingModal.hidden = false;
}

function failPortalLoading(error) {
  const message = "Could not load this portal. The server may be expired or unavailable. Please connect with your provider.";
  setPortalLoadingProgress(100, "Unable to connect", "Portal could not be loaded");
  elements.portalLoadingModal?.classList.add("is-error");
  if (elements.portalLoadingError) { elements.portalLoadingError.textContent = message; elements.portalLoadingError.hidden = false; }
  if (elements.portalLoadingBackButton) elements.portalLoadingBackButton.hidden = false;
  recordClientDiagnostic("client.portal_load_failed", { message: error?.message || "unknown" });
}

async function refreshPortalWithProgress(title, options = {}) {
  const { alreadyVisible = false } = options;
  if (!alreadyVisible) showPortalLoading(title);
  else {
    elements.portalLoadingTitle.textContent = `${title || "Portal"} · Loading`;
    setPortalLoadingProgress(5, "Preparing", "Preparing portal connection…");
  }
  try {
    const loaded = await refreshContent(false, { throwOnError: true, onProgress: setPortalLoadingProgress });
    if (!loaded) throw new Error("Portal catalogue was not loaded.");
    setPortalLoadingProgress(100, "Complete", "Portal loaded successfully");
    /* Leave the completed state visible long enough to be understood before
       revealing Home. Otherwise a fast success looks like a 28% bar that
       simply vanished. */
    await new Promise((resolve) => setTimeout(resolve, 1000));
    elements.portalLoadingModal.hidden = true;
    return true;
  } catch (error) {
    failPortalLoading(error);
    return false;
  }
}

async function deletePortal(id) {
  if (!window.confirm("Delete this portal?")) return;
  try { const result = await request(`/api/portals/${encodeURIComponent(id)}`, { method: "DELETE" }); state.portals = result.portals || []; state.activePortalId = result.activePortalId || null; renderPortalList(); setSettingsNotice("Portal deleted."); }
  catch (error) { setSettingsNotice(error.message, false); }
}

for (const input of [elements.mac, elements.parentalPin, elements.unlockPin, elements.currentParentalPin, elements.newParentalPin, elements.recoveryNewPin]) {
  input?.addEventListener("pointerdown", (event) => event.stopPropagation());
  input?.addEventListener("click", () => input.focus());
}

elements.recoveryCodeInput?.addEventListener("input", () => {
  elements.recoveryCodeInput.value = elements.recoveryCodeInput.value.replace(/\D/g, "").slice(0, 8);
});

/* =====================================================
   PARENTAL UNLOCK
===================================================== */

function closePinModal(cancelPending = true) {
  elements.pinModal.hidden = true;
  elements.unlockPin.value = "";
  elements.unlockPinError.hidden = true;
  if (cancelPending) state.pendingUnlockAction = null;
}

function requestParentalUnlock(action) {
  if (state.parentalUnlocked) {
    action?.();
    return;
  }
  state.pendingUnlockAction = action || null;
  elements.unlockPin.value = "";
  elements.unlockPinError.hidden = true;
  elements.pinModal.hidden = false;
  setTimeout(() => elements.unlockPin.focus(), 50);
}

/* Every protected VOD action goes through this wrapper.  The successful PIN
   submit already sets the flag, but setting it immediately before the
   deferred action also protects us from a render/category transition that
   happens between closing the PIN dialog and opening the title. */
function runAfterParentalUnlock(action) {
  requestParentalUnlock(() => {
    state.parentalUnlocked = true;
    action?.();
  });
}

elements.pinUnlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = elements.unlockPin.value.trim();

  if (!/^\d{4}$/.test(pin)) {
    elements.unlockPinError.textContent = "Enter your 4-digit parental PIN.";
    elements.unlockPinError.hidden = false;
    return;
  }

  elements.unlockPinButton.disabled = true;
  elements.unlockPinButton.textContent = "Unlocking...";

  try {
    await request("/api/parental/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    state.parentalUnlocked = true;
    const action = state.pendingUnlockAction;
    state.pendingUnlockAction = null;
    closePinModal(false);
    renderContentModeScreens();
    action?.();
  } catch (error) {
    elements.unlockPinError.textContent = error.message;
    elements.unlockPinError.hidden = false;
  } finally {
    elements.unlockPinButton.disabled = false;
    elements.unlockPinButton.textContent = "Unlock";
  }
});

elements.closePinModal.addEventListener("click", () => closePinModal(true));

elements.pinModal.addEventListener("click", (event) => {
  if (event.target === elements.pinModal) closePinModal(true);
});

/* =====================================================
   LIVE CATALOG
===================================================== */

function setVisibilityEye(target, isHidden, subject) {
  target.innerHTML = isHidden
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.9 10.9 0 0 1 12 5c6.5 0 9.7 7 9.7 7a17 17 0 0 1-3.1 4.1M6.2 6.3C3.9 7.8 2.3 12 2.3 12S5.5 19 12 19c1.1 0 2.2-.2 3.1-.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.3 12S5.5 5 12 5s9.7 7 9.7 7-3.2 7-9.7 7-9.7-7-9.7-7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  target.setAttribute("role", "button");
  target.tabIndex = 0;
  target.setAttribute("aria-label", `${isHidden ? "Show" : "Hide"} ${subject}`);
  target.title = `${isHidden ? "Show" : "Hide"} ${subject}`;
}

function renderCategories() {
  if (!state.catalog) return;

  const scrollTop = elements.categories.scrollTop;

  const visiblePortalCategories = state.catalog.categories.filter(
    (category) => (state.editingGroups || !state.hiddenGroups.has(category.id)) &&
      contentModeAllows(CONTENT_MODES?.isRestrictedCategory(category) || Boolean(category.locked || category.adultLocked))
  );

  const categories = [
    { id: "favorites", title: "Favorites", locked: false },
    { id: "all", title: "All channels", locked: false },
    ...visiblePortalCategories,
  ];

  elements.groupCount.textContent = `${visiblePortalCategories.length.toLocaleString()} groups`;

  const nodes = categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${state.category === category.id ? " active" : ""}`;

    if (state.hiddenGroups.has(category.id)) button.classList.add("hidden-item");

    const title = document.createElement("span");
    title.textContent =
      category.locked && !state.parentalUnlocked ? `[PIN] ${category.title}` : category.title;

    if (state.editingGroups && !["all", "favorites"].includes(category.id)) {
      const visibility = document.createElement("span");
      visibility.className = "visibility-toggle";
      setVisibilityEye(visibility, state.hiddenGroups.has(category.id), category.title);
      visibility.addEventListener("click", (event) => {
        event.stopPropagation();
        if (state.hiddenGroups.has(category.id)) state.hiddenGroups.delete(category.id);
        else state.hiddenGroups.add(category.id);
        persistSet("hiddenGroups", state.hiddenGroups);
        renderCategories();
      });
      visibility.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") visibility.click();
      });
      button.append(visibility);
    }

    const arrow = document.createElement("em");
    arrow.textContent = ">";
    button.append(title, arrow);

    button.addEventListener("click", () => {
      if (state.editingGroups) return;

      if (state.category !== category.id) state.parentalUnlocked = false;

      const choose = async () => {
        state.category = category.id;
        renderCategories();
        if (!['all', 'favorites'].includes(category.id)) {
          const loaded = state.catalog.channels.some((channel) => String(channel.genreId) === String(category.id));
          if (!loaded && !(await loadLiveCategoryIntoCatalog(category.id))) return;
        }
        if (state.category === category.id) renderChannels();
      };

      if ((category.locked || category.adultLocked) && !state.parentalUnlocked) {
        requestParentalUnlock(choose);
        return;
      }

      choose();
    });

    return button;
  });

  elements.categories.replaceChildren(...nodes);
  elements.categories.scrollTop = scrollTop;
}

const liveCategoryLoads = new Map();
async function loadLiveCategoryIntoCatalog(categoryId) {
  if (!state.catalog || liveCategoryLoads.has(String(categoryId))) return liveCategoryLoads.get(String(categoryId));
  const key = String(categoryId);
  const pending = (async () => {
    elements.channelCount.textContent = "Loading channels…";
    elements.channels.replaceChildren(Object.assign(document.createElement("p"), {
      className: "list-note",
      textContent: "Loading channels for this category…",
    }));
    try {
      const result = await request(`/api/live/category?categoryId=${encodeURIComponent(key)}`);
      if (!Array.isArray(result.channels)) throw new Error("The provider returned an invalid channel list.");
      const known = new Set(state.catalog.channels.map((channel) => String(channel.id)));
      for (const channel of result.channels) {
        if (!channel?.id || known.has(String(channel.id))) continue;
        state.catalog.channels.push({ ...channel, id: String(channel.id), genreId: String(channel.genreId || key) });
        known.add(String(channel.id));
      }
      state.catalog.channels.sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
      return true;
    } catch (error) {
      if (state.category === key) {
        const note = document.createElement("p");
        note.className = "list-note";
        note.textContent = `${error.message} Select the category to retry.`;
        elements.channels.replaceChildren(note);
      }
      return false;
    } finally {
      liveCategoryLoads.delete(key);
    }
  })();
  liveCategoryLoads.set(key, pending);
  return pending;
}

function filteredChannels() {
  if (!state.catalog) return [];
  const query = state.query.trim();

  return state.catalog.channels.filter((channel) => {
    const category = categoryById(channel.genreId);
    if (category?.locked && !state.parentalUnlocked) return false;
    if (channel.adultLocked && !state.parentalUnlocked) return false;
    if (!canDisplayRestrictedContent(isRestrictedLiveChannel(channel))) return false;

    const inCategory =
      state.category === "favorites"
        ? state.favoriteChannels.has(channel.id)
        : state.category === "all" || channel.genreId === state.category;

    return (
      inCategory &&
      (!query || strictTitleSearchMatch({ title: channel.name }, query)) &&
      (state.editingChannels || !state.hiddenChannels.has(channel.id))
    );
  });
}

function renderChannels() {
  if (!state.catalog) return;

  const scrollTop = elements.channels.scrollTop;
  const filtered = filteredChannels();

  elements.channelCount.textContent = `${filtered.length.toLocaleString()} channels`;

  const rows = filtered.slice(0, 400).map((channel) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `channel-button${state.selected?.id === channel.id ? " active" : ""}`;

    if (state.hiddenChannels.has(channel.id)) button.classList.add("hidden-item");

    const toggle = document.createElement("span");

    if (state.editingChannels) {
      toggle.className = "visibility-toggle";
      setVisibilityEye(toggle, state.hiddenChannels.has(channel.id), channel.name);
    } else {
      toggle.className =
        `favorite-toggle${state.favoriteChannels.has(channel.id) ? " is-favorite" : ""}`;
      toggle.textContent = "★";
    }

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();

      if (state.editingChannels) {
        if (state.hiddenChannels.has(channel.id)) state.hiddenChannels.delete(channel.id);
        else state.hiddenChannels.add(channel.id);
        persistSet("hiddenChannels", state.hiddenChannels);
      } else {
        if (state.favoriteChannels.has(channel.id)) state.favoriteChannels.delete(channel.id);
        else state.favoriteChannels.add(channel.id);
        persistSet("favoriteChannels", state.favoriteChannels);
      }

      renderChannels();
    });
    if (state.editingChannels) {
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") toggle.click();
      });
    }

    const icon = document.createElement("span");
    icon.className = "channel-icon";
    icon.textContent = initials(channel.name);

    const copy = document.createElement("span");
    copy.className = "channel-copy";

    const name = document.createElement("strong");
    name.textContent = channel.name;

    const meta = document.createElement("small");
    meta.textContent =
      `${channel.number ? `Channel ${channel.number}` : "Live"}${channel.hd ? " · HD" : ""}`;

    copy.append(name, meta);

    const play = document.createElement("span");
    play.className = "channel-play";
    play.textContent = "Play";

    button.append(toggle, icon, copy, play);

    button.addEventListener("click", () => {
      if (!state.editingChannels) playLive(channel);
    });

    return button;
  });

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "list-note";
    empty.textContent =
      state.contentMode === "adult-only" && !state.parentalUnlocked
        ? "Unlock the selected content mode with your parental PIN."
        : state.category === "favorites"
        ? "No favorite channels yet. Tap ★ beside a channel to add it."
        : "No channels found.";
    if (state.contentMode === "adult-only" && !state.parentalUnlocked) {
      const unlock = document.createElement("button");
      unlock.type = "button";
      unlock.className = "secondary-wide-button";
      unlock.textContent = "Unlock with parental PIN";
      unlock.addEventListener("click", unlockContentMode);
      empty.append(document.createElement("br"), unlock);
    }
    rows.push(empty);
  } else if (filtered.length > 400) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent = "Showing the first 400 matches. Search to narrow the list.";
    rows.push(note);
  }

  elements.channels.replaceChildren(...rows);

  /* v1.4: selecting a channel must not jump list back to top. */
  requestAnimationFrame(() => {
    elements.channels.scrollTop = scrollTop;
  });
}

async function loadCatalog(options = {}) {
  const { onProgress = null, throwOnError = false } = options;
  const startedAt = Date.now();
  onProgress?.(8, "Connecting", "Connecting to portal…");
  elements.setup.hidden = true;
  elements.topbar.hidden = false;
  elements.modebar.hidden = false;
  elements.workspace.hidden = false;

  setMode("live");
  setStatus("Connecting");
  showNotice("");

  elements.channels.innerHTML = '<p class="list-note">Loading portal catalogue...</p>';

  try {
    onProgress?.(28, "Authorizing", "Checking portal access…");
    state.catalog = await request("/api/catalog");
    onProgress?.(72, "Catalogue", "Loading channels and catalogue…");
    setStatus("Ready", true);
    localStorage.setItem("netplusLastContentRefresh", String(Date.now()));

    if (
      state.category !== "all" &&
      state.category !== "favorites" &&
      !categoryById(state.category)
    ) {
      state.category = "all";
    }

    renderCategories();
    renderChannels();
    trackAnalytics("portal_load_success", {
      screen: "live",
      durationSec: (Date.now() - startedAt) / 1000,
      success: true,
    });
    onProgress?.(92, "Finalizing", "Preparing your home screen…");
    setMode("dashboard");
    onProgress?.(100, "Complete", "Portal loaded successfully");
    return true;
  } catch (error) {
    setStatus("Connection failed");
    showNotice(error.message);
    trackAnalytics("portal_load_failed", {
      screen: "live",
      durationSec: (Date.now() - startedAt) / 1000,
      errorType: analyticsErrorType(error, "portal-load"),
      statusCode: error.status,
      success: false,
    });
    onProgress?.(100, "Unable to connect", "Portal could not be loaded");
    if (throwOnError) throw error;
    return false;
  }
}

async function refreshLiveCatalogAndRetry(selectedId, reason = "stale-channel") {
  if (!selectedId || state.selected?.id !== selectedId) return false;
  if (state.liveCatalogRefreshes >= 1) {
    livePlaybackFailed("This channel is no longer available. Live TV catalogue was refreshed; please choose another channel.");
    return false;
  }

  state.liveCatalogRefreshes += 1;
  const previousCategory = state.category;
  showNotice("Refreshing the Live TV catalogue…");
  trackAnalytics("feature_used", { screen: "live", reason: "catalogue-refresh" });

  try {
    await request("/api/refresh", { method: "POST" });
    const catalog = await request("/api/catalog");
    if (state.selected?.id !== selectedId) return false;
    state.catalog = catalog;
    localStorage.setItem("netplusLastContentRefresh", String(Date.now()));
    if (
      previousCategory !== "all" &&
      previousCategory !== "favorites" &&
      !categoryById(previousCategory)
    ) state.category = "all";

    const freshChannel = state.catalog.channels.find((channel) => String(channel.id) === String(selectedId));
    renderCategories();
    if (!freshChannel) {
      state.selected = null;
      renderChannels();
      livePlaybackFailed("This channel is no longer available. Please choose another channel.");
      return false;
    }

    state.selected = { ...freshChannel, kind: "live" };
    renderChannels();
    await playSelectedLive(true);
    return true;
  } catch (error) {
    showNotice("Could not refresh the Live TV catalogue. Please try again later.");
    trackAnalytics("playback_failed", {
      screen: "live",
      player: getDefaultPlayer(),
      errorType: analyticsErrorType(error, reason),
      statusCode: error.status,
      success: false,
    });
    return false;
  }
}

/* =====================================================
   LIVE PLAYBACK
===================================================== */

function resetLivePlayer() {
  stopLivePlayback(false);
  elements.progressBar.style.width = "100%";
  elements.timeDisplay.textContent = "LIVE";
}

function livePlaybackFailed(message, stream = "") {
  stopLivePlayback(false);
  elements.videoLoading.hidden = true;
  trackAnalytics("playback_failed", {
    screen: "live",
    player: getDefaultPlayer(),
    errorType: analyticsErrorType({ message }, "live-playback"),
    success: false,
  });
  showNotice(message, stream ? {
    stream,
    title: state.selected?.name || "Live TV",
  } : null);
}

function showLivePlaybackFailure(message, stream = "") {
  if (getDefaultPlayer() === "auto" && stream && openPreferredExternalPlayer("live", stream, state.selected?.name || "Live TV", { automatic: true })) {
    return;
  }
  livePlaybackFailed(message, stream);
}

function scheduleLiveAutoVlcFallback(stream, title, token) {
  clearTimeout(state.liveAutoVlcTimer);
  state.liveAutoVlcTimer = null;
  if (getDefaultPlayer() !== "auto" || !stream) return;

  state.liveAutoVlcTimer = setTimeout(() => {
    state.liveAutoVlcTimer = null;
    if (token !== state.liveRetryToken || !state.selected || state.selected.kind !== "live") return;
    if (getDefaultPlayer() !== "auto") return;

    const isPlaying = !elements.video.paused && elements.video.readyState >= 3;
    if (isPlaying) return;

    recordClientDiagnostic("client.live_auto_vlc_fallback", {
      channelId: state.selected.id,
      reason: "not-playing-after-timeout",
    });
    openPreferredExternalPlayer("live", stream, title, { automatic: true });
  }, 3000);
}

function attachLiveHls(stream, token) {
  const hls = new window.Hls({
    enableWorker: false,
    lowLatencyMode: false,
    /* Keep several live segments available. A one-segment sync window made
       ordinary provider jitter look like a permanent buffering failure. */
    backBufferLength: 30,
    maxBufferLength: 90,
    maxMaxBufferLength: 180,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    liveDurationInfinity: true,
    maxLiveSyncPlaybackRate: 1.05,
    startFragPrefetch: true,
    highBufferWatchdogPeriod: 2,
    nudgeOffset: 0.1,
    nudgeMaxRetry: 5,
    maxStarvationDelay: 15,
    maxLoadingDelay: 15,
    manifestLoadingTimeOut: 30000,
    levelLoadingTimeOut: 30000,
    fragLoadingTimeOut: 30000,
    manifestLoadingMaxRetry: 8,
    levelLoadingMaxRetry: 8,
    fragLoadingMaxRetry: 12,
    fragLoadingRetryDelay: 750,
    fragLoadingMaxRetryTimeout: 16000,
  });

  state.hls = hls;

  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let stallRecoveries = 0;
  let lastSoftRecoveryAt = 0;
  let lastResetRecoveryAt = 0;
  let lastStallRecoveryAt = 0;

  const freshLink = (reason = "hls-error") => {
    if (token !== state.liveRetryToken || !state.selected) return;
    if (state.liveRecoveryInFlight) return;

    const now = Date.now();
    state.liveRecoveryHistory = state.liveRecoveryHistory.filter(
      (timestamp) => now - timestamp < 30_000
    );

    if (state.liveRecoveryHistory.length >= 4) {
      showLivePlaybackFailure(
        "The built-in player could not decode this stream after several recovery attempts."
        + " You can open it in VLC.",
        stream
      );
      return;
    }

    state.liveRecoveryInFlight = true;
    state.liveRecoveryHistory.push(now);
    const selectedId = state.selected.id;
    const recoveryToken = ++state.liveRetryToken;

    /* Detach the broken MediaSource before requesting the replacement link.
       Waiting for /api/play while the old HLS instance is still alive caused
       a burst of repeated reset errors and duplicate fragment requests. */
    clearInterval(state.liveWatchdogTimer);
    state.liveWatchdogTimer = null;
    try { hls.destroy(); } catch {}
    if (state.hls === hls) state.hls = null;
    stopMedia(elements.video);

    recordClientDiagnostic("client.live_link_renewal", {
      channelId: selectedId,
      reason,
      attemptsInWindow: state.liveRecoveryHistory.length,
    });
    elements.videoLoading.hidden = false;

    request("/api/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: selectedId }),
    }).then((payload) => {
      if (recoveryToken !== state.liveRetryToken || state.selected?.id !== selectedId) {
        state.liveRecoveryInFlight = false;
        return;
      }

      state.liveRecoveryInFlight = false;
      const renewedStream = String(payload?.stream || "");
      if (!renewedStream) {
        showLivePlaybackFailure("This channel is temporarily unavailable. Please try again later or contact your provider.");
        return;
      }
      showNotice("");
      attachLiveHls(renewedStream, recoveryToken);
    }).catch((error) => {
      if (recoveryToken !== state.liveRetryToken || state.selected?.id !== selectedId) return;
      state.liveRecoveryInFlight = false;
      recordClientDiagnostic("client.live_link_renewal_failed", {
        channelId: selectedId,
        reason,
        message: String(error?.message || error),
      });
      if (error.status === 404) {
        void refreshLiveCatalogAndRetry(selectedId, "stale-channel");
        return;
      }
      showNotice("Refreshing the Live TV link...");

      setTimeout(() => {
        if (recoveryToken === state.liveRetryToken && state.selected?.id === selectedId) {
          playSelectedLive(true);
        }
      }, 1_000);
    });
  };

  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (token !== state.liveRetryToken) return;
    trackAnalytics("playback_started", {
      screen: "live",
      player: "internal",
      success: true,
    });
    recordClientDiagnostic("client.live_manifest_parsed", {
      channelId: state.selected?.id || "",
      title: state.selected?.name || "",
    });
    elements.videoLoading.hidden = true;
    elements.customControls.hidden = false;
    elements.video.play().catch(() => {});
  });

  hls.on(window.Hls.Events.FRAG_LOADED, () => {
    networkRecoveries = 0;
    mediaRecoveries = 0;
    stallRecoveries = 0;
    state.liveLastFragmentAt = Date.now();
    if (!state.liveStableSince) state.liveStableSince = Date.now();
    if (Date.now() - state.liveStableSince >= 15_000) {
      state.liveRecoveryHistory = [];
      state.liveStableSince = Date.now();
    }
    recordClientDiagnostic("client.live_fragment_loaded", {
      channelId: state.selected?.id || "",
    });
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (token !== state.liveRetryToken) return;

    recordClientDiagnostic("client.live_hls_error", {
      channelId: state.selected?.id || "",
      ...hlsDiagnosticDetails(data),
    });

    const details = String(data.details || data.reason || "");
    const isLevelParsingError = /levelParsingError/i.test(details);
    const isMseCorruption = /mediaSourceRequiresReset|bufferAppendNoProgress/i.test(details);
    const isBufferStall = /bufferStalledError|bufferAppendNoProgress/i.test(details);
    const isBufferHole = /bufferSeekOverHole/i.test(details);
    const isUnsupportedCodec = /manifestIncompatibleCodecsError/i.test(details);
    const responseCode = Number(data?.response?.code || 0);
    const now = Date.now();

    if (isUnsupportedCodec) {
      showLivePlaybackFailure("This channel uses an audio/video codec that this player cannot decode.", stream);
      return;
    }

    if (responseCode === 415) {
      showLivePlaybackFailure("This channel uses an audio/video codec that this player cannot decode.", stream);
      return;
    }

    /*
      These two HLS.js events are often recoverable signals on rolling IPTV
      playlists. Recreating the portal link for every non-fatal event caused
      the visible 10-20 second playback / 2-3 second reload cycle.
    */
    if (!data.fatal && isLevelParsingError) {
      if (now - lastSoftRecoveryAt > 8_000) {
        lastSoftRecoveryAt = now;
        try { hls.startLoad(-1); } catch { freshLink("level-parsing"); }
      }
      return;
    }

    if (isMseCorruption) {
      if (now - lastResetRecoveryAt > 8_000) {
        lastResetRecoveryAt = now;
        /* Do not call recoverMediaError for a corrupted MediaSource. It can
           keep the broken MSE instance alive and make HLS.js request the same
           live fragments repeatedly. Detach it and obtain a clean link. */
        freshLink(details.includes("bufferAppendNoProgress")
          ? "buffer-append-no-progress"
          : "media-source-reset");
      }
      return;
    }

    if (!data.fatal && (isBufferStall || isBufferHole)) {
      if (now - lastStallRecoveryAt > 4_000) {
        lastStallRecoveryAt = now;
        stallRecoveries += 1;
        if (stallRecoveries >= 3) {
          freshLink("buffer-stall");
        } else {
          try { hls.startLoad(-1); } catch { freshLink("buffer-stall-retry"); }
        }
      }
      return;
    }

    /* Expired CDN links and HTML redirects need a new portal link now. */
    if (
      [401, 403, 404, 410, 502, 504].includes(responseCode) ||
      /manifestParsingError|no EXTM3U delimiter/i.test(details)
    ) {
      freshLink(responseCode ? `http-${responseCode}` : "invalid-manifest");
      return;
    }

    if (!data.fatal) return;

    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      if (networkRecoveries < 3) {
        networkRecoveries += 1;
        setTimeout(() => {
          if (token !== state.liveRetryToken) return;
          try { hls.startLoad(-1); } catch { freshLink("network-retry-failed"); }
        }, Math.min(600 * networkRecoveries, 2400));
        return;
      }

      /* Important for short-lived IPTV create_link URLs. */
      freshLink("network-retries-exhausted");
      return;
    }

    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
      if (mediaRecoveries < 2) {
        mediaRecoveries += 1;
        try {
          if (mediaRecoveries === 2 && typeof hls.swapAudioCodec === "function") {
            hls.swapAudioCodec();
          }
          hls.recoverMediaError();
          return;
        } catch {}
      }

      freshLink("media-recovery-exhausted");
      return;
    }

    freshLink("fatal-hls-error");
  });

  hls.loadSource(stream);
  hls.attachMedia(elements.video);
  state.liveLastFragmentAt = Date.now();
  scheduleLiveAutoVlcFallback(stream, state.selected?.name || "Live TV", token);
  clearInterval(state.liveWatchdogTimer);
  state.liveWatchdogTimer = setInterval(() => {
    if (token !== state.liveRetryToken || !state.selected || elements.video.paused) return;
    const now = Date.now();
    const idleFor = now - state.liveLastFragmentAt;

    if (idleFor > 45_000) {
      freshLink("fragment-watchdog");
      return;
    }

    if (idleFor > 25_000 && now - lastSoftRecoveryAt > 20_000) {
      lastSoftRecoveryAt = now;
      try { hls.startLoad(-1); } catch { freshLink("watchdog-retry-failed"); }
    }
  }, 5_000);
}

async function playSelectedLive(isRecovery = false) {
  if (!state.selected || state.selected.kind !== "live") return;

  const selected = state.selected;

  if (!isRecovery) {
    resetLivePlayer();
  } else {
    destroyHls("live");
    stopMedia(elements.video);
  }

  const token = ++state.liveRetryToken;

  elements.placeholder.hidden = true;
  elements.videoLoading.hidden = false;
  showNotice("");

  elements.controlTitle.textContent = selected.name;
  elements.controlEpg.textContent = "Live TV";
  elements.playerModeBadge.textContent = "LIVE";
  elements.nowPlaying.textContent = selected.name;

  let playbackStream = "";
  try {
    const payload = await request("/api/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId: selected.id }),
    });

    if (token !== state.liveRetryToken || state.selected?.id !== selected.id) return;
    playbackStream = String(payload.stream || "");
    if (!playbackStream) throw new Error("The provider did not return a playable link.");

    if (getDefaultPlayer() === "vlc") {
      elements.videoLoading.hidden = true;
      openPreferredExternalPlayer("live", playbackStream, selected.name);
      return;
    }

    if (window.Hls?.isSupported()) {
      attachLiveHls(playbackStream, token);
      return;
    }

    if (elements.video.canPlayType("application/vnd.apple.mpegurl")) {
      elements.video.src = playbackStream;
      scheduleLiveAutoVlcFallback(playbackStream, selected.name, token);
      elements.video.addEventListener("loadedmetadata", () => {
        if (token !== state.liveRetryToken) return;
        elements.videoLoading.hidden = true;
        elements.customControls.hidden = false;
        trackAnalytics("playback_started", {
          screen: "live",
          player: "internal",
          success: true,
        });
        elements.video.play().catch(() => {});
      }, { once: true });
      return;
    }

    if (getDefaultPlayer() === "auto" && openPreferredExternalPlayer("live", playbackStream, selected.name)) {
      return;
    }

    throw new Error("Built-in HLS playback is unavailable. Select VLC in Settings or install VLC.");
  } catch (error) {
    if (token === state.liveRetryToken) {
      if (error.status === 401 && state.liveAuthRetries < 2) {
        state.liveAuthRetries += 1;
        showNotice("Refreshing portal authorization…");
        setTimeout(() => {
          if (token === state.liveRetryToken && state.selected?.id === selected.id) playSelectedLive(true);
        }, 700 * state.liveAuthRetries);
        return;
      }
      if (error.status === 404) {
        void refreshLiveCatalogAndRetry(selected.id, "stale-channel");
        return;
      }
      showLivePlaybackFailure(
        "This channel is temporarily unavailable. Please try again later or contact your provider.",
        playbackStream
      );
    }
  }
}

function playLive(channel) {
  const category = categoryById(channel.genreId);

  const start = () => {
    state.selected = { ...channel, kind: "live" };
    state.liveAuthRetries = 0;
    state.liveCatalogRefreshes = 0;
    renderChannels();
    playSelectedLive(false);
  };

  if ((category?.locked || channel.adultLocked) && !state.parentalUnlocked) {
    requestParentalUnlock(start);
    return;
  }

  start();
}

elements.playInVlcButton?.addEventListener("click", () => playInVlc("live"));
elements.vodPlayInVlcButton?.addEventListener("click", () => playInVlc("vod"));

/* =====================================================
   LIVE CONTROLS
===================================================== */

let liveControlTimeout;

function revealLiveControls() {
  if (elements.customControls.hidden) return;
  elements.customControls.classList.add("active");
  clearTimeout(liveControlTimeout);
  liveControlTimeout = setTimeout(() => {
    elements.customControls.classList.remove("active");
  }, 3000);
}

elements.playerContainer.addEventListener("mousemove", revealLiveControls);
elements.playerContainer.addEventListener("click", revealLiveControls);
elements.playerContainer.addEventListener("pointermove", revealLiveControls);
elements.playerContainer.addEventListener("touchstart", revealLiveControls, { passive: true });
elements.video.addEventListener("click", revealLiveControls);

elements.playPauseBtn.addEventListener("click", () => {
  if (elements.video.paused) elements.video.play().catch(() => {});
  else elements.video.pause();
});

elements.video.addEventListener("play", () => {
  elements.playPauseBtn.textContent = "Pause";
});

elements.video.addEventListener("pause", () => {
  elements.playPauseBtn.textContent = "Play";
  elements.customControls.classList.add("active");
});

elements.muteBtn.addEventListener("click", () => {
  elements.video.muted = !elements.video.muted;
  elements.muteBtn.textContent = elements.video.muted ? "Muted" : "Vol";
  elements.volumeSlider.value = elements.video.muted ? "0" : String(elements.video.volume);
});

elements.volumeSlider.addEventListener("input", (event) => {
  const volume = Number(event.target.value);
  elements.video.volume = volume;
  elements.video.muted = volume === 0;
  elements.muteBtn.textContent = volume === 0 ? "Muted" : "Vol";
});

elements.fullscreenBtn.addEventListener("click", () => {
  toggleFullscreen(elements.playerContainer);
});

/* =====================================================
   VOD CATEGORIES / GRID
===================================================== */

function renderVodCategories() {
  const scrollTop = elements.vodCategories.scrollTop;

  const rows = state.vod.categories.filter((category) =>
    contentModeAllows(CONTENT_MODES?.isRestrictedCategory(category) || Boolean(category.locked || category.adultLocked))
  ).map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      `vod-category-button${state.vod.categoryId === category.id ? " active" : ""}`;

    const title = document.createElement("span");
    title.textContent = category.title;
    button.append(title);

    if (category.locked && !state.parentalUnlocked) {
      const lock = document.createElement("span");
      lock.className = "vod-lock";
      lock.textContent = "PIN";
      button.append(lock);
    }

    button.addEventListener("click", () => {
      const choose = (verified = false) => selectVodCategory(category.id, verified);

      if (category.locked && !state.parentalUnlocked) {
        runAfterParentalUnlock(() => choose(true));
        return;
      }

      choose();
    });

    return button;
  });

  if (!rows.length) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent = "No VOD categories are available.";
    rows.push(note);
  }

  elements.vodCategories.replaceChildren(...rows);

  requestAnimationFrame(() => {
    elements.vodCategories.scrollTop = scrollTop;
  });
}

function setPoster(element, item) {
  element.textContent = initials(item.title);
  element.style.backgroundImage = "";
  element.classList.remove("has-poster");

  const url = String(item.poster || "").trim();
  if (!url) return;

  const paint = (source) => {
    element.textContent = "";
    const safeSource = String(source).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    element.style.backgroundImage =
      `linear-gradient(0deg, rgba(2,5,9,.62), transparent 60%), url("${safeSource}")`;
    element.classList.add("has-poster");
  };

  const load = (source, canProxy) => {
    const image = new Image();
    image.onload = () => paint(source);
    image.onerror = () => {
      if (canProxy && /^https?:\/\//i.test(source)) {
        load(`/api/poster?url=${encodeURIComponent(source)}`, false);
        return;
      }
      element.style.backgroundImage = "";
      element.textContent = initials(item.title);
    };
    image.src = source;
  };

  load(url, true);
}

function filterVodCollection(collection) {
  const query = state.vod.query.trim().toLowerCase();
  const typeFiltered = collection.filter((item) => {
    if (!canDisplayRestrictedContent(isRestrictedMedia(item))) return false;
    if (state.vod.filter === "series") return item.kind === "series" || item.isSeries === true;
    if (state.vod.filter === "movie") return item.kind !== "series" && item.isSeries !== true;
    return true;
  });
  if (!query) return typeFiltered;

  return typeFiltered.filter((item) => strictTitleSearchMatch(item, query));
}

function filteredVodItems() {
  /* A stale empty search array is still truthy in JavaScript. Use the loaded
     category items whenever the search box is empty so Home playback cannot
     leave the All view blank. */
  const hasSearchQuery = state.vod.query.trim().length > 0;
  const collection = hasSearchQuery && state.vod.searchResults !== null
    ? state.vod.searchResults
    : state.vod.items;
  return filterVodCollection(Array.isArray(collection) ? collection : []);
}

function renderVodGrid() {
  /* The mixed provider category is always the All view. A playback route
     can otherwise leave the old Movie/Series toggle in memory while the
     sidebar correctly highlights All, producing an empty-looking grid. */
  if (!state.vod.query.trim() && state.vod.categoryId === "*") state.vod.filter = "all";
  if (state.vod.searching && state.vod.searchResults === null) {
    elements.vodGrid.innerHTML = '<p class="list-note">Searching all Movies &amp; Series…</p>';
    elements.vodCategoryMeta.textContent = "Searching the full provider catalogue";
    return;
  }
  const items = filteredVodItems();

  const cards = items.map((item) => {
    const card = document.createElement("article");
    card.className = "vod-movie-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");

    const poster = document.createElement("span");
    poster.className = "vod-movie-poster";
    setPoster(poster, item);

    const isSeries = item.kind === "series" || item.isSeries === true;
    const play = document.createElement("span");
    play.className = `vod-card-play${isSeries ? " series-action" : ""}`;
    play.textContent = isSeries ? "Seasons" : "Play";

    const title = document.createElement("strong");
    title.textContent = item.title;

    const meta = document.createElement("small");
    meta.textContent =
      [isSeries ? "Series" : "Movie", item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ");

    const badge = document.createElement("span");
    badge.className = `vod-type-badge ${isSeries ? "is-series" : "is-movie"}`;
    badge.textContent = isSeries ? "SERIES" : "MOVIE";

    const favourite = document.createElement("button");
    favourite.type = "button";
    favourite.className = `media-favorite-toggle${isMediaFavorite(item) ? " is-favorite" : ""}`;
    favourite.textContent = "★";
    favourite.title = isMediaFavorite(item) ? "Remove from favourites" : "Add to favourites";
    favourite.setAttribute("aria-label", favourite.title);
    const toggleFavourite = (event) => {
      event.stopPropagation();
      const active = toggleMediaFavorite(item);
      favourite.classList.toggle("is-favorite", active);
      favourite.title = active ? "Remove from favourites" : "Add to favourites";
      favourite.setAttribute("aria-label", favourite.title);
    };
    favourite.addEventListener("click", toggleFavourite);
    favourite.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleFavourite(event); }
    });

    card.append(poster, play, badge, favourite, title, meta);
    card.addEventListener("click", () => openVodModal(item));
    card.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === card) {
        event.preventDefault();
        openVodModal(item);
      }
    });
    return card;
  });

  if (!cards.length) {
    const note = document.createElement("p");
    note.className = "list-note";
    note.textContent = state.contentMode === "adult-only" && !state.parentalUnlocked
      ? "Unlock the selected content mode with your parental PIN."
      : state.vod.query && state.vod.searchIndexing
      ? "Search is still scanning the provider catalogue…"
      : state.vod.query
        ? "No titles match your search across the provider catalogue."
        : "No titles were returned for this category.";
    if (state.contentMode === "adult-only" && !state.parentalUnlocked) {
      const unlock = document.createElement("button");
      unlock.type = "button";
      unlock.className = "secondary-wide-button";
      unlock.textContent = "Unlock with parental PIN";
      unlock.addEventListener("click", unlockContentMode);
      note.append(document.createElement("br"), unlock);
    }
    cards.push(note);
  }

  elements.vodGrid.replaceChildren(...cards);
  requestAnimationFrame(maybeLoadMoreVod);

  const category = vodCategoryById(state.vod.categoryId);
  const filterLabel = state.vod.filter === "series" ? "Series" : state.vod.filter === "movie" ? "Movies" : "Movies & Series";
  elements.vodCategoryTitle.textContent = state.vod.query ? "Search results" : category?.title || filterLabel;

  if (state.vod.searchIndexing) {
    elements.vodCategoryMeta.textContent =
      `${items.length.toLocaleString()} matches · scanning ${state.vod.searchIndexedItems.toLocaleString()} of ${state.vod.searchTotalItems.toLocaleString()} titles`;
  } else if (state.vod.query.trim()) {
    elements.vodCategoryMeta.textContent = `${items.length.toLocaleString()} matching titles${items.length >= 100 ? " · first 100 shown" : ""}`;
  } else {
    elements.vodCategoryMeta.textContent =
      state.vod.total > 0
        ? `${state.vod.items.length.toLocaleString()} loaded · ${state.vod.total.toLocaleString()} available`
        : `${state.vod.items.length.toLocaleString()} titles loaded · ${filterLabel}`;
  }
}

let vodCategoriesLoadPromise = null;

async function loadVodCategories() {
  if (state.vod.categories.length) {
    renderVodCategories();
    return;
  }
  if (vodCategoriesLoadPromise) return vodCategoriesLoadPromise;

  elements.vodCategories.innerHTML = '<p class="list-note">Loading categories...</p>';
  vodCategoriesLoadPromise = (async () => {
    try {
      const response = await request("/api/vod/categories");
      state.vod.categories = Array.isArray(response.categories) ? response.categories : [];
      renderVodCategories();

      const firstUnlocked =
        state.vod.categories.find((category) => !category.locked) ||
        state.vod.categories[0];

      if (firstUnlocked && !state.vod.categoryId) {
        if (firstUnlocked.locked && !state.parentalUnlocked) {
          elements.vodCategoryTitle.textContent = "Movies & Series";
          elements.vodCategoryMeta.textContent = "Choose a category from the left.";
        } else {
          await selectVodCategory(firstUnlocked.id);
        }
      }

      /* Start optional shelves after the first visible category has had the
         queue priority. The server returns progress immediately and the
         client polls while the small background shelf set fills in. */
      void loadVodShelves().catch((error) => {
        state.vod.localIndexError = error.message || "Category shelves could not load.";
        renderLocalCatalogueStatus();
      });
    } catch (error) {
      elements.vodCategories.textContent = error.message;
    }
  })();

  try {
    await vodCategoriesLoadPromise;
  } finally {
    vodCategoriesLoadPromise = null;
  }
}

async function selectVodCategory(categoryId, verified = false) {
  const category = vodCategoryById(categoryId);
  if (!category) return;

  if (verified) state.parentalUnlocked = true;
  if (!verified && state.vod.categoryId && state.vod.categoryId !== categoryId) state.parentalUnlocked = false;

  /* Cancel the previous category's request so it cannot leave the new
     category stuck in a loading state. */
  state.vod.requestController?.abort();
  state.vod.requestController = new AbortController();
  state.vod.loading = false;
  elements.vodLoadSpinner.hidden = true;

  clearTimeout(vodSearchPollTimer);
  state.vod.searchToken += 1;

  if (category.locked && !state.parentalUnlocked) {
    requestParentalUnlock(() => selectVodCategory(categoryId, true));
    return;
  }

  const selectionToken = ++state.vod.loadToken;
  state.vod.categoryId = categoryId;
  state.vod.page = 0;
  state.vod.total = 0;
  state.vod.items = [];
  state.vod.itemIds = new Set();
  state.vod.ended = false;
  state.vod.loading = false;
  state.vod.query = elements.vodSearch.value.trim();
  state.vod.searchResults = null;
  state.vod.searching = false;
  state.vod.searchIndexing = false;
  state.vod.searchIndexedItems = 0;
  state.vod.searchTotalItems = 0;
  state.vod.rateLimitRetries = 0;
  state.vod.duplicatePageRetries = 0;

  elements.vodEndMessage.hidden = true;
  elements.vodGrid.innerHTML = '<p class="list-note">Loading titles...</p>';

  renderVodCategories();
  await loadNextVodPage(true);
  if (selectionToken !== state.vod.loadToken || state.vod.categoryId !== categoryId) return;
  if (state.vod.localIndexReady && state.vod.query.length >= 3) {
    state.vod.searchResults = searchLocalVodIndex(state.vod.query);
    renderVodGrid();
  }
}

async function loadNextVodPage(reset = false) {
  if (state.vod.loading || state.vod.ended || !state.vod.categoryId) return;

  const categoryId = state.vod.categoryId;
  const category = vodCategoryById(categoryId);
  if (!category || (category.locked && !state.parentalUnlocked)) return;

  const token = state.vod.loadToken;
  const page = reset ? 0 : state.vod.page;
  const controller = state.vod.requestController;

  state.vod.loading = true;
  elements.vodLoadSpinner.hidden = false;
  elements.vodEndMessage.hidden = true;

  try {
    const result = await request(
      `/api/vod/items?categoryId=${encodeURIComponent(categoryId)}&page=${page}`,
      { signal: controller?.signal }
    );

    if (
      token !== state.vod.loadToken ||
      state.vod.categoryId !== categoryId ||
      state.vod.requestController !== controller
    ) return;

    const incoming = Array.isArray(result.items) ? result.items : [];
    let added = 0;

    for (const rawItem of incoming) {
      if (!rawItem?.id || state.vod.itemIds.has(rawItem.id)) continue;

      state.vod.itemIds.add(rawItem.id);
      state.vod.items.push({
        ...rawItem,
        kind: rawItem.kind || "vod",
        categoryId,
        categoryTitle: rawItem.categoryTitle || vodCategoryById(categoryId)?.title || "",
      });
      added += 1;
    }

    state.vod.total = Number(result.total) || state.vod.items.length;
    state.vod.page = page + 1;

    /* The portal reports cur_page=0 even when p advances. End only on an
       empty page or several truly duplicate pages. */
    if (incoming.length === 0) {
      state.vod.ended = true;
    } else if (added === 0 && page > 0 && state.vod.duplicatePageRetries < 6) {
      state.vod.duplicatePageRetries += 1;
      state.vod.loading = false;
      elements.vodLoadSpinner.hidden = true;
      elements.vodEndMessage.hidden = true;
      setTimeout(() => {
        if (
          token === state.vod.loadToken &&
          state.vod.categoryId === categoryId &&
          state.vod.requestController === controller
        ) loadNextVodPage(false);
      }, 180);
      return;
    } else if (added === 0) {
      state.vod.ended = true;
    } else {
      state.vod.duplicatePageRetries = 0;
    }
    state.vod.rateLimitRetries = 0;

    renderVodGrid();
    if (!elements.dashboardWorkspace.hidden) renderDashboard();
  } catch (error) {
    if (error.name === "AbortError") return;
    if (token === state.vod.loadToken) {
      if (/\b429\b/.test(String(error.message || "")) && state.vod.rateLimitRetries < 3) {
        state.vod.rateLimitRetries += 1;
        state.vod.loading = false;
        elements.vodLoadSpinner.hidden = true;
        elements.vodEndMessage.hidden = true;
        if (elements.vodLoadMoreButton) elements.vodLoadMoreButton.disabled = true;
        showNotice("Provider is busy. Retrying content in a moment…");
        setTimeout(() => {
          if (token === state.vod.loadToken) {
            if (elements.vodLoadMoreButton) elements.vodLoadMoreButton.disabled = false;
            loadNextVodPage(false);
          }
        }, 3500 * state.vod.rateLimitRetries);
        return;
      }
      if (!state.vod.items.length) elements.vodGrid.textContent = error.message;
      /* A network/provider error is not the end of a category. Keep the
         retry button usable instead of falsely showing “end of category”. */
      state.vod.ended = false;
      if (elements.vodLoadMoreButton) elements.vodLoadMoreButton.disabled = false;
      showNotice(`Could not load more titles: ${error.message}`);
    }
  } finally {
    if (token === state.vod.loadToken) {
      state.vod.loading = false;
      elements.vodLoadSpinner.hidden = true;
      elements.vodEndMessage.hidden = !state.vod.ended;
    }
  }
}

const vodObserver = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadNextVodPage(false);
  },
  { root: null, rootMargin: "500px 0px", threshold: 0.01 }
);

vodObserver.observe(elements.vodLoadMore);
elements.vodLoadMoreButton?.addEventListener("click", () => loadNextVodPage(false));

function maybeLoadMoreVod() {
  /* Dashboard loads a small recommendation sample, but it is not the VOD
     browser. Without this guard the hidden VOD sentinel keeps requesting
     pages and redraws the Home shelves repeatedly. */
  if (elements.vodWorkspace.hidden) return;
  if (state.vod.loading || state.vod.ended || state.vod.searching || state.vod.searchResults !== null) return;
  if (!state.vod.items.length || !elements.vodLoadMore || elements.vodLoadMore.hidden) return;

  const distance = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  if (distance < 900) loadNextVodPage(false);
}

window.addEventListener("scroll", maybeLoadMoreVod, { passive: true });
window.addEventListener("resize", maybeLoadMoreVod, { passive: true });

/* =====================================================
   VOD MODAL / PLAYBACK
===================================================== */

function vodFallbackParam(item) {
  const fallback = {
    id: item?.id,
    title: item?.title,
    description: item?.description,
    year: item?.year,
    rating: item?.rating,
    director: item?.director,
    actors: item?.actors,
    genre: item?.genre,
    language: item?.language,
    audioLanguage: item?.audioLanguage,
    categoryTitle: item?.categoryTitle,
    releaseDate: item?.releaseDate,
    path: item?.path,
    categoryId: item?.categoryId,
    categoryTitle: item?.categoryTitle,
    kind: item?.kind,
    isSeries: item?.isSeries === true,
    cmd: item?.cmd,
  };
  return encodeURIComponent(JSON.stringify(fallback));
}

async function openVodModal(item) {
  const itemCategory = vodCategoryById(item.categoryId);
  if (isRestrictedVodItem(item) && !state.parentalUnlocked) {
    runAfterParentalUnlock(() => openVodModal(item));
    return;
  }
  state.vod.selected = item;
  state.watchMeta[item.id] = {
    ...(state.watchMeta[item.id] || {}),
    ...item,
    mediaType: item.kind === "series" ? "series" : "vod",
  };
  saveWatchHistory();

  elements.vodModalTitle.textContent = item.title;
  elements.vodModalMeta.textContent = "Loading provider details…";
  elements.vodModalDescription.textContent = item.description || "Loading title details…";
  setPoster(elements.vodModalPoster, item);
  elements.vodModal.hidden = false;

  try {
    const result = await request(`/api/vod/item?categoryId=${encodeURIComponent(item.categoryId)}&itemId=${encodeURIComponent(item.id)}&fallback=${vodFallbackParam(item)}`);
    if (state.vod.selected?.id !== item.id) return;
    const detail = result.item || {};
    const merged = { ...item, ...detail, categoryId: item.categoryId };
    state.vod.selected = merged;
    state.watchMeta[item.id] = {
      ...(state.watchMeta[item.id] || {}),
      ...merged,
      mediaType: merged.kind === "series" ? "series" : "vod",
    };
    saveWatchHistory();
    if (merged.kind === "series" || merged.isSeries === true || (Array.isArray(result.seasons) && result.seasons.length)) {
      closeVodModal();
      openCombinedSeriesModal(merged, result);
      return;
    }
    populateVodModal(merged);
  } catch (error) {
    // A missing info response should not prevent a normal movie attempt.
    if (state.vod.selected?.id === item.id) {
      populateVodModal(item);
      showNotice(`Title details unavailable: ${error.message}`);
    }
  }
}

function populateVodModal(item) {
  elements.vodModalTitle.textContent = item.title;
  elements.vodModalMeta.textContent =
    [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "On demand";
  elements.vodModalDescription.textContent =
    item.description || "No description is available for this title.";

  setPoster(elements.vodModalPoster, item);

  const savedTime = Number(state.watchHistory[item.id]) || 0;

  if (savedTime > 30) {
    elements.vodResumeButton.hidden = false;
      elements.vodResumeButton.textContent = `Resume from ${formatTime(savedTime)}`;
  } else {
    elements.vodResumeButton.hidden = true;
  }

  elements.vodFavoriteButton.textContent = isMediaFavorite(item) ? "Remove favourite" : "Add to favourites";

  elements.vodModal.hidden = false;
}

function closeVodModal() {
  elements.vodModal.hidden = true;
}

elements.vodClose.addEventListener("click", closeVodModal);

elements.vodModal.addEventListener("click", (event) => {
  if (event.target === elements.vodModal) closeVodModal();
});

elements.vodPlayButton.addEventListener("click", () => {
  if (!state.vod.selected) return;
  const item = state.vod.selected;
  openQualityModal({ kind: "movie", item, resumeFrom: 0 });
});

elements.vodResumeButton.addEventListener("click", () => {
  if (!state.vod.selected) return;
  const item = state.vod.selected;
  const resume = Number(state.watchHistory[item.id]) || 0;
  openQualityModal({ kind: "movie", item, resumeFrom: resume });
});

elements.vodFavoriteButton.addEventListener("click", () => {
  const item = state.vod.selected;
  if (!item) return;
  const favourite = toggleMediaFavorite(item);
  elements.vodFavoriteButton.textContent = favourite ? "Remove favourite" : "Add to favourites";
});

function subtitlePreference() {
  const value = String(localStorage.getItem("subtitlePreference") || "off").toLowerCase();
  return ["off", "auto", "en", "pa", "hi"].includes(value) ? value : "off";
}

function clearVodSubtitleTracks() {
  state.vod.subtitleRequestToken += 1;
  state.vod.subtitleTracks = [];
  elements.vodVideo?.querySelectorAll("track[data-stb-subtitle]").forEach((track) => track.remove());
  if (elements.vodSubtitleSelect) {
    elements.vodSubtitleSelect.replaceChildren(new Option("Subtitles off", ""));
    elements.vodSubtitleSelect.value = "";
    elements.vodSubtitleSelect.hidden = true;
  }
}

function applyVodSubtitlePreference(preference = subtitlePreference()) {
  const tracks = state.vod.subtitleTracks || [];
  const selected = tracks.some((track) => track.id === preference)
    ? preference
    : preference === "off"
    ? ""
    : preference === "auto"
      ? (tracks.find((track) => track.language === "en") ||
          tracks.find((track) => track.language === "pa") ||
          tracks.find((track) => track.language === "hi") || tracks[0])?.id || ""
      : tracks.find((track) => track.language === preference)?.id || "";

  elements.vodVideo?.querySelectorAll("track[data-stb-subtitle]").forEach((element) => {
    const textTrack = element.track;
    if (textTrack) textTrack.mode = element.dataset.trackId === selected ? "showing" : "disabled";
  });
  if (elements.vodSubtitleSelect) elements.vodSubtitleSelect.value = selected;
}

async function loadVodSubtitles(item) {
  clearVodSubtitleTracks();
  const token = state.vod.subtitleRequestToken;
  const preference = subtitlePreference();
  if (preference === "off" || !item?.categoryId || !item?.id || getDefaultPlayer() === "vlc") return;

  try {
    const payload = await request("/api/vod/subtitles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryId: item.categoryId,
        itemId: item.id,
        language: preference,
        title: item.subtitleTitle || item.episodeTitle || item.title,
        year: item.year,
        clientItem: item,
      }),
    });
    if (token !== state.vod.subtitleRequestToken || state.vod.selected?.id !== item.id) return;

    const tracks = Array.isArray(payload.tracks)
      ? payload.tracks.filter((track) =>
          track && typeof track.id === "string" &&
          /^\/stream\/[A-Za-z0-9_-]+$/.test(String(track.url || ""))
        )
      : [];
    state.vod.subtitleTracks = tracks;
    if (!tracks.length) return;

    for (const track of tracks) {
      const element = document.createElement("track");
      element.kind = "subtitles";
      element.label = String(track.label || track.language || "Subtitle");
      element.srclang = String(track.language || "und").slice(0, 12);
      element.src = String(track.url);
      element.dataset.stbSubtitle = "1";
      element.dataset.trackId = track.id;
      elements.vodVideo.append(element);
      element.addEventListener("load", () => applyVodSubtitlePreference(), { once: true });
    }

    if (elements.vodSubtitleSelect) {
      elements.vodSubtitleSelect.replaceChildren(new Option("Subtitles off", ""));
      for (const track of tracks) {
        elements.vodSubtitleSelect.append(new Option(track.label, track.id));
      }
      elements.vodSubtitleSelect.hidden = false;
    }
    applyVodSubtitlePreference(preference);
    trackAnalytics("feature_used", { screen: item.kind === "series" ? "series" : "vod", reason: "subtitle-loaded", success: true });
  } catch {
    if (token === state.vod.subtitleRequestToken) {
      trackAnalytics("feature_used", { screen: item.kind === "series" ? "series" : "vod", reason: "subtitle-search-failed", success: false });
    }
  }
}

function resetVodPlayer() {
  stopVodPlayback();
  elements.vodProgressBar.style.width = "0%";
  elements.vodTimeDisplay.textContent = "0:00 / 0:00";
}

function isRestrictedVodItem(item) {
  const rating = String(item?.rating || "").trim().toLowerCase();
  const title = String(item?.title || "");
  const category = vodCategoryById(item?.categoryId);
  return Boolean(item?.adultLocked || item?.categoryLocked || category?.locked ||
    /(adult|xxx|porn|erotic|sex|18\s*(?:\+|plus))/i.test(String(item?.categoryTitle || item?.genre || item?.category_name || "")) ||
    /(adult|xxx|18\s*(?:\+|plus)|porn|erotic|sex)/i.test(title) ||
    /(18\s*(?:\+|plus)|\bA\b|NC[- ]?17|XXX|\bX{1,3}\b)/i.test(rating));
}

function renewVodLink(reason, retry) {
  if (typeof retry !== "function") return;
  if (state.vod.linkRecoveries >= 2) {
    showVodNotice("Playback stopped because the provider link could not recover.");
    return;
  }

  state.vod.linkRecoveries += 1;
  recordClientDiagnostic("client.vod_link_renewal", {
    reason,
    attempt: state.vod.linkRecoveries,
  });
  showVodNotice("Refreshing the movie link…");
  setTimeout(retry, 350);
}

function attachVodNative(stream, item, resumeFrom, token, retry) {
  const video = elements.vodVideo;
  let recoveryTimer = null;
  let recovered = false;

  const clearRecoveryTimer = () => {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };

  const requestRecovery = (reason) => {
    if (token !== state.vod.retryToken || recovered) return;
    recovered = true;
    clearRecoveryTimer();
    renewVodLink(reason, retry);
  };

  const scheduleRecovery = (reason) => {
    clearRecoveryTimer();
    recoveryTimer = setTimeout(() => requestRecovery(reason), 12_000);
  };

  video.addEventListener("error", () => requestRecovery("native-error"), { once: true });
  video.addEventListener("stalled", () => scheduleRecovery("native-stalled"), { once: true });
  video.addEventListener("waiting", () => scheduleRecovery("native-waiting"), { once: true });
  video.addEventListener("playing", clearRecoveryTimer);

  video.addEventListener("loadedmetadata", () => {
    if (token !== state.vod.retryToken) return;

    if (
      resumeFrom > 0 &&
      Number.isFinite(video.duration) &&
      resumeFrom < video.duration - 2
    ) {
      video.currentTime = resumeFrom;
    }

    elements.vodVideoLoading.hidden = true;
    elements.vodPlayerControls.hidden = false;
    trackAnalytics("playback_started", {
      screen: item.kind === "series" ? "series" : "vod",
      player: "internal",
      success: true,
    });
    video.play().catch(() => {});
  }, { once: true });

  video.src = stream;
}

function attachVodHls(stream, item, resumeFrom, token, retry) {
  const hls = new window.Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 60,
    maxBufferLength: 90,
    maxMaxBufferLength: 180,
    manifestLoadingTimeOut: 30000,
    levelLoadingTimeOut: 30000,
    fragLoadingTimeOut: 30000,
    manifestLoadingMaxRetry: 8,
    levelLoadingMaxRetry: 8,
    fragLoadingMaxRetry: 12,
  });

  state.vod.hls = hls;
  let networkRecoveries = 0;
  let mediaRecoveries = 0;
  let stallRecoveries = 0;
  let lastStallRecoveryAt = 0;
  let renewalRequested = false;

  const requestRenewal = (reason) => {
    if (renewalRequested || token !== state.vod.retryToken) return;
    renewalRequested = true;
    renewVodLink(reason, retry);
  };

  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    if (token !== state.vod.retryToken) return;

    recordClientDiagnostic("client.vod_manifest_parsed", {
      itemId: item.id,
      title: item.title,
    });

    elements.vodVideoLoading.hidden = true;
    elements.vodPlayerControls.hidden = false;
    trackAnalytics("playback_started", {
      screen: item.kind === "series" ? "series" : "vod",
      player: "internal",
      success: true,
    });

    const seek = () => {
      if (
        resumeFrom > 0 &&
        Number.isFinite(elements.vodVideo.duration) &&
        resumeFrom < elements.vodVideo.duration - 2
      ) {
        elements.vodVideo.currentTime = resumeFrom;
      }
    };

    if (elements.vodVideo.readyState >= 1) seek();
    else elements.vodVideo.addEventListener("loadedmetadata", seek, { once: true });

    elements.vodVideo.play().catch(() => {});
  });

  hls.on(window.Hls.Events.ERROR, (_event, data) => {
    if (token !== state.vod.retryToken) return;

    recordClientDiagnostic("client.vod_hls_error", {
      itemId: item.id,
      title: item.title,
      ...hlsDiagnosticDetails(data),
    });

    const responseCode = Number(data?.response?.code || 0);
    const details = String(data.details || data.reason || "");
    const isUnsupportedCodec = /manifestIncompatibleCodecsError|bufferIncompatibleCodecsError|bufferAddCodecError/i.test(details);
    const isBufferStall = /bufferStalledError|bufferAppendNoProgress|bufferSeekOverHole/i.test(details);
    const now = Date.now();

    if (responseCode === 415 || isUnsupportedCodec) {
      try { hls.destroy(); } catch {}
      if (state.vod.hls === hls) state.vod.hls = null;
      stopMedia(elements.vodVideo);
      elements.vodVideoLoading.hidden = true;
      elements.vodPlayerControls.hidden = true;
      showVodNotice("This title uses an audio/video codec that the built-in player cannot decode.", {
        stream,
        title: item.title,
      });
      return;
    }

    if (
      [401, 403, 404, 410, 502, 504].includes(responseCode) ||
      /manifestParsingError|no EXTM3U delimiter/i.test(details)
    ) {
      /* A hidden HLS URL may actually be progressive media. Try native once
         when there is no HTTP rejection; otherwise request a fresh link. */
      if (
        responseCode === 0 &&
        /manifestParsingError|no EXTM3U delimiter/i.test(details) &&
        !renewalRequested
      ) {
        renewalRequested = true;
        try { hls.destroy(); } catch {}
        if (state.vod.hls === hls) state.vod.hls = null;
        attachVodNative(stream, item, resumeFrom, token, retry);
      } else {
        requestRenewal(responseCode ? `http-${responseCode}` : "invalid-manifest");
      }
      return;
    }

    if (!data.fatal && isBufferStall) {
      if (now - lastStallRecoveryAt > 4_000) {
        lastStallRecoveryAt = now;
        stallRecoveries += 1;
        if (stallRecoveries >= 3) {
          requestRenewal("buffer-stall");
        } else {
          try { hls.startLoad(-1); } catch { requestRenewal("buffer-stall-retry"); }
        }
      }
      return;
    }

    if (!data.fatal) return;

    if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
      if (networkRecoveries < 2) {
        networkRecoveries += 1;
        try { hls.startLoad(-1); } catch { requestRenewal("network-retry-failed"); }
      } else {
        requestRenewal("network-retries-exhausted");
      }
      return;
    }

    if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
      if (mediaRecoveries < 2) {
        mediaRecoveries += 1;
        try { hls.recoverMediaError(); } catch { requestRenewal("media-recovery-failed"); }
      } else {
        requestRenewal("media-recovery-exhausted");
      }
      return;
    }

    requestRenewal("fatal-hls-error");
  });

  hls.loadSource(stream);
  hls.attachMedia(elements.vodVideo);
}

async function playVod(item, resumeFrom = 0, qualityId = "", isRenewal = false) {
  if (!item) return;

  if (!isRenewal) state.vod.linkRecoveries = 0;

  const category = vodCategoryById(item.categoryId);

  if (isRestrictedVodItem(item) && !state.parentalUnlocked) {
    runAfterParentalUnlock(() => playVod(item, resumeFrom, qualityId));
    return;
  }

  state.vod.categoryScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  resetVodPlayer();
  state.vod.selected = item;

  const token = ++state.vod.retryToken;

  elements.vodPlayerSection.hidden = false;
  document.body.classList.add("vod-playing");
  if (!document.fullscreenElement && !isRenewal && getDefaultPlayer() !== "vlc") toggleFullscreen(elements.vodPlayerContainer);
  elements.vodVideoLoading.hidden = false;
  elements.vodPlayerControls.hidden = true;
  elements.vodControlTitle.textContent = item.title;

  showVodNotice("");
  void loadVodSubtitles(item);

  try {
    const payload = await request("/api/vod/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryId: item.categoryId,
        itemId: item.id,
        clientItem: item,
        ...(qualityId ? { qualityId } : {}),
      }),
    });

    if (token !== state.vod.retryToken || state.vod.selected?.id !== item.id) return;

    if (getDefaultPlayer() === "vlc") {
      elements.vodVideoLoading.hidden = true;
      openPreferredExternalPlayer("vod", payload.stream, item.title);
      return;
    }

    /* The relay hides the provider URL. The server marks opaque links as
       hls-or-auto, and attachVodHls can fall back to native media if the
       response turns out to be progressive. */
    const retry = () => playVod(item, resumeFrom, qualityId, true);

    if (payload.hls === true && window.Hls?.isSupported()) {
      attachVodHls(payload.stream, item, resumeFrom, token, retry);
      return;
    }

    if (payload.hls === true && getDefaultPlayer() === "auto" && openPreferredExternalPlayer("vod", payload.stream, item.title)) {
      elements.vodVideoLoading.hidden = true;
      return;
    }

    attachVodNative(payload.stream, item, resumeFrom, token, retry);

  } catch (error) {
    if (token === state.vod.retryToken) {
      elements.vodVideoLoading.hidden = true;
      trackAnalytics("playback_failed", {
        screen: "vod",
        player: getDefaultPlayer(),
        errorType: analyticsErrorType(error, "vod-playback"),
        statusCode: error.status,
        success: false,
      });
      showVodNotice(`Movie could not play: ${error.message}`);
    }
  }
}

elements.closeVodPlayerButton.addEventListener("click", () => {
  const item = state.vod.selected;

  if (item && elements.vodVideo.currentTime > 0) {
    state.watchHistory[item.id] = elements.vodVideo.currentTime;
    saveWatchHistory();
  }

  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  resetVodPlayer();
  elements.vodPlayerSection.hidden = true;
  document.body.classList.remove("vod-playing");
  state.parentalUnlocked = false;
  renderVodCategories();
  void restoreVodBrowserAfterPlayback();
  requestAnimationFrame(() => window.scrollTo(0, state.vod.categoryScrollTop || 0));
});

let vodControlTimeout;

function revealVodControls() {
  if (elements.vodPlayerControls.hidden) return;

  elements.vodPlayerControls.classList.add("active");
  clearTimeout(vodControlTimeout);

  vodControlTimeout = setTimeout(() => {
    elements.vodPlayerControls.classList.remove("active");
  }, 3000);
}

elements.vodPlayerContainer.addEventListener("mousemove", revealVodControls);
elements.vodPlayerContainer.addEventListener("click", revealVodControls);
elements.vodPlayerContainer.addEventListener("touchstart", revealVodControls, { passive: true });
elements.vodPlayerContainer.addEventListener("pointermove", revealVodControls);
elements.vodVideo.addEventListener("click", revealVodControls);

elements.vodPlayPauseBtn.addEventListener("click", () => {
  if (elements.vodVideo.paused) elements.vodVideo.play().catch(() => {});
  else elements.vodVideo.pause();
});

elements.vodVideo.addEventListener("play", () => {
  elements.vodPlayPauseBtn.textContent = "Pause";
});

elements.vodVideo.addEventListener("pause", () => {
  elements.vodPlayPauseBtn.textContent = "Play";
  elements.vodPlayerControls.classList.add("active");
});

elements.vodMuteBtn.addEventListener("click", () => {
  elements.vodVideo.muted = !elements.vodVideo.muted;
  elements.vodMuteBtn.textContent = elements.vodVideo.muted ? "Muted" : "Vol";
  elements.vodVolumeSlider.value =
    elements.vodVideo.muted ? "0" : String(elements.vodVideo.volume);
});

elements.vodVolumeSlider.addEventListener("input", (event) => {
  const volume = Number(event.target.value);
  elements.vodVideo.volume = volume;
  elements.vodVideo.muted = volume === 0;
  elements.vodMuteBtn.textContent = volume === 0 ? "Muted" : "Vol";
});

elements.vodVideo.addEventListener("timeupdate", () => {
  const current = Number(elements.vodVideo.currentTime) || 0;
  const duration = Number(elements.vodVideo.duration) || 0;

  if (duration > 0 && Number.isFinite(duration)) {
    elements.vodProgressBar.style.width =
      `${Math.min(100, Math.max(0, current / duration * 100))}%`;
    elements.vodTimeDisplay.textContent =
      `${formatTime(current)} / ${formatTime(duration)}`;
  } else {
    elements.vodTimeDisplay.textContent = formatTime(current);
  }

  const item = state.vod.selected;
  if (item && current > 0) {
    const rounded = Math.floor(current);
    if (!state.vod._lastSavedSecond || rounded - state.vod._lastSavedSecond >= 5) {
      state.vod._lastSavedSecond = rounded;
      state.watchHistory[item.id] = current;
      saveWatchHistory();
    }
  }
});

elements.vodVideo.addEventListener("ended", () => {
  const item = state.vod.selected;
  if (!item) return;
  delete state.watchHistory[item.id];
  saveWatchHistory();
});

elements.vodProgressContainer.addEventListener("click", (event) => {
  const duration = elements.vodVideo.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;

  const rect = elements.vodProgressContainer.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  elements.vodVideo.currentTime = ratio * duration;
});

elements.vodFullscreenBtn.addEventListener("click", () => {
  toggleFullscreen(elements.vodPlayerContainer);
});

/* =====================================================
   COMBINED VOD DETAILS
   Some Stalker portals put movies and series in the same VOD category.
   Details are resolved only after a title is opened, so the list remains
   fast while series still gets seasons, episodes and provider links.
===================================================== */

function openCombinedSeriesModal(item, detail = {}) {
  const sameSeries = String(state.series.selected?.id || "") === String(item.id || "");
  if (!sameSeries) {
    state.series.episodeScrollTop = 0;
    state.series.episodeScrollSeason = "";
  }
  const saved = state.watchMeta[item.id] || {};
  state.series.selected = {
    ...item,
    ...detail,
    categoryId: item.categoryId,
    kind: "series",
    lastEpisodeId: item.lastEpisodeId || detail.lastEpisodeId || saved.lastEpisodeId || "",
    lastEpisodeTitle: item.lastEpisodeTitle || detail.lastEpisodeTitle || saved.lastEpisodeTitle || "",
    lastSeason: item.lastSeason || detail.lastSeason || saved.lastSeason || "",
    lastEpisodeNumber: item.lastEpisodeNumber || detail.lastEpisodeNumber || saved.lastEpisodeNumber || "",
  };
  state.watchMeta[item.id] = { ...saved, ...state.series.selected, mediaType: "series" };
  saveWatchHistory();
  elements.seriesModalTitle.textContent = item.title;
  elements.seriesModalMeta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "Series";
  elements.seriesModalDescription.textContent = item.description || "No description is available for this series.";
  elements.seriesFavoriteButton.textContent = isMediaFavorite(item) ? "Remove favourite" : "Add to favourites";
  renderSeriesResumeButton(state.series.selected);
  setPoster(elements.seriesModalPoster, item);
  elements.seriesSeasonSelect.replaceChildren(new Option("Loading seasons…", ""));
  elements.seriesEpisodes.innerHTML = '<p class="list-note">Loading seasons…</p>';
  elements.seriesModal.hidden = false;

  const localSeasons = Array.isArray(detail.seasons) ? detail.seasons : [];
  const seasonsPromise = localSeasons.length
    ? Promise.resolve({ seasons: localSeasons })
    : request(`/api/vod/seasons?categoryId=${encodeURIComponent(item.categoryId)}&itemId=${encodeURIComponent(item.id)}&fallback=${vodFallbackParam(item)}`);

  seasonsPromise.then((result) => {
    if (state.series.selected?.id !== item.id) return;
    const seasons = Array.isArray(result.seasons) ? result.seasons : [];
    elements.seriesSeasonSelect.replaceChildren(
      new Option("Select season", ""),
      ...seasons.map((season) => new Option(season.title || `Season ${season.number}`, String(season.number)))
    );
    if (seasons[0]) {
      elements.seriesSeasonSelect.value = String(seasons[0].number);
      loadCombinedSeriesEpisodes(seasons[0].number);
    } else {
      elements.seriesEpisodes.innerHTML = '<p class="list-note">No seasons were returned for this title.</p>';
    }
  }).catch((error) => { elements.seriesEpisodes.textContent = error.message; });
}

function renderSeriesResumeButton(series) {
  const button = elements.seriesResumeButton;
  if (!button) return;
  const time = Number(state.watchHistory[series?.id]) || 0;
  const episodeId = series?.lastEpisodeId || series?.episodeId || "";
  if (!series || time <= 30 || !episodeId) {
    button.hidden = true;
    button.onclick = null;
    return;
  }
  const season = String(series.lastSeason || series.season || "1");
  const episodeNumber = String(series.lastEpisodeNumber || series.episode || "").trim();
  const episodeTitle = series.lastEpisodeTitle || series.episodeTitle || `Episode ${episodeNumber || "saved"}`;
  button.hidden = false;
  button.textContent = `Resume ${episodeNumber ? `E${episodeNumber}` : "episode"} · ${formatTime(time)}`;
  button.onclick = () => openQualityModal({
    kind: "episode",
    series,
    season,
    episode: { id: episodeId, title: episodeTitle, episode: episodeNumber },
    resumeFrom: time,
  });
}

function episodeDisplayLabel(episode, index = 0) {
  const number = String(episode?.episode || index + 1);
  const escapedNumber = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rawTitle = String(episode?.title || "").trim();
  const title = rawTitle.replace(new RegExp(`^episode\\s*${escapedNumber}\\s*[.·:|-]?\\s*`, "i"), "").trim();
  return `Episode ${number}${title ? ` · ${title}` : ""}`;
}

async function loadCombinedSeriesEpisodes(season) {
  const series = state.series.selected;
  if (!series) return;
  const seasonKey = String(season);
  const scrollKey = `${String(series.id)}::${seasonKey}`;
  const storedScrollTop = Number(state.series.episodeScrollPositions[scrollKey]);
  const savedScrollTop = Number.isFinite(storedScrollTop)
    ? storedScrollTop
    : state.series.episodeScrollSeason === seasonKey
      ? state.series.episodeScrollTop
      : 0;
  state.series.episodeScrollSeason = seasonKey;
  elements.seriesEpisodes.innerHTML = '<p class="list-note">Loading episodes…</p>';
  try {
    const result = await request(`/api/vod/episodes?categoryId=${encodeURIComponent(series.categoryId)}&itemId=${encodeURIComponent(series.id)}&season=${encodeURIComponent(season)}&fallback=${vodFallbackParam(series)}`);
    const episodes = Array.isArray(result.episodes) ? result.episodes : [];
    const list = episodes.map((episode, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "series-episode-button";
      button.textContent = episodeDisplayLabel(episode, index);
      button.addEventListener("click", () => openQualityModal({
        kind: "episode",
        series,
        season,
        episode,
      }));
      return button;
    });
    if (!list.length) {
      const note = document.createElement("p"); note.className = "list-note";
      note.textContent = "No episodes were returned for this season."; list.push(note);
    }
    elements.seriesEpisodes.replaceChildren(...list);
    requestAnimationFrame(() => {
      if (state.series.selected?.id !== series.id || state.series.episodeScrollSeason !== seasonKey) return;
      const maxScroll = Math.max(0, elements.seriesEpisodes.scrollHeight - elements.seriesEpisodes.clientHeight);
      elements.seriesEpisodes.scrollTop = Math.min(savedScrollTop, maxScroll);
    });
  } catch (error) { elements.seriesEpisodes.textContent = error.message; }
}

async function openQualityModal({ kind, item, series, season, episode, resumeFrom = 0 }) {
  const selected = kind === "episode" ? series : item;
  if (!selected) return;

  const category = vodCategoryById(selected.categoryId);
  if ((category?.locked || isRestrictedVodItem(selected)) && !state.parentalUnlocked) {
    runAfterParentalUnlock(() => openQualityModal({ kind, item, series, season, episode, resumeFrom }));
    return;
  }

  const isEpisode = kind === "episode";
  elements.qualityModalTitle.textContent = isEpisode
    ? `${series.title} · ${episode.title}`
    : item.title;
  elements.qualityModalDescription.textContent = isEpisode
    ? `Season ${season} · Episode ${episode.episode || ""}. Choose a quality before playback.`
    : "Choose a quality before playback.";
  elements.qualityOptions.replaceChildren(Object.assign(document.createElement("p"), {
    className: "list-note",
    textContent: "Loading quality options…",
  }));

  closeVodModal();
  elements.seriesModal.hidden = true;
  elements.qualityModal.hidden = false;

  try {
    const url = isEpisode
      ? `/api/vod/episode/options?categoryId=${encodeURIComponent(series.categoryId)}&itemId=${encodeURIComponent(series.id)}&season=${encodeURIComponent(season)}&episodeId=${encodeURIComponent(episode.id)}&fallback=${vodFallbackParam(series)}`
      : `/api/vod/options?categoryId=${encodeURIComponent(item.categoryId)}&itemId=${encodeURIComponent(item.id)}&fallback=${vodFallbackParam(item)}`;
    const result = await request(url);
    const options = Array.isArray(result.options) ? result.options : [];
    if (!options.length) throw new Error("No playback quality was returned by the provider.");

    const startPlayback = (option) => {
      closeQualityModal();
      if (!document.fullscreenElement) toggleFullscreen(elements.vodPlayerContainer);
      if (isEpisode) playCombinedEpisode(series, season, episode, option.id, resumeFrom);
      else playVod(item, resumeFrom, option.id);
    };
    if (options.length === 1) {
      startPlayback(options[0]);
      return;
    }

    const buttons = options.map((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quality-option";
      button.textContent = qualityDisplayLabel(option, index);
      button.addEventListener("click", () => startPlayback(option));
      return button;
    });
    elements.qualityOptions.replaceChildren(...buttons);
  } catch (error) {
    if (!elements.qualityModal.hidden) {
      const note = document.createElement("p");
      note.className = "list-note";
      note.textContent = error.message;
      elements.qualityOptions.replaceChildren(note);
    }
  }
}

function qualityDisplayLabel(option, index = 0) {
  const raw = String(option?.label || "").trim();
  const lower = raw.toLowerCase();
  const language = raw
    .replace(/\b(?:quality|profile|default|excellent|good|best|medium|low)\b/gi, "")
    .replace(/\(?\s*(?:4k|uhd|2160p?|1080p?|720p?|576p?|480p?|hd|fhd|full\s*hd|sd)\s*\)?/gi, "")
    .replace(/[/:|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let quality = "";
  if (/4k|2160|uhd/.test(lower)) quality = "4K Ultra HD · 2160p";
  else if (/1080|full\s*hd|fhd/.test(lower)) quality = "Full HD · 1080p";
  else if (/720|\bhd\b/.test(lower)) quality = "HD · 720p";
  else if (/576|480|\bsd\b/.test(lower)) quality = "SD Quality";

  if (!quality && (/^\d+$/.test(raw) || !raw || /default/.test(lower))) {
    return index === 0 ? "Watch Full HD · 1080p" : `Watch Alternative quality ${index + 1}`;
  }
  if (!quality) return raw.length > 70 ? `Watch Alternative quality ${index + 1}` : `Watch ${raw}`;
  return language && !/^\d+$/.test(language) ? `Watch ${language} · ${quality}` : `Watch ${quality}`;
}

function closeQualityModal() {
  if (elements.qualityModal) elements.qualityModal.hidden = true;
}

elements.qualityClose?.addEventListener("click", closeQualityModal);
elements.qualityModal?.addEventListener("click", (event) => {
  if (event.target === elements.qualityModal) closeQualityModal();
});

async function playCombinedEpisode(
  series,
  season,
  episode,
  qualityId = "",
  resumeFrom = 0,
  isRenewal = false
) {
  if (!series || !episode) return;
  if (!isRenewal) state.vod.linkRecoveries = 0;
  const item = {
    ...series,
    kind: "series",
    episodeTitle: episode.title,
    episodeId: String(episode.id),
    lastEpisodeId: String(episode.id),
    lastEpisodeTitle: episode.title,
    lastSeason: String(season),
    lastEpisodeNumber: episode.episode || "",
    season: Number(season),
    episode: episode.episode,
  };
  state.vod.selected = item;
  state.watchMeta[series.id] = { ...(state.watchMeta[series.id] || {}), ...item, mediaType: "series" };
  saveWatchHistory();
  elements.seriesModal.hidden = true;
  state.vod.categoryScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
  resetVodPlayer();
  elements.vodPlayerSection.hidden = false;
  document.body.classList.add("vod-playing");
  if (!document.fullscreenElement && !isRenewal && getDefaultPlayer() !== "vlc") toggleFullscreen(elements.vodPlayerContainer);
  elements.vodVideoLoading.hidden = false;
  elements.vodPlayerControls.hidden = true;
  elements.vodControlTitle.textContent = `${series.title} · ${episode.title}`;
  item.subtitleTitle = `${series.title} · ${episode.title}`;
  void loadVodSubtitles(item);
  const token = ++state.vod.retryToken;
  try {
    const payload = await request("/api/vod/episode/play", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        categoryId: series.categoryId,
        itemId: series.id,
        season: Number(season),
        episodeId: String(episode.id),
        ...(qualityId ? { qualityId } : {}),
      }),
    });
    if (token !== state.vod.retryToken || state.vod.selected?.id !== series.id) return;

    if (getDefaultPlayer() === "vlc") {
      elements.vodVideoLoading.hidden = true;
      openPreferredExternalPlayer("vod", payload.stream, `${series.title} · ${episode.title}`);
      return;
    }

    const retry = () => playCombinedEpisode(series, season, episode, qualityId, resumeFrom, true);
    if (payload.hls === true && window.Hls?.isSupported()) {
      attachVodHls(payload.stream, item, resumeFrom, token, retry);
    } else {
      attachVodNative(payload.stream, item, resumeFrom, token, retry);
    }
  } catch (error) {
    if (token === state.vod.retryToken) {
      elements.vodVideoLoading.hidden = true;
      trackAnalytics("playback_failed", {
        screen: "series",
        player: getDefaultPlayer(),
        errorType: analyticsErrorType(error, "episode-playback"),
        statusCode: error.status,
        success: false,
      });
      showVodNotice(`Episode could not play: ${error.message}`);
    }
  }
}

/* =====================================================
   SERIES + DASHBOARD + FAVOURITES
===================================================== */

function seriesCategoryById(id) { return state.series.categories.find((category) => category.id === id); }

function renderSeriesCategories() {
  if (!elements.seriesCategories) return;
  const rows = state.series.categories.filter((category) =>
    contentModeAllows(CONTENT_MODES?.isRestrictedCategory(category) || Boolean(category.locked || category.adultLocked))
  ).map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `vod-category-button${state.series.categoryId === category.id ? " active" : ""}`;
    const title = document.createElement("span");
    title.textContent = category.title;
    button.append(title);
    if (category.locked && !state.parentalUnlocked) {
      const lock = document.createElement("span"); lock.className = "vod-lock"; lock.textContent = "LOCK"; button.append(lock);
    }
    button.addEventListener("click", () => {
      const choose = (verified = false) => selectSeriesCategory(category.id, verified);
      if (category.locked && !state.parentalUnlocked) runAfterParentalUnlock(() => choose(true)); else choose();
    });
    return button;
  });
  if (!rows.length) { const note = document.createElement("p"); note.className = "list-note"; note.textContent = "No series categories are available."; rows.push(note); }
  elements.seriesCategories.replaceChildren(...rows);
}

function renderSeriesGrid() {
  const query = state.series.query.trim().toLowerCase();
  const items = state.series.items.filter((item) => canDisplayRestrictedContent(isRestrictedMedia(item)) &&
    (!query || [item.title, item.description, item.year, item.rating].filter(Boolean).join(" ").toLowerCase().includes(query)));
  const cards = items.map((item) => {
    const card = document.createElement("button"); card.type = "button"; card.className = "series-card";
    const poster = document.createElement("span"); poster.className = "series-poster"; setPoster(poster, item);
    const play = document.createElement("span");
    play.className = "series-card-play series-action";
    play.textContent = "SEASONS";
    const title = document.createElement("strong"); title.textContent = item.title;
    const meta = document.createElement("small"); meta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "Series";
    card.append(poster, play, title, meta);
    card.addEventListener("click", () => openSeriesModal(item));
    return card;
  });
  if (!cards.length) { const note = document.createElement("p"); note.className = "list-note"; note.textContent = query ? "No loaded series match your search." : "No series were returned for this category."; cards.push(note); }
  elements.seriesGrid.replaceChildren(...cards);
  const category = seriesCategoryById(state.series.categoryId);
  elements.seriesCategoryTitle.textContent = category?.title || "Series";
  elements.seriesCategoryMeta.textContent = `${state.series.items.length.toLocaleString()} series loaded`;
}

async function loadSeriesCategories() {
  if (!elements.seriesCategories) return;
  elements.seriesCategories.innerHTML = '<p class="list-note">Loading series categories...</p>';
  try {
    const result = await request("/api/series/categories");
    state.series.categories = Array.isArray(result.categories) ? result.categories : [];
    renderSeriesCategories();
    const first = state.series.categories.find((category) => !category.locked) || state.series.categories[0];
    if (first && !state.series.categoryId) selectSeriesCategory(first.id);
  } catch (error) { elements.seriesCategories.textContent = error.message; }
}

async function selectSeriesCategory(categoryId, verified = false) {
  const category = seriesCategoryById(categoryId); if (!category) return;
  if (verified) state.parentalUnlocked = true;
  if (!verified && state.series.categoryId && state.series.categoryId !== categoryId) state.parentalUnlocked = false;
  if (category.locked && !state.parentalUnlocked) { requestParentalUnlock(() => selectSeriesCategory(categoryId, true)); return; }
  state.series.categoryId = categoryId; state.series.page = 0; state.series.items = []; state.series.itemIds = new Set(); state.series.ended = false; state.series.loadToken += 1; state.series.query = elements.seriesSearch.value.trim();
  elements.seriesGrid.innerHTML = '<p class="list-note">Loading series...</p>'; renderSeriesCategories();
  await loadNextSeriesPage(true);
}

async function loadNextSeriesPage(reset = false) {
  if (state.series.loading || state.series.ended || !state.series.categoryId) return;
  const token = state.series.loadToken; const page = reset ? 0 : state.series.page; state.series.loading = true;
  if (elements.seriesLoadSpinner) elements.seriesLoadSpinner.hidden = false;
  try {
    const result = await request(`/api/series/items?categoryId=${encodeURIComponent(state.series.categoryId)}&page=${page}`);
    if (token !== state.series.loadToken) return;
    const incoming = Array.isArray(result.items) ? result.items : []; let added = 0;
    for (const raw of incoming) {
      if (!raw?.id || state.series.itemIds.has(raw.id)) continue;
      state.series.itemIds.add(raw.id);
      state.series.items.push({
        ...raw,
        kind: "series",
        categoryId: state.series.categoryId,
        categoryTitle: raw.categoryTitle || seriesCategoryById(state.series.categoryId)?.title || "",
      });
      added += 1;
    }
    state.series.total = Number(result.total) || state.series.items.length; state.series.page = page + 1;
    if (!incoming.length || !added || (state.series.total && state.series.items.length >= state.series.total)) state.series.ended = true;
    renderSeriesGrid();
  } catch (error) { if (token === state.series.loadToken && !state.series.items.length) elements.seriesGrid.textContent = error.message; state.series.ended = true; }
  finally { if (token === state.series.loadToken) { state.series.loading = false; if (elements.seriesLoadSpinner) elements.seriesLoadSpinner.hidden = true; if (elements.seriesEndMessage) elements.seriesEndMessage.hidden = !state.series.ended; } }
}

function openSeriesModal(item) {
  const saved = state.watchMeta[item.id] || {};
  state.series.selected = { ...saved, ...item, kind: "series", mediaType: "series" };
  state.watchMeta[item.id] = { ...saved, ...state.series.selected, mediaType: "series" }; saveWatchHistory();
  elements.seriesFavoriteButton.textContent = isMediaFavorite(item) ? "Remove favourite" : "Add to favourites";
  renderSeriesResumeButton(state.series.selected);
  elements.seriesModalTitle.textContent = item.title; elements.seriesModalMeta.textContent = [item.year, item.rating && `★ ${item.rating}`].filter(Boolean).join(" · ") || "Series";
  elements.seriesModalDescription.textContent = item.description || "No description is available for this series."; setPoster(elements.seriesModalPoster, item);
  elements.seriesSeasonSelect.replaceChildren(new Option("Loading seasons...", "")); elements.seriesEpisodes.innerHTML = '<p class="list-note">Loading seasons...</p>'; elements.seriesModal.hidden = false;
  request(`/api/series/seasons?seriesId=${encodeURIComponent(item.id)}`).then((result) => {
    const seasons = Array.isArray(result.seasons) ? result.seasons : [];
    elements.seriesSeasonSelect.replaceChildren(new Option("Select season", ""), ...seasons.map((season) => new Option(season.title || `Season ${season.number}`, String(season.number))));
    if (seasons[0]) { elements.seriesSeasonSelect.value = String(seasons[0].number); loadSeriesEpisodes(seasons[0].number); } else elements.seriesEpisodes.innerHTML = '<p class="list-note">No seasons were returned.</p>';
  }).catch((error) => { elements.seriesEpisodes.textContent = error.message; });
}

async function loadSeriesEpisodes(season) {
  if (!state.series.selected) return; elements.seriesEpisodes.innerHTML = '<p class="list-note">Loading episodes...</p>';
  try {
    const result = await request(`/api/series/episodes?seriesId=${encodeURIComponent(state.series.selected.id)}&season=${encodeURIComponent(season)}`);
    const episodes = Array.isArray(result.episodes) ? result.episodes : [];
    const list = episodes.map((episode, index) => { const button = document.createElement("button"); button.type = "button"; button.className = "series-episode-button"; button.textContent = episodeDisplayLabel(episode, index); button.addEventListener("click", () => playSeriesEpisode(state.series.selected, season, episode)); return button; });
    if (!list.length) { const note = document.createElement("p"); note.className = "list-note"; note.textContent = "No episodes were returned for this season."; list.push(note); }
    elements.seriesEpisodes.replaceChildren(...list);
  } catch (error) { elements.seriesEpisodes.textContent = error.message; }
}

async function playSeriesEpisode(series, season, episode) {
  if (!series || !episode) return;
  /*
    Keep the legacy series workspace behind the same mixed-VOD gate.  A
    series episode must never jump straight to a stream: season -> episode
    -> quality -> playback is the only supported path.
  */
  await openQualityModal({
    kind: "episode",
    series: {
      ...series,
      categoryId: series.categoryId || state.series.categoryId,
      kind: "series",
      isSeries: true,
    },
    season,
    episode,
  });
}

function openDashboardMedia(item, { resume = false } = {}) {
  state.contentType = "vod";
  state.vod.filter = "all";
  clearVodSearchState();
  setMode("content");
  if (!item.categoryId) return;
  if (resume && item.mediaType !== "series" && item.kind !== "series") {
    const savedTime = Number(state.watchHistory[item.id]) || Number(item.time) || 0;
    openQualityModal({ kind: "movie", item, resumeFrom: savedTime });
    return;
  }
  openVodModal(item);
}

const HOME_LANGUAGE_RULES = [
  ["Punjabi", /\b(?:punjabi|panjabi|gurmukhi)\b/i],
  ["Hindi", /\b(?:hindi|hindustani|bollywood)\b/i],
  ["English", /\b(?:english|eng|hollywood)\b/i],
  ["Tamil", /\btamil\b/i],
  ["Telugu", /\btelugu\b/i],
  ["Malayalam", /\bmalayalam\b/i],
  ["Kannada", /\bkannada\b/i],
  ["Bengali", /\b(?:bengali|bangla)\b/i],
  ["Marathi", /\bmarathi\b/i],
  ["Gujarati", /\bgujarati\b/i],
  ["Urdu", /\burdu\b/i],
  ["Spanish", /\bspanish\b/i],
  ["French", /\bfrench\b/i],
  ["Arabic", /\barabic\b/i],
  ["Korean", /\bkorean\b/i],
  ["Japanese", /\bjapanese\b/i],
  ["Turkish", /\bturkish\b/i],
];

const HOME_GENRES = [
  ["Action", /\baction\b/i],
  ["Adventure", /\badventure\b/i],
  ["Animation", /\banimat(?:ion|ed)\b/i],
  ["Comedy", /\b(?:comedy|comic)\b/i],
  ["Crime", /\bcrime\b/i],
  ["Documentary", /\bdocument(?:ary)?\b/i],
  ["Drama", /\bdrama\b/i],
  ["Family", /\bfamily\b/i],
  ["Fantasy", /\bfantasy\b/i],
  ["Horror", /\bhorror\b/i],
  ["Mystery", /\bmystery\b/i],
  ["Romance", /\b(?:romance|romantic)\b/i],
  ["Sci-Fi", /\b(?:sci[- ]?fi|science fiction)\b/i],
  ["Thriller", /\bthriller\b/i],
  ["Kids", /\b(?:kids|children|childrens)\b/i],
  ["Sports", /\bsports?\b/i],
];

function inferHomeLanguage(item) {
  const explicit = [item?.language, item?.audioLanguage, item?.audio_language]
    .filter(Boolean).join(" ");
  const searchable = [explicit, item?.categoryTitle, item?.genre, item?.title, item?.path]
    .filter(Boolean).join(" ");
  return HOME_LANGUAGE_RULES.find(([, pattern]) => pattern.test(searchable))?.[0] || "";
}

function inferHomeGenres(item) {
  const searchable = [item?.genre, item?.categoryTitle, item?.description, item?.title]
    .filter(Boolean).join(" ");
  return HOME_GENRES.filter(([, pattern]) => pattern.test(searchable)).map(([label]) => label);
}

function mediaTypeLabel(item) {
  return item?.kind === "series" || item?.mediaType === "series" || item?.isSeries === true
    ? "Series" : "Movie";
}

function mediaMetaLabel(item, resume = false) {
  const language = inferHomeLanguage(item);
  const genres = inferHomeGenres(item);
  const tags = [language, genres[0], item?.year].filter(Boolean);
  const base = tags.length ? tags.join(" · ") : mediaTypeLabel(item);
  return resume ? `${base} · Resume ${formatTime(item.time)}` : base;
}

function mediaReleaseValue(item) {
  const releaseDate = String(item?.releaseDate || item?.dateAdd || "").trim();
  const parsedDate = Date.parse(releaseDate);
  if (Number.isFinite(parsedDate)) return parsedDate;
  const year = Number.parseInt(String(item?.year || "").match(/\d{4}/)?.[0] || "0", 10);
  return year * 31_536_000_000 || Number(item?.id) || 0;
}

function dashboardPoolItems() {
  const categoryTitles = new Map((state.vod.categories || []).map((category) => [
    String(category.id), category.title,
  ]));
  const byId = new Map();
  const sources = [
    ...(state.vod.shelves || []).flatMap((shelf) => shelf.items || []),
    ...(state.vod.items || []),
    ...(state.vod.localIndex || []),
  ];
  for (const raw of sources) {
    if (!raw?.id || !raw?.title) continue;
    const id = String(raw.id);
    const categoryTitle = raw.categoryTitle || categoryTitles.get(String(raw.categoryId)) || "";
    byId.set(id, { ...byId.get(id), ...raw, id, categoryTitle });
  }
  const byTitle = new Map();
  for (const item of byId.values()) {
    const restricted = isRestrictedMedia(item);
    if (state.contentMode === "adult-only" ? !restricted : restricted) continue;
    if (!canDisplayRestrictedContent(restricted)) continue;
    const title = String(item.title || "").toLowerCase()
      .replace(/[’'`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const key = `${title}|${mediaTypeLabel(item)}`;
    const previous = byTitle.get(key);
    /* Provider feeds sometimes return the same title with different IDs.
       Keep the richest copy so Home never shows duplicate cards. */
    if (!previous || (!previous.poster && item.poster) ||
        (!previous.description && item.description)) byTitle.set(key, item);
  }
  return [...byTitle.values()];
}

function dashboardHistoryEntries() {
  return Object.entries(state.watchHistory)
    .filter(([, time]) => Number(time) > 0)
    .map(([id, time]) => ({
      ...(state.watchMeta[id] || { id, title: "Saved title" }),
      id: String(id),
      time: Number(time),
    }))
    .filter((entry) => {
      const searchable = [entry.title, entry.categoryTitle, entry.genre, entry.path].join(" ");
      const restricted = isRestrictedMedia(entry) || /adult|18\s*(?:\+|plus)|xxx|porn|erotic|sex|penthouse|playboy/i.test(searchable);
      return (state.contentMode === "adult-only" ? restricted : !restricted) && canDisplayRestrictedContent(restricted);
    });
}

function recommendationScore(item, history) {
  if (!history.length) return mediaReleaseValue(item) / 1_000_000_000 + (Number(item.rating) || 0);
  const language = inferHomeLanguage(item);
  const genres = new Set(inferHomeGenres(item));
  let score = (Number(item.rating) || 0) / 10;
  for (const watched of history) {
    const watchedLanguage = inferHomeLanguage(watched);
    const watchedGenres = inferHomeGenres(watched);
    const languageMatch = Boolean(language && watchedLanguage && language === watchedLanguage);
    const genreMatches = watchedGenres.filter((genre) => genres.has(genre)).length;
    if (languageMatch) score += 9;
    score += Math.min(genreMatches, 3) * 5;
    if (languageMatch && genreMatches) score += 4;
  }
  return score + mediaReleaseValue(item) / 1_000_000_000_000;
}

function buildRecommendations(pool, history) {
  const watchedIds = new Set(history.map((entry) => String(entry.id)));
  return pool
    .filter((item) => !watchedIds.has(String(item.id)))
    .sort((a, b) => recommendationScore(b, history) - recommendationScore(a, history) ||
      mediaReleaseValue(b) - mediaReleaseValue(a) || String(a.title).localeCompare(String(b.title)))
    .slice(0, 10);
}

function stopDashboardHeroRotation() {
  if (state.dashboardHeroTimer) window.clearInterval(state.dashboardHeroTimer);
  state.dashboardHeroTimer = null;
}

function startDashboardHeroRotation() {
  stopDashboardHeroRotation();
  if (state.dashboardHeroPaused || elements.dashboardWorkspace?.hidden || state.dashboardHeroItems.length < 2) return;
  state.dashboardHeroTimer = window.setInterval(() => {
    if (elements.dashboardWorkspace?.hidden || !state.dashboardHeroItems.length) return;
    state.dashboardHeroIndex = (state.dashboardHeroIndex + 1) % state.dashboardHeroItems.length;
    renderDashboardHero(state.dashboardHeroItems[state.dashboardHeroIndex], dashboardHistoryEntries());
  }, DASHBOARD_HERO_INTERVAL_MS);
}

function syncDashboardHeroItems(items, history) {
  const nextItems = items.filter(Boolean).slice(0, 5);
  const previousIds = state.dashboardHeroItems.map((entry) => String(entry.id));
  const nextIds = nextItems.map((entry) => String(entry.id));
  const changed = previousIds.join("|") !== nextIds.join("|");
  const currentId = String(state.dashboardHeroItem?.id || "");
  state.dashboardHeroItems = nextItems;
  if (elements.dashboardHeroPrev) elements.dashboardHeroPrev.hidden = nextItems.length < 2;
  if (elements.dashboardHeroNext) elements.dashboardHeroNext.hidden = nextItems.length < 2;

  if (!nextItems.length) {
    state.dashboardHeroIndex = 0;
    renderDashboardHero(null, history);
    stopDashboardHeroRotation();
    return;
  }

  const currentIndex = nextItems.findIndex((entry) => String(entry.id) === currentId);
  state.dashboardHeroIndex = currentIndex >= 0
    ? currentIndex
    : Math.min(state.dashboardHeroIndex, nextItems.length - 1);
  renderDashboardHero(nextItems[state.dashboardHeroIndex], history);
  if (changed || !state.dashboardHeroTimer) startDashboardHeroRotation();
}

function paintDashboardHero(item) {
  if (!elements.dashboardHeroBackdrop) return;
  const fallback = "linear-gradient(105deg, #07111f 0%, #0b2034 52%, #133b4b 100%)";
  elements.dashboardHeroBackdrop.style.backgroundImage = fallback;
  if (elements.dashboardHeroArtwork) {
    elements.dashboardHeroArtwork.style.backgroundImage = "none";
    elements.dashboardHeroArtwork.classList.remove("is-ready");
  }
  if (!item?.poster) return;

  const source = String(item.poster);
  const paint = (url) => {
    if (state.dashboardHeroItem?.id !== item.id) return;
    const safe = String(url).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    elements.dashboardHeroBackdrop.style.backgroundImage =
      `url("${safe}")`;
    if (elements.dashboardHeroArtwork) {
      elements.dashboardHeroArtwork.style.backgroundImage = `url("${safe}")`;
      elements.dashboardHeroArtwork.classList.add("is-ready");
    }
  };
  const image = new Image();
  image.onload = () => paint(source);
  image.onerror = () => {
    if (/^https?:\/\//i.test(source)) {
      const proxied = `/api/poster?url=${encodeURIComponent(source)}`;
      const retry = new Image();
      retry.onload = () => paint(proxied);
      retry.src = proxied;
    }
  };
  image.src = source;
}

function renderDashboardHero(item, history) {
  state.dashboardHeroItem = item || null;
  if (!item) {
    if (elements.dashboardHeroEyebrow) elements.dashboardHeroEyebrow.textContent = "Your entertainment hub";
    if (elements.dashboardHeroTitle) elements.dashboardHeroTitle.textContent = "Welcome back";
    if (elements.dashboardHeroMeta) elements.dashboardHeroMeta.replaceChildren();
    if (elements.dashboardHeroDescription) elements.dashboardHeroDescription.textContent =
      "Pick up where you left off, discover something new, or jump straight into Live TV.";
    if (elements.dashboardHeroPlay) {
      elements.dashboardHeroPlay.textContent = "▶  Browse catalogue";
      elements.dashboardHeroPlay.onclick = () => openContentBrowser();
    }
    if (elements.dashboardHeroFavorite) {
      elements.dashboardHeroFavorite.hidden = true;
      elements.dashboardHeroFavorite.onclick = null;
    }
    if (elements.dashboardHeroDots) elements.dashboardHeroDots.replaceChildren();
    paintDashboardHero(null);
    return;
  }

  const language = inferHomeLanguage(item);
  const genres = inferHomeGenres(item);
  if (elements.dashboardHeroEyebrow) {
    elements.dashboardHeroEyebrow.textContent = history.length && language
      ? `Because you watched ${language}` : "Featured for you";
  }
  if (elements.dashboardHeroTitle) elements.dashboardHeroTitle.textContent = item.title || "Featured title";
  if (elements.dashboardHeroMeta) {
    const meta = [language, genres[0], item.year, mediaTypeLabel(item)].filter(Boolean);
    elements.dashboardHeroMeta.replaceChildren(...meta.map((value) => {
      const chip = document.createElement("span");
      chip.textContent = value;
      return chip;
    }));
  }
  if (elements.dashboardHeroDescription) {
    elements.dashboardHeroDescription.textContent = item.description ||
      `A ${genres[0] || "featured"} ${language || "on-demand"} title selected for your home screen.`;
  }
  if (elements.dashboardHeroPlay) {
    elements.dashboardHeroPlay.textContent = "▶  Play now";
    elements.dashboardHeroPlay.onclick = () => openDashboardMedia(item);
  }
  if (elements.dashboardHeroFavorite) {
    elements.dashboardHeroFavorite.hidden = false;
    const favourite = isMediaFavorite(item);
    elements.dashboardHeroFavorite.textContent = favourite ? "★  In favourites" : "☆  Add to favourites";
    elements.dashboardHeroFavorite.classList.toggle("is-favorite", favourite);
    elements.dashboardHeroFavorite.onclick = () => {
      toggleMediaFavorite(item);
      renderDashboard();
    };
  }
  if (elements.dashboardHeroDots) {
    const total = Math.max(1, state.dashboardHeroItems.length);
    elements.dashboardHeroDots.replaceChildren(...Array.from({ length: total }, (_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = index === state.dashboardHeroIndex ? "active" : "";
      dot.setAttribute("aria-label", `Show featured title ${index + 1}`);
      dot.setAttribute("aria-current", index === state.dashboardHeroIndex ? "true" : "false");
      dot.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!state.dashboardHeroItems[index]) return;
        state.dashboardHeroIndex = index;
        renderDashboardHero(state.dashboardHeroItems[index], dashboardHistoryEntries());
        startDashboardHeroRotation();
      });
      return dot;
    }));
  }
  paintDashboardHero(item);
}

function makeDashboardMediaCard(item, { resume = false, removable = false } = {}) {
  const card = document.createElement("article");
  card.className = "dashboard-card dashboard-media-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.addEventListener("click", () => openDashboardMedia(item));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDashboardMedia(item);
    }
  });

  const poster = document.createElement("span");
  poster.className = "dashboard-card-poster";
  setPoster(poster, item);
  const copy = document.createElement("span");
  copy.className = "dashboard-card-copy";
  const title = document.createElement("strong");
  title.textContent = item.title || "Saved title";
  const meta = document.createElement("small");
  meta.textContent = mediaMetaLabel(item);
  const type = document.createElement("span");
  type.className = "dashboard-card-type";
  type.textContent = mediaTypeLabel(item).toUpperCase();
  copy.append(type, title, meta);
  const favourite = document.createElement("span");
  favourite.className = "dashboard-card-favourite";
  favourite.textContent = isMediaFavorite(item) ? "★" : "☆";
  favourite.classList.toggle("is-favorite", isMediaFavorite(item));
  card.append(poster, favourite, copy);

  if (resume && Number(item.time) > 0) {
    const resumeButton = document.createElement("button");
    resumeButton.type = "button";
    resumeButton.className = "dashboard-resume-button";
    resumeButton.textContent = `Resume · ${formatTime(item.time)}`;
    resumeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openDashboardMedia(item, { resume: true });
    });
    copy.append(resumeButton);
  }

  if (resume && Number(item.time) > 0) {
    const progress = document.createElement("span");
    progress.className = "dashboard-card-progress";
    progress.style.width = `${Math.min(92, Math.max(4, Number(item.time) / 7200 * 100))}%`;
    card.append(progress);
  }

  if (removable) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "history-remove-button";
    remove.setAttribute("aria-label", `Remove ${item.title || "title"} from Continue Watching`);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      delete state.watchHistory[item.id];
      saveWatchHistory();
      renderDashboard();
    });
    card.append(remove);
  }
  return card;
}

function emptyShelf(message) {
  const note = document.createElement("div");
  note.className = "dashboard-empty";
  const label = document.createElement("span");
  label.textContent = message;
  note.append(label);
  if (state.contentMode === "adult-only" && !state.parentalUnlocked) {
    const unlock = document.createElement("button");
    unlock.type = "button";
    unlock.className = "secondary-wide-button";
    unlock.textContent = "Unlock with parental PIN";
    unlock.addEventListener("click", unlockContentMode);
    note.append(unlock);
  }
  return note;
}

function makeDashboardPosterCard(item) {
  const card = document.createElement("article");
  card.className = "dashboard-poster-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  const poster = document.createElement("span");
  poster.className = "dashboard-poster-art";
  setPoster(poster, item);
  const play = document.createElement("span");
  play.className = "dashboard-poster-play";
  play.textContent = "▶";
  const title = document.createElement("strong");
  title.textContent = item.title || "Untitled";
  const meta = document.createElement("small");
  meta.textContent = mediaMetaLabel(item);
  card.append(poster, play, title, meta);
  card.addEventListener("click", () => openDashboardMedia(item));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDashboardMedia(item);
    }
  });
  return card;
}

function renderLatestShelves(pool) {
  if (!elements.latestShelves) return;
  const groups = new Map();
  for (const item of pool) {
    const language = inferHomeLanguage(item) || "More to explore";
    if (!groups.has(language)) groups.set(language, []);
    groups.get(language).push(item);
  }
  const shelves = [...groups.entries()]
    .map(([language, items]) => [language, items.sort((a, b) => mediaReleaseValue(b) - mediaReleaseValue(a)).slice(0, 5)])
    .filter(([, items]) => items.length)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 3);

  if (!shelves.length) {
    elements.latestShelves.replaceChildren(emptyShelf("Latest releases will appear here as the catalogue loads."));
    return;
  }
  elements.latestShelves.replaceChildren(...shelves.map(([language, items]) => {
    const shelf = document.createElement("section");
    shelf.className = "latest-shelf";
    const heading = document.createElement("div");
    heading.className = "latest-shelf-heading";
    const title = document.createElement("h3");
    title.textContent = language;
    const count = document.createElement("span");
    count.textContent = `${items.length} fresh picks`;
    heading.append(title, count);
    const rail = document.createElement("div");
    rail.className = "latest-shelf-rail";
    rail.append(...items.map(makeDashboardPosterCard));
    shelf.append(heading, rail);
    return shelf;
  }));
}

function renderDashboard() {
  renderDashboardActions();
  if (!elements.continueWatching) return;
  const history = dashboardHistoryEntries();
  const entries = [...history]
    .sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0))
    .slice(0, 12);
  elements.continueWatching.replaceChildren(
    ...(entries.length ? entries.map((entry) => makeDashboardMediaCard(entry, { resume: true, removable: true })) : [emptyShelf("Your in-progress movies and episodes will appear here.")])
  );

  const dashboardPool = dashboardPoolItems();
  const recommended = buildRecommendations(dashboardPool, history);
  const heroCandidates = [];
  const heroIds = new Set();
  for (const item of [...recommended, ...dashboardPool.sort((a, b) => mediaReleaseValue(b) - mediaReleaseValue(a))]) {
    if (!item?.id || heroIds.has(String(item.id))) continue;
    heroIds.add(String(item.id));
    heroCandidates.push(item);
    if (heroCandidates.length >= 5) break;
  }
  syncDashboardHeroItems(heroCandidates, history);
  const languages = [...new Set(history.map(inferHomeLanguage).filter(Boolean))].slice(0, 2);
  const genres = [...new Set(history.flatMap(inferHomeGenres))].slice(0, 2);
  if (elements.recommendedReason) {
    elements.recommendedReason.textContent = history.length && (languages.length || genres.length)
      ? `Matched to ${[...languages, ...genres].join(" · ")}`
      : "Start watching to personalise this shelf";
  }
  if (elements.recommendedGrid) elements.recommendedGrid.replaceChildren(
    ...(recommended.length ? recommended.map((item) => makeDashboardMediaCard(item)) : [emptyShelf("Browse Movies & Series to build your recommendations.")])
  );
  renderLatestShelves(dashboardPool);
}

function stepDashboardHero(direction) {
  if (state.dashboardHeroItems.length < 2) return;
  state.dashboardHeroIndex = (state.dashboardHeroIndex + direction + state.dashboardHeroItems.length) % state.dashboardHeroItems.length;
  renderDashboardHero(state.dashboardHeroItems[state.dashboardHeroIndex], dashboardHistoryEntries());
  startDashboardHeroRotation();
}

elements.dashboardHero?.addEventListener("mouseenter", () => {
  state.dashboardHeroPaused = true;
  stopDashboardHeroRotation();
});
elements.dashboardHero?.addEventListener("mouseleave", () => {
  state.dashboardHeroPaused = false;
  startDashboardHeroRotation();
});
elements.dashboardHeroPrev?.addEventListener("click", () => stepDashboardHero(-1));
elements.dashboardHeroNext?.addEventListener("click", () => stepDashboardHero(1));
elements.dashboardHero?.addEventListener("focusin", () => {
  state.dashboardHeroPaused = true;
  stopDashboardHeroRotation();
});
elements.dashboardHero?.addEventListener("focusout", (event) => {
  if (elements.dashboardHero.contains(event.relatedTarget)) return;
  state.dashboardHeroPaused = false;
  startDashboardHeroRotation();
});

function renderDashboardActions() {
  if (!elements.dashboardActions) return;
  const actions = [
    ["live", "Live TV", "Watch your channels", '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 3 4 3 4-3M8 10h.01M12 10h.01M16 10h.01"/></svg>'],
    ["content", "Movies & Series", "Browse the provider catalogue", '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5M16 4v5M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>'],
    ["favorites", "Favourites", "Your saved channels and titles", '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/></svg>'],
  ];
  const nodes = actions.map(([mode, titleText, subtitle, icon]) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "dashboard-action";
    const iconNode = document.createElement("span"); iconNode.className = "dashboard-action-icon"; iconNode.setAttribute("aria-hidden", "true"); iconNode.innerHTML = icon;
    const title = document.createElement("strong"); title.textContent = titleText;
    const detail = document.createElement("small"); detail.textContent = subtitle;
    button.append(iconNode, title, detail);
    button.addEventListener("click", () => mode === "content" ? setVodFilter("all") : setMode(mode));
    return button;
  });
  elements.dashboardActions.replaceChildren(...nodes);
}

function renderFavorites() {
  if (!state.catalog) return;
  const channels = state.catalog.channels.filter((channel) => {
    const category = categoryById(channel.genreId);
    return state.favoriteChannels.has(channel.id) && canDisplayRestrictedContent(isRestrictedLiveChannel(channel)) &&
      (state.parentalUnlocked || (!category?.locked && !channel.adultLocked));
  });
  const channelNodes = channels.map((channel) => { const button = document.createElement("button"); button.type = "button"; button.className = "favorite-channel-card"; button.textContent = channel.name; button.addEventListener("click", () => { setMode("live"); playLive(channel); }); return button; });
  if (!channelNodes.length) { const note = document.createElement("div"); note.className = "dashboard-empty"; note.textContent = "No favourite channels yet."; channelNodes.push(note); }
  elements.favoriteChannelsGrid.replaceChildren(...channelNodes);
  const media = Object.values(state.watchMeta).filter((item) => isMediaFavorite(item) &&
    canDisplayRestrictedContent(isRestrictedMedia(item)) &&
    (state.parentalUnlocked || !isRestrictedMedia(item)));
  const mediaNodes = media.map((item) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "dashboard-card dashboard-media-card";
    const poster = document.createElement("span"); poster.className = "dashboard-card-poster"; setPoster(poster, item);
    const copy = document.createElement("span"); copy.className = "dashboard-card-copy";
    const title = document.createElement("strong"); title.textContent = item.title || "Saved title";
    const meta = document.createElement("small"); meta.textContent = item.mediaType === "series" ? "Series" : "Movie";
    copy.append(title, meta); button.append(poster, copy);
    button.addEventListener("click", () => { setVodFilter(item.mediaType === "series" ? "series" : "movie"); if (item.categoryId) openVodModal(item); });
    return button;
  });
  if (!mediaNodes.length) { const note = document.createElement("div"); note.className = "dashboard-empty"; note.textContent = "No favourite movies or series yet."; mediaNodes.push(note); }
  elements.favoriteMediaGrid.replaceChildren(...mediaNodes);
}

elements.seriesSeasonSelect?.addEventListener("change", (event) => {
  if (!event.target.value) return;
  state.series.episodeScrollTop = 0;
  state.series.episodeScrollSeason = String(event.target.value);
  loadCombinedSeriesEpisodes(event.target.value);
});
elements.seriesClose?.addEventListener("click", () => { elements.seriesModal.hidden = true; });
elements.seriesEpisodes?.addEventListener("scroll", () => {
  const scrollTop = elements.seriesEpisodes.scrollTop;
  state.series.episodeScrollTop = scrollTop;
  if (state.series.selected && state.series.episodeScrollSeason) {
    state.series.episodeScrollPositions[
      `${String(state.series.selected.id)}::${String(state.series.episodeScrollSeason)}`
    ] = scrollTop;
  }
});
elements.seriesFavoriteButton?.addEventListener("click", () => { const item = state.series.selected; if (!item) return; const favourite = toggleMediaFavorite(item); elements.seriesFavoriteButton.textContent = favourite ? "Remove favourite" : "Add to favourites"; });
elements.seriesModal?.addEventListener("click", (event) => { if (event.target === elements.seriesModal) elements.seriesModal.hidden = true; });
elements.closeSeriesPlayerButton?.addEventListener("click", () => { if (state.series.hls) { try { state.series.hls.destroy(); } catch {} state.series.hls = null; } stopMedia(elements.seriesVideo); elements.seriesPlayerSection.hidden = true; });
document.querySelectorAll(".content-type-button").forEach((button) => button.addEventListener("click", () => setVodFilter(button.dataset.contentFilter)));
elements.seriesSearch?.addEventListener("input", () => { state.series.query = elements.seriesSearch.value; renderSeriesGrid(); });
if (elements.seriesLoadMore) new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadNextSeriesPage(false); }, { rootMargin: "500px 0px" }).observe(elements.seriesLoadMore);

/* =====================================================
   FULLSCREEN / SEARCH / EDIT
===================================================== */

async function toggleFullscreen(container) {
  if (!container) return;
  try {
    if (!document.fullscreenElement) await container.requestFullscreen();
    else await document.exitFullscreen();
  } catch {}
}

let vodSearchTimer;
let vodSearchPollTimer;

async function searchAllVod(query, poll = false) {
  const text = String(query || "").trim();
  if (!poll) {
    clearTimeout(vodSearchPollTimer);
    state.vod.searchToken += 1;
    state.vod.searchResults = null;
    state.vod.searchIndexing = false;
    state.vod.searchIndexedItems = 0;
    state.vod.searchTotalItems = 0;
  }
  const token = state.vod.searchToken;

  if (text.length < 3) {
    state.vod.searchResults = null;
    state.vod.searching = false;
    state.vod.searchIndexing = false;
    renderVodGrid();
    return;
  }

  /* Always paint local shelf/cache matches immediately. The provider's native
     `search=` path is tried once for the settled query. A full local index is
     optional and is started only from Settings, never by every search. */
  state.vod.searchResults = searchLocalVodIndex(text);
  state.vod.searching = false;
  state.vod.searchIndexing = Boolean(state.vod.localIndexBuilding);
  renderVodGrid();

  if (!poll) {
    request(`/api/vod/search?q=${encodeURIComponent(text)}`)
      .then((result) => {
        if (token !== state.vod.searchToken) return;
        const wasReady = state.vod.localIndexReady;
        mergeVodLocalIndex(result.items || []);
        state.vod.localIndexReady = wasReady;
        state.vod.searchResults = searchLocalVodIndex(text);
        state.vod.searchIndexing = Boolean(result.building || state.vod.localIndexBuilding);
        renderVodGrid();
      })
      .catch(() => {});
  }
}

elements.search.addEventListener("input", () => {
  state.query = elements.search.value;
  renderChannels();
});

elements.vodSearch.addEventListener("input", () => {
  state.vod.query = elements.vodSearch.value;
  clearTimeout(vodSearchTimer);
  clearTimeout(vodSearchPollTimer);
  if (state.vod.query.trim().length < 3) {
    state.vod.searchToken += 1;
    state.vod.searchResults = null;
    state.vod.searching = false;
    state.vod.searchIndexing = false;
    renderVodGrid();
    return;
  }
  vodSearchTimer = setTimeout(() => searchAllVod(state.vod.query), 700);
});

elements.editGroupsButton.addEventListener("click", () => {
  state.editingGroups = !state.editingGroups;
  elements.editGroupsButton.classList.toggle("active", state.editingGroups);
  elements.editGroupsButton.textContent = state.editingGroups ? "Done" : "Show / edit";
  renderCategories();
});

elements.editChannelsButton.addEventListener("click", () => {
  state.editingChannels = !state.editingChannels;
  elements.editChannelsButton.classList.toggle("active", state.editingChannels);
  elements.editChannelsButton.textContent = state.editingChannels ? "Done" : "Show / edit";
  renderChannels();
});

document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => button.dataset.mode === "content" ? openContentBrowser() : setMode(button.dataset.mode));
});

/* =====================================================
   SETTINGS
===================================================== */

function setSettingsNotice(message, good = true) {
  if (!elements.contentNotice) return;
  elements.contentNotice.textContent = message;
  elements.contentNotice.style.color = good ? "#35dbc5" : "#ff9292";
  elements.contentNotice.hidden = !message;
}

function resetVodUiState() {
  clearTimeout(vodSearchPollTimer);
  state.vod.requestController?.abort();
  state.vod.requestController = null;
  state.vod.loadToken += 1;
  state.vod.categories = [];
  state.vod.categoryId = null;
  state.vod.items = [];
  state.vod.itemIds = new Set();
  state.vod.searchResults = null;
  state.vod.searching = false;
  state.vod.searchIndexing = false;
  state.vod.searchIndexedItems = 0;
  state.vod.searchTotalItems = 0;
  state.vod.localIndexServerCursor = 0;
  state.vod.localIndexLastSavedAt = 0;
  state.vod.page = 0;
  state.vod.total = 0;
  state.vod.ended = false;
  state.vod.shelves = [];
  state.vod.shelvesLoaded = false;
  state.vod.shelvesLoading = false;
  state.vod.shelvesLoadedItems = 0;
  clearTimeout(vodShelvesPollTimer);
  vodShelvesPollTimer = null;
  vodShelvesPromise = null;
  state.vod.searchToken += 1;
  state.series.categories = [];
  state.series.categoryId = null;
  state.series.items = [];
  state.series.itemIds = new Set();
  state.series.episodeScrollTop = 0;
  state.series.episodeScrollSeason = "";
  state.series.episodeScrollPositions = {};
}

async function refreshContent(manual = true, options = {}) {
  const { onProgress = null, throwOnError = false } = options;
  onProgress?.(5, "Refreshing", "Refreshing portal data…");
  if (elements.refreshContentButton) {
    elements.refreshContentButton.disabled = true;
    elements.refreshContentButton.textContent = "Refreshing…";
  }
  try {
    await request("/api/refresh", { method: "POST" });
    onProgress?.(22, "Authorizing", "Connecting to portal…");
    clearTimeout(localIndexSyncTimer);
    state.vod.localIndexSyncToken += 1;
    state.vod.localIndexSyncActive = false;
    await clearLocalVodIndex();
    localStorage.setItem("netplusLastContentRefresh", String(Date.now()));
    resetVodUiState();
    state.vod.localIndex = [];
    state.vod.localIndexReady = false;
    state.vod.localIndexBuilding = false;
    state.vod.localIndexServerCursor = 0;
    state.vod.localIndexLastSavedAt = 0;
    const loaded = await loadCatalog(options);
    if (!loaded) throw new Error("Portal catalogue was not loaded.");
    if (manual) setSettingsNotice("Content refreshed successfully.");
    return true;
  } catch (error) {
    setSettingsNotice(error.message || "Content refresh failed.", false);
    if (throwOnError) throw error;
    return false;
  } finally {
    if (elements.refreshContentButton) {
      elements.refreshContentButton.disabled = false;
      elements.refreshContentButton.textContent = "Refresh content";
    }
  }
}

async function clearLocalCache() {
  try {
    if (window.caches) {
      const names = await window.caches.keys();
      await Promise.all(names.map((name) => window.caches.delete(name)));
    }
    resetVodUiState();
    clearTimeout(localIndexSyncTimer);
    state.vod.localIndexSyncToken += 1;
    state.vod.localIndexSyncActive = false;
    await clearLocalVodIndex();
    state.vod.localIndex = [];
    state.vod.localIndexReady = false;
    state.vod.localIndexBuilding = false;
    const activeMode = document.querySelector(".mode-button.active")?.dataset.mode;
    if (activeMode === "content") setMode("content");
    else if (activeMode === "dashboard") renderDashboard();
    setSettingsNotice("Local content cache cleared. Your portal and watch history were kept.");
  } catch (error) {
    setSettingsNotice(error.message || "Could not clear the local cache.", false);
  }
}

function clearWatchHistory() {
  if (!Object.keys(state.watchHistory).length) {
    setSettingsNotice("Watch history is already empty.");
    return;
  }
  if (!window.confirm("Clear all Continue Watching progress?")) return;
  state.watchHistory = {};
  state.watchMeta = {};
  saveWatchHistory();
  renderDashboard();
  setSettingsNotice("Watch history cleared.");
}

function renderCastCapabilities() {
  if (!elements.castingStatus) return;
  const hasCast = Boolean(window.chrome?.cast || window.PresentationRequest);
  const canShare = typeof navigator.share === "function";
  if (hasCast) {
    elements.castingStatus.textContent = "A compatible presentation/cast API is available in this build.";
  } else {
    elements.castingStatus.textContent = "Chromecast and AirPlay are not exposed by this Windows build, so no fake cast control is shown.";
  }
  if (elements.shareButton) elements.shareButton.hidden = !canShare;
}

elements.settingsButton.addEventListener("click", () => {
  elements.settingsModal.hidden = false;
  if (elements.currentParentalPin) elements.currentParentalPin.hidden = !state.parentalConfigured;
  if (elements.generateRecoveryCodeButton) elements.generateRecoveryCodeButton.disabled = !state.parentalConfigured;
  renderLocalCatalogueStatus();
  loadPortals().catch((error) => setSettingsNotice(error.message, false));
});

elements.addPortalButton?.addEventListener("click", () => showPortalEditor());
elements.closePortalEditor?.addEventListener("click", () => { elements.portalEditorModal.hidden = true; });
elements.portalLoadingBackButton?.addEventListener("click", () => {
  elements.portalLoadingModal.hidden = true;
  elements.settingsModal.hidden = false;
});
elements.portalLoadingModal?.addEventListener("click", (event) => {
  if (event.target === elements.portalLoadingModal && !elements.portalLoadingError.hidden) return;
});
elements.portalEditorModal?.addEventListener("click", (event) => { if (event.target === elements.portalEditorModal) elements.portalEditorModal.hidden = true; });
elements.portalEditorMac?.addEventListener("blur", () => { elements.portalEditorMac.value = formatMacValue(elements.portalEditorMac.value); });
elements.portalEditorForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    id: elements.portalEditorId.value,
    nickname: elements.portalEditorNickname.value.trim(),
    portalUrl: elements.portalEditorUrl.value.trim(),
    mac: formatMacValue(elements.portalEditorMac.value),
  };
  try {
    const result = await request("/api/portals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    state.portals = result.portals || state.portals; state.activePortalId = result.activePortalId || state.activePortalId;
    renderPortalList(); elements.portalEditorModal.hidden = true; await refreshPortalWithProgress(body.nickname || "Portal");
  } catch (error) { elements.portalEditorNotice.textContent = error.message; elements.portalEditorNotice.style.color = "#ff9292"; elements.portalEditorNotice.hidden = false; }
});

elements.appFullscreenButton?.addEventListener("click", () => {
  toggleFullscreen(document.documentElement);
});

elements.closeSettingsButton.addEventListener("click", () => {
  elements.settingsModal.hidden = true;
  elements.pinNotice.hidden = true;
  elements.newParentalPin.value = "";
});

elements.settingsModal.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) elements.settingsModal.hidden = true;
});

function showRecoveryCode(code) {
  if (!code || !elements.recoveryCodePanel || !elements.recoveryCodeValue) return;
  elements.recoveryCodeValue.textContent = String(code);
  elements.recoveryCodePanel.hidden = false;
}

function closeForgotPinModal() {
  elements.forgotPinModal.hidden = true;
  elements.recoveryCodeInput.value = "";
  elements.recoveryNewPin.value = "";
  elements.recoveryPinError.hidden = true;
}

elements.generateRecoveryCodeButton?.addEventListener("click", async () => {
  const currentPin = elements.currentParentalPin.value.trim();
  if (!/^\d{4}$/.test(currentPin)) {
    setSettingsNotice("Enter your current 4-digit PIN first.", false);
    return;
  }
  elements.generateRecoveryCodeButton.disabled = true;
  elements.generateRecoveryCodeButton.textContent = "Generating…";
  try {
    const result = await request("/api/parental/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPin }) });
    state.recoveryConfigured = true;
    showRecoveryCode(result.recoveryCode);
    setSettingsNotice("New recovery code generated. Save it somewhere safe.");
  } catch (error) {
    setSettingsNotice(error.message || "Could not generate a recovery code.", false);
  } finally {
    elements.generateRecoveryCodeButton.disabled = !state.parentalConfigured;
    elements.generateRecoveryCodeButton.textContent = "Generate recovery code";
  }
});

elements.forgotParentalPinButton?.addEventListener("click", () => {
  elements.recoveryPinError.hidden = true;
  elements.forgotPinModal.hidden = false;
  setTimeout(() => elements.recoveryCodeInput.focus(), 50);
});
elements.closeForgotPinModal?.addEventListener("click", closeForgotPinModal);
elements.forgotPinModal?.addEventListener("click", (event) => { if (event.target === elements.forgotPinModal) closeForgotPinModal(); });
elements.forgotPinForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const recoveryCode = elements.recoveryCodeInput.value.trim();
  const newPin = elements.recoveryNewPin.value.trim();
  if (!/^\d{8}$/.test(recoveryCode) || !/^\d{4}$/.test(newPin)) {
    elements.recoveryPinError.textContent = "Enter the 8-digit recovery code and a new 4-digit PIN.";
    elements.recoveryPinError.hidden = false;
    return;
  }
  elements.recoverPinButton.disabled = true;
  elements.recoverPinButton.textContent = "Resetting…";
  try {
    const result = await request("/api/parental/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recoveryCode, newPin }) });
    state.parentalConfigured = true;
    state.recoveryConfigured = true;
    closeForgotPinModal();
    showRecoveryCode(result.recoveryCode);
    setSettingsNotice("PIN reset successfully. Save the new recovery code.");
  } catch (error) {
    elements.recoveryPinError.textContent = error.message || "PIN recovery failed.";
    elements.recoveryPinError.hidden = false;
  } finally {
    elements.recoverPinButton.disabled = false;
    elements.recoverPinButton.textContent = "Reset PIN";
  }
});

elements.themeSelect.addEventListener("change", (event) => {
  state.theme = ["dark", "light", "midnight"].includes(event.target.value) ? event.target.value : "dark";
  localStorage.setItem("theme", state.theme);
  applyTheme();
});
elements.contentModeSelect?.addEventListener("change", (event) => setContentMode(event.target.value));
elements.unlockContentModeButton?.addEventListener("click", unlockContentMode);
elements.playerSelect?.addEventListener("change", (event) => {
  const value = ["auto", "internal", "vlc"].includes(event.target.value) ? event.target.value : "auto";
  localStorage.setItem("defaultPlayer", value);
  event.target.value = value;
});
elements.languageSelect?.addEventListener("change", (event) => localStorage.setItem("appLanguage", event.target.value));
elements.subtitleSelect?.addEventListener("change", (event) => {
  const value = ["off", "auto", "en", "pa", "hi"].includes(event.target.value)
    ? event.target.value
    : "off";
  localStorage.setItem("subtitlePreference", value);
  if (state.vod.selected) void loadVodSubtitles(state.vod.selected);
});
elements.vodSubtitleSelect?.addEventListener("change", (event) => {
  const selected = String(event.target.value || "");
  const track = state.vod.subtitleTracks.find((candidate) => candidate.id === selected);
  localStorage.setItem("subtitlePreference", track?.language || "off");
  applyVodSubtitlePreference(selected || "off");
});

function compareVersions(left, right) {
  const a = String(left).replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  return 0;
}

function cachedUpdatePolicy() {
  try {
    const policy = JSON.parse(localStorage.getItem(UPDATE_POLICY_CACHE_KEY) || "null");
    if (!policy || !/^\d+\.\d+\.\d+$/.test(String(policy.latestVersion || "")) ||
        !/^\d+\.\d+\.\d+$/.test(String(policy.minimumVersion || "")) ||
        compareVersions(policy.minimumVersion, policy.latestVersion) > 0 ||
        !isTrustedUpdateUrl(policy.downloadUrl, policy.latestVersion)) return null;
    return policy;
  } catch { return null; }
}

function showUpdateRequired(policy, message, checking = false) {
  if (!elements.updateRequiredOverlay) return;
  elements.updateRequiredOverlay.hidden = !policy;
  if (!policy) return;
  elements.updateRequiredStatus.textContent = message ||
    `This version is below the minimum supported version ${policy.minimumVersion}. Install ${policy.latestVersion} to continue.`;
  state.latestUpdateUrl = isTrustedUpdateUrl(policy.downloadUrl, policy.latestVersion) ? policy.downloadUrl : "";
  elements.updateRequiredDownload.hidden = !state.latestUpdateUrl;
  elements.updateRequiredRetry.disabled = checking;
  elements.updateRequiredRetry.textContent = checking ? "Checking…" : "Retry check";
}

function hideUpdateToast() {
  if (updateToastTimer) window.clearTimeout(updateToastTimer);
  updateToastTimer = null;
  if (elements.updateToast) elements.updateToast.hidden = true;
}

function showUpdateToast(manifest, downloadUrl) {
  if (!elements.updateToast) return;
  elements.updateToastTitle.textContent = `STB PLAY v${manifest.version} is available`;
  elements.updateToastText.textContent = manifest.notes || "A newer version is ready to download.";
  elements.updateToastDownload.hidden = !downloadUrl;
  elements.updateToast.hidden = false;
  if (updateToastTimer) window.clearTimeout(updateToastTimer);
  updateToastTimer = window.setTimeout(hideUpdateToast, 15000);
}

function isTrustedUpdateUrl(rawUrl, version = "") {
  try {
    const parsed = new URL(String(rawUrl || ""));
    const releaseVersion = String(version || "").replace(/^v/i, "");
    return parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "github.com" &&
      parsed.username === "" && parsed.password === "" &&
      !parsed.port && !parsed.search && !parsed.hash &&
      parsed.pathname === `/ranveerskh/stbpplaywin/releases/download/v${releaseVersion}/Netplus-IPTV-Player-Setup-${releaseVersion}.exe` &&
      /^\d+\.\d+\.\d+$/.test(releaseVersion);
  } catch {
    return false;
  }
}

function startDirectUpdateDownload(downloadUrl) {
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = "";
  link.rel = "noreferrer";
  document.body.append(link);
  link.click();
  link.remove();
}

async function startUpdateDownload(downloadUrl = state.latestUpdateUrl) {
  if (!downloadUrl) return;

  trackAnalytics("update_downloaded", { screen: "update", success: true });

  /* The packaged Windows app downloads to a temporary folder, launches the
     installer, and then closes itself. Browser/dev mode keeps the direct
     asset download fallback. */
  if (window.stbPlay?.installUpdate) {
    const buttons = [elements.downloadUpdateButton, elements.updateToastDownload].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; button.textContent = "Downloading…"; });
    if (elements.updateStatus) elements.updateStatus.textContent = "Downloading update… The installer will start automatically.";
    try {
      await window.stbPlay.installUpdate(downloadUrl);
      if (elements.updateStatus) elements.updateStatus.textContent = "Installer is starting…";
      hideUpdateToast();
    } catch (error) {
      buttons.forEach((button) => { button.disabled = false; button.textContent = "Download & install"; });
      if (elements.updateStatus) elements.updateStatus.textContent = error.message || "Automatic installation failed. Direct download started instead.";
      startDirectUpdateDownload(downloadUrl);
    }
    return;
  }

  startDirectUpdateDownload(downloadUrl);
}

async function checkForUpdates({ silent = false, initial = false } = {}) {
  if (!elements.updateStatus && !elements.updateToast && !elements.updateRequiredOverlay) return true;
  if (elements.checkUpdatesButton) {
    elements.checkUpdatesButton.disabled = true;
    elements.checkUpdatesButton.textContent = "Checking…";
  }
  if (!silent && elements.updateStatus) elements.updateStatus.textContent = "Checking the latest published release…";

  const cached = cachedUpdatePolicy();
  const cachedIsMandatory = Boolean(cached && compareVersions(APP_VERSION, cached.minimumVersion) < 0);
  if (initial) {
    elements.updateRequiredOverlay.hidden = false;
    elements.updateRequiredStatus.textContent = cachedIsMandatory
      ? "Checking whether a newer supported version is available…"
      : "Checking the current version policy…";
    elements.updateRequiredDownload.hidden = true;
  } else if (cachedIsMandatory) {
    showUpdateRequired(cached, "Checking whether a newer supported version is available…", true);
  }

  try {
    const response = await fetch(`/api/update-policy?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Update service unavailable.");
    const manifest = await response.json();
    const latest = String(manifest.latestVersion || manifest.version || "");
    const minimum = String(manifest.minimumVersion || latest);
    const downloadUrl = String(manifest.downloadUrl || "").trim();
    if (manifest.platform !== "windows" || manifest.channel !== "stable" ||
        !/^\d+\.\d+\.\d+$/.test(latest) || !/^\d+\.\d+\.\d+$/.test(minimum) ||
        compareVersions(minimum, latest) > 0 || !isTrustedUpdateUrl(downloadUrl, latest)) {
      throw new Error("The update policy could not be verified.");
    }

    const policy = {
      platform: "windows", channel: "stable", version: latest,
      latestVersion: latest, minimumVersion: minimum, downloadUrl,
      notes: String(manifest.notes || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400),
    };
    localStorage.setItem(UPDATE_POLICY_CACHE_KEY, JSON.stringify(policy));
    const mustUpdate = compareVersions(APP_VERSION, minimum) < 0;
    if (mustUpdate) {
      state.latestUpdateUrl = downloadUrl;
      showUpdateRequired(policy, `This version is no longer supported. Install STB PLAY v${latest} to continue.`);
      if (elements.updateStatus) elements.updateStatus.textContent = `Update required · install v${latest} to continue.`;
      if (state.analytics.lastUpdateNotice !== latest) {
        state.analytics.lastUpdateNotice = latest;
        trackAnalytics("update_available", { screen: "update", toVersion: latest, success: true });
      }
      if (elements.downloadUpdateButton) elements.downloadUpdateButton.hidden = false;
      showUpdateToast({ ...policy, version: latest }, downloadUrl);
      return false;
    }

    showUpdateRequired(null);
    if (compareVersions(latest, APP_VERSION) > 0) {
      state.latestUpdateUrl = downloadUrl;
      if (state.analytics.lastUpdateNotice !== latest) {
        state.analytics.lastUpdateNotice = latest;
        trackAnalytics("update_available", { screen: "update", toVersion: latest, success: true });
      }
      if (elements.downloadUpdateButton) elements.downloadUpdateButton.hidden = false;
      if (elements.updateStatus && !silent) {
        elements.updateStatus.textContent = `Version ${latest} is available${policy.notes ? ` · ${policy.notes}` : ""}.`;
      }
      showUpdateToast({ ...policy, version: latest }, downloadUrl);
    } else {
      state.latestUpdateUrl = "";
      if (elements.downloadUpdateButton) elements.downloadUpdateButton.hidden = true;
      if (elements.updateStatus && !silent) elements.updateStatus.textContent = `You are up to date · STB PLAY v${APP_VERSION}.`;
    }
    return true;
  } catch {
    const policy = cachedUpdatePolicy();
    const mustUpdate = Boolean(policy && compareVersions(APP_VERSION, policy.minimumVersion) < 0);
    if (mustUpdate) {
      showUpdateRequired(policy, `Could not reach the update service. Version ${policy.minimumVersion} or newer is required. Retry when your connection is available.`);
      if (elements.updateStatus) elements.updateStatus.textContent = `Update check unavailable · v${policy.minimumVersion} is still required. Retry the check when online.`;
      return false;
    }
    showUpdateRequired(null);
    if (!silent && elements.updateStatus) {
      elements.updateStatus.textContent = `Could not check right now · current version v${APP_VERSION}. You can retry from Settings.`;
    }
    return true;
  } finally {
    if (elements.checkUpdatesButton) {
      elements.checkUpdatesButton.disabled = false;
      elements.checkUpdatesButton.textContent = "Check for updates";
    }
    if (elements.updateRequiredRetry) {
      elements.updateRequiredRetry.disabled = false;
      elements.updateRequiredRetry.textContent = "Retry check";
    }
  }
}
elements.checkUpdatesButton?.addEventListener("click", () => checkForUpdates());
elements.downloadUpdateButton?.addEventListener("click", () => startUpdateDownload());
elements.updateRequiredRetry?.addEventListener("click", () => checkForUpdates({ silent: false }));
elements.updateRequiredDownload?.addEventListener("click", () => startUpdateDownload(state.latestUpdateUrl));
elements.updateToastDownload?.addEventListener("click", () => startUpdateDownload());
elements.dismissUpdateToast?.addEventListener("click", hideUpdateToast);

function showFirstStartWarningIfNeeded() {
  if (localStorage.getItem("stbPlayFirstStartAcknowledged") === "1") return;
  elements.firstStartWarningModal.hidden = false;
}

elements.firstStartReadButton?.addEventListener("click", () => {
  localStorage.setItem("stbPlayFirstStartAcknowledged", "1");
  elements.firstStartWarningModal.hidden = true;
});

elements.refreshContentButton?.addEventListener("click", () => refreshContent(true));
elements.analyticsEnabled?.addEventListener("change", (event) => {
  state.analytics.enabled = Boolean(event.target.checked);
  try { localStorage.setItem("stbPlayAnonymousAnalytics", state.analytics.enabled ? "1" : "0"); } catch {}
  if (state.analytics.enabled) {
    trackAnalytics("feature_used", { screen: "app", reason: "analytics-enabled" });
    setSettingsNotice("Anonymous app analytics enabled. No MAC, PIN, portal, or stream details are sent.");
  } else {
    clearInterval(state.analytics.heartbeatTimer);
    state.analytics.heartbeatTimer = null;
    fetch("/api/analytics/clear", { method: "POST", keepalive: true }).catch(() => {});
    setSettingsNotice("Anonymous app analytics disabled on this device.");
  }
});
elements.loadLocalCatalogueButton?.addEventListener("click", () => {
  state.vod.localIndexError = "";
  state.vod.localIndexBuilding = true;
  renderLocalCatalogueStatus();
  void syncVodIndex();
});
elements.clearCacheButton?.addEventListener("click", clearLocalCache);
elements.clearHistoryButton?.addEventListener("click", clearWatchHistory);
elements.shareButton?.addEventListener("click", async () => {
  try {
    await navigator.share({ title: "STB PLAY", text: "STB PLAY" });
  } catch {}
});

elements.updatePinButton.addEventListener("click", async () => {
  const currentPin = elements.currentParentalPin.value.trim();
  const newPin = elements.newParentalPin.value.trim();

  if ((state.parentalConfigured && !/^\d{4}$/.test(currentPin)) || !/^\d{4}$/.test(newPin)) {
    elements.pinNotice.textContent = state.parentalConfigured
      ? "Enter your current PIN and a new 4-digit PIN."
      : "Enter a new 4-digit PIN.";
    elements.pinNotice.style.color = "#ff9292";
    elements.pinNotice.hidden = false;
    return;
  }

  elements.updatePinButton.disabled = true;
  elements.updatePinButton.textContent = "Updating...";

  try {
    const result = await request(state.parentalConfigured ? "/api/parental/update" : "/api/parental/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: state.parentalConfigured ? JSON.stringify({ currentPin, newPin }) : JSON.stringify({ pin: newPin }),
    });

    state.parentalUnlocked = false;
    state.parentalConfigured = true;
    state.recoveryConfigured = true;
    elements.pinNotice.textContent = result.recoveryCode ? "PIN updated. Save the new recovery code below." : "PIN updated successfully.";
    elements.pinNotice.style.color = "#35dbc5";
    elements.pinNotice.hidden = false;
    elements.newParentalPin.value = "";
    elements.currentParentalPin.value = "";
    showRecoveryCode(result.recoveryCode);
  } catch (error) {
    elements.pinNotice.textContent = error.message || "Failed to update PIN.";
    elements.pinNotice.style.color = "#ff9292";
    elements.pinNotice.hidden = false;
  } finally {
    elements.updatePinButton.disabled = false;
    elements.updatePinButton.textContent = "Update PIN";
  }
});

elements.resetDiagnosticButton?.addEventListener("click", async () => {
  elements.resetDiagnosticButton.disabled = true;
  elements.resetDiagnosticButton.textContent = "Starting...";

  try {
    await request("/api/diagnostics/reset", { method: "POST" });
    elements.diagnosticNotice.textContent = "Fresh test started. Now play 1 live channel for 45 seconds, 1 movie, then open 1 series.";
    elements.diagnosticNotice.style.color = "#35dbc5";
    elements.diagnosticNotice.hidden = false;
  } catch (error) {
    elements.diagnosticNotice.textContent = error.message || "Could not reset the diagnostic report.";
    elements.diagnosticNotice.style.color = "#ff9292";
    elements.diagnosticNotice.hidden = false;
  } finally {
    elements.resetDiagnosticButton.disabled = false;
    elements.resetDiagnosticButton.textContent = "Start fresh test";
  }
});

elements.downloadDiagnosticButton?.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = `/api/diagnostics/download?ts=${Date.now()}`;
  link.download = "netplus-diagnostics-v1.8.16.json";
  document.body.append(link);
  link.click();
  link.remove();

  elements.diagnosticNotice.textContent = "Report downloaded. Attach netplus-diagnostics-v1.8.16.json to your support message.";
  elements.diagnosticNotice.style.color = "#35dbc5";
  elements.diagnosticNotice.hidden = false;
});

elements.resetPortalButton.addEventListener("click", () => {
  elements.settingsModal.hidden = false;
  loadPortals().catch((error) => setSettingsNotice(error.message, false));
  requestAnimationFrame(() => elements.addPortalButton?.focus());
});

/* =====================================================
   SETUP
===================================================== */

elements.setupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

    const serviceId = elements.serviceId.value.trim();
    const portalNickname = elements.portalNickname.value.trim();
    const portalUrl = elements.portalUrl.value.trim();
    const mac = formatMacValue(elements.mac.value);
  const parentalPin = elements.parentalPin.value.trim();

  if (!portalNickname || !portalUrl) {
    elements.setupError.textContent = "Enter a portal nickname and URL.";
    elements.setupError.hidden = false;
    return;
  }

  if (!/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(mac)) {
    elements.setupError.textContent =
      "Enter all 12 MAC digits. Colons are added automatically.";
    elements.setupError.hidden = false;
    elements.mac.focus();
    return;
  }

  elements.mac.value = mac;
  elements.setupError.hidden = true;
  elements.connectButton.disabled = true;
  elements.connectButton.textContent = "Saving...";

  try {
    await request("/api/portals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "", nickname: portalNickname, portalUrl, mac, parentalPin }),
    });

    localStorage.setItem("netplusServiceId", "custom");
    localStorage.setItem("netplusMac", mac);

    state.parentalUnlocked = false;
    elements.parentalPin.value = "";

    /* Keep the setup screen covered until the new portal is fully loaded. */
    await refreshPortalWithProgress(portalNickname || "Portal");
  } catch (error) {
    elements.setupError.textContent = error.message;
    elements.setupError.hidden = false;
  } finally {
    elements.connectButton.disabled = false;
    elements.connectButton.textContent = "Save & Connect";
  }
});

/* =====================================================
   KEYBOARD
===================================================== */

document.addEventListener("keydown", (event) => {
  if (elements.updateRequiredOverlay && !elements.updateRequiredOverlay.hidden) {
    event.preventDefault();
    return;
  }
  const activeTag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;

  if (event.key === "Escape") {
    if (!elements.pinModal.hidden) return closePinModal(true);
    if (!elements.forgotPinModal.hidden) return closeForgotPinModal();
    if (!elements.vodModal.hidden) return closeVodModal();
    if (!elements.vodPlayerSection.hidden) return elements.closeVodPlayerButton.click();
    if (!elements.settingsModal.hidden) {
      elements.settingsModal.hidden = true;
      return;
    }
  }

  const vodPlaying = !elements.vodPlayerSection.hidden && !!state.vod.selected;

  if (vodPlaying) {
    switch (event.key.toLowerCase()) {
      case " ":
        event.preventDefault();
        elements.vodVideo.paused
          ? elements.vodVideo.play().catch(() => {})
          : elements.vodVideo.pause();
        return;
      case "f":
        event.preventDefault();
        toggleFullscreen(elements.vodPlayerContainer);
        return;
      case "m":
        event.preventDefault();
        elements.vodMuteBtn.click();
        return;
      case "arrowleft":
        event.preventDefault();
        elements.vodVideo.currentTime = Math.max(0, elements.vodVideo.currentTime - 10);
        return;
      case "arrowright":
        event.preventDefault();
        if (Number.isFinite(elements.vodVideo.duration)) {
          elements.vodVideo.currentTime =
            Math.min(elements.vodVideo.duration, elements.vodVideo.currentTime + 10);
        }
        return;
    }
  }

  if (!state.selected || state.selected.kind !== "live") return;

  switch (event.key.toLowerCase()) {
    case " ":
      event.preventDefault();
      elements.video.paused
        ? elements.video.play().catch(() => {})
        : elements.video.pause();
      break;
    case "f":
      event.preventDefault();
      toggleFullscreen(elements.playerContainer);
      break;
    case "m":
      event.preventDefault();
      elements.muteBtn.click();
      break;
    case "arrowup":
    case "arrowdown": {
      event.preventDefault();
      const channels = filteredChannels();
      const index = channels.findIndex((channel) => channel.id === state.selected.id);
      if (index < 0 || !channels.length) return;

      let nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
      if (nextIndex < 0) nextIndex = channels.length - 1;
      if (nextIndex >= channels.length) nextIndex = 0;

      playLive(channels[nextIndex]);
      break;
    }
  }
});

/* =====================================================
   BOOT
===================================================== */

async function refreshIfDue() {
  const last = Number(localStorage.getItem("netplusLastContentRefresh") || 0);
  if (last && Date.now() - last < 24 * 60 * 60 * 1000) return;
  try {
    await request("/api/refresh", { method: "POST" });
  } catch {
    /* A refresh is best-effort; the normal catalogue load can still work. */
  }
}

async function boot() {
  applyTheme();
  applyPreferences();
  const updateAllowsStartup = await checkForUpdates({ silent: true, initial: true });
  if (!updateAllowsStartup) return;
  startAnalyticsLifecycle();
  renderCastCapabilities();
  showFirstStartWarningIfNeeded();

  elements.mac.value =
    formatMacValue(localStorage.getItem("netplusMac") || elements.mac.value || "");

  elements.serviceId.value =
    localStorage.getItem("netplusServiceId") || "";

  try {
    const result = await request("/api/config");

    if (result.configured) {
      state.parentalConfigured = Boolean(result.parentalConfigured);
      state.recoveryConfigured = Boolean(result.recoveryConfigured);
      if (elements.currentParentalPin) elements.currentParentalPin.hidden = !state.parentalConfigured;
      if (elements.generateRecoveryCodeButton) elements.generateRecoveryCodeButton.disabled = !state.parentalConfigured;
      /* Show feedback before even the saved-portal lookup starts. This keeps
         a reopened app from looking frozen on the setup or Live TV screen. */
      showPortalLoading("Saved portal");
      try {
        setPortalLoadingProgress(5, "Preparing", "Loading saved portal…");
        await loadPortals();
        const activePortal = state.portals.find((portal) => portal.id === state.activePortalId);
        const loaded = await refreshPortalWithProgress(activePortal?.nickname || "Saved portal", { alreadyVisible: true });
        if (!loaded) return;
      } catch (error) {
        failPortalLoading(error);
        return;
      }
      /* The local catalogue is loaded on demand from Settings or Search so
         a 127k-title index cannot slow normal Live/VOD browsing. */
    } else {
      showSetup();
    }
  } catch (error) {
    showSetup();
    elements.setupError.textContent = error.message;
    elements.setupError.hidden = false;
  }
}

boot();
