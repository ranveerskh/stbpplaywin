Warning: truncated output (original token count: 58394)
Total output lines: 5825

/*
=========================================================
 STB PLAY IPTV Player
 VERSION: 1.8.26 provider setup details
 File: app.js
=========================================================
*/

const APP_VERSION = "1.8.26";
const DASHBOARD_HERO_INTERVAL_MS = 8000;
const CONTENT_MODES = window.StbPlayContentModes;
const UPDATE_POLICY_CACHE_KEY = "stbPlayVerifiedUpdatePolicy";
const RESTRICTED_CATEGORY_CACHE_PREFIX = "stbPlayRestrictedCategories:";
const RESTRICTED_CATEGORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const state = {
  catalog: null,
  catalogLoadInProgress: false,
  category: "all",
  query: "",
  selected: null,
  hls: null,
  liveRetryToken: 0,
  liveScrollTop: 0,

  parentalUnlocked: false,
  contentModeUnlocked: false,
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
  restrictedDiscoveryItems: [],
  restrictedCategoryCachePortalId: null,
  restrictedCategoryCache: {},
  restrictedDiscoveryScannedCategories: new Set(),
  loadedCompleteLiveCategories: new Set(),
  restrictedDiscoveryRequested: false,

  editingGroups: false,
  editingChannels: false,
  theme: localStorage.getItem("theme") || "dark",
  contentMode: CONTENT_MODES?.normalizeMode(localStorage.getItem("stbPlayContentMode")) || "all",
  portals: [],
  activePortalId: null,
  providerDeviceIdRaw: "",
  providerDetailsRenderToken: 0,
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
  registrationHeartbeatTimer: null,

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
  themeModeNote: $("#themeModeNote"),
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
  registrationKey: $("#registrationKey"),
  registerDeviceButton: $("#registerDeviceButton"),
  registrationStatus: $("#registrationStatus"),
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

function showRegistrationStatus(message, good = true) {
  if (!elements.registrationStatus) return;
  elements.registrationStatus.textContent = message;
  elements.registrationStatus.style.color = good ? "#35dbc5" : "#ff9292";
}

async function refreshRegistrationStatus() {
  try {
    const status = await request("/api/registration/status");
    state.providerDeviceIdRaw = typeof status.deviceId === "string" ? status.deviceId : "";
    renderProviderSetupDetails();
    if (status.registered) {
      const stamp = status.lastHeartbeatAt ? new Date(status.lastHeartbeatAt).toLocaleString() : "pending";
      showRegistrationStatus(`This Windows device is registered · last heartbeat: ${stamp}.`);
    } else {
      showRegistrationStatus("This device is not registered yet.", false);
    }
    return status;
  } catch (error) {
    showRegistrationStatus(error.message || "Could not read registration status.", false);
    return null;
  }
}

function renderProviderSetupDetails() {
  const portalMacValue = $("#providerPortalMacValue");
  const deviceIdValue = $("#providerDeviceIdValue");
  if (!portalMacValue || !deviceIdValue) return;

  const activePortal = state.portals.find((portal) => String(portal.id) === String(state.activePortalId));
  const portalMac = typeof activePortal?.mac === "string" ? activePortal.mac.trim() : "";
  portalMacValue.textContent = portalMac || "No portal MAC configured";

  const rawDeviceId = state.providerDeviceIdRaw;
  const renderToken = ++state.providerDetailsRenderToken;
  if (!rawDeviceId) {
    deviceIdValue.textContent = "Device ID unavailable";
    return;
  }

  const hashDeviceIdForDisplay = window.StbPlayProviderSetup?.hashDeviceIdForDisplay;
  if (typeof hashDeviceIdForDisplay !== "function") {
    deviceIdValue.textContent = "Device ID display unavailable";
    return;
  }

  deviceIdValue.textContent = "Loading…";
  hashDeviceIdForDisplay(rawDeviceId).then((displayId) => {
    if (renderToken !== state.providerDetailsRenderToken || rawDeviceId !== state.providerDeviceIdRaw) return;
    deviceIdValue.textContent = displayId || "Device ID unavailable";
  }).catch(() => {
    if (renderToken === state.providerDetailsRenderToken) deviceIdValue.textContent = "Device ID unavailable";
  });
}

async function sendDeviceHeartbeat(showStatus = false) {
  try {
    const status = await request("/api/registration/heartbeat", { method: "POST" });
    if (showStatus) await refreshRegistrationStatus();
    return status;
  } catch (error) {
    if (showStatus) showRegistrationStatus(error.message || "Heartbeat could not be sent. It will retry automatically.", false);
    return null;
  }
}

async function heartbeatIfRegistered() {
  try {
    const status = await request("/api/registration/status");
    if (status.registered) await sendDeviceHeartbeat(false);
  } catch {}
}

function startRegistrationHeartbeat() {
  clearInterval(state.registrationHeartbeatTimer);
  void heartbeatIfRegistered();
  state.registrationHeartbeatTimer = window.setInterval(
    () => void heartbeatIfRegistered(),
    15 * 60 * 1000
  );
}

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
    const db = await openVodI…46394 tokens truncated…hemeSelect.addEventListener("change", (event) => {
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

function minimumVersionForPolicy(policy) {
  const publishedAt = Date.parse(String(policy?.publishedAt || ""));
  const newerReleaseExists = compareVersions(APP_VERSION, policy?.latestVersion || "0.0.0") < 0;
  const graceExpired = Number.isFinite(publishedAt) && Date.now() >= publishedAt + 14 * 24 * 60 * 60 * 1000;
  return newerReleaseExists && graceExpired ? String(policy.latestVersion) : "0.0.0";
}

function cachedUpdatePolicy() {
  try {
    const policy = JSON.parse(localStorage.getItem(UPDATE_POLICY_CACHE_KEY) || "null");
    if (!policy || !/^\d+\.\d+\.\d+$/.test(String(policy.latestVersion || "")) ||
        !isTrustedUpdateUrl(policy.downloadUrl, policy.latestVersion)) return null;
    return { ...policy, minimumVersion: minimumVersionForPolicy(policy) };
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
      if (!/downloaded installer is saved at/i.test(String(error.message || ""))) {
        startDirectUpdateDownload(downloadUrl);
      }
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
    const publishedAt = String(manifest.publishedAt || "");
    const downloadUrl = String(manifest.downloadUrl || "").trim();
    if (manifest.platform !== "windows" || manifest.channel !== "stable" ||
        !/^\d+\.\d+\.\d+$/.test(latest) ||
        (publishedAt && !Number.isFinite(Date.parse(publishedAt))) || !isTrustedUpdateUrl(downloadUrl, latest)) {
      throw new Error("The update policy could not be verified.");
    }

    const policy = {
      platform: "windows", channel: "stable", version: latest,
      latestVersion: latest, publishedAt, minimumVersion: "0.0.0", downloadUrl,
      notes: String(manifest.notes || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400),
    };
    policy.minimumVersion = minimumVersionForPolicy(policy);
    localStorage.setItem(UPDATE_POLICY_CACHE_KEY, JSON.stringify(policy));
    const mustUpdate = compareVersions(APP_VERSION, policy.minimumVersion) < 0;
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
    state.contentModeUnlocked = false;
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
  link.download = "netplus-diagnostics-v1.8.26.json";
  document.body.append(link);
  link.click();
  link.remove();

  elements.diagnosticNotice.textContent = "Report downloaded. Attach netplus-diagnostics-v1.8.26.json to your support message.";
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
    state.contentModeUnlocked = false;
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
  startRegistrationHeartbeat();
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
