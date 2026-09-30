import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  Timestamp,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCzL7scSVcOTB3Du5K59RMBr6_ZeLJ8orc",
  authDomain: "stb-play-analytics.firebaseapp.com",
  projectId: "stb-play-analytics",
  storageBucket: "stb-play-analytics.firebasestorage.app",
  messagingSenderId: "79634928032",
  appId: "1:79634928032:web:95105551c1e0153e2614c5",
};

const GITHUB_REPO = "ranveerskh/stbpplaywin";
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const loginView = $("loginView");
const dashboardView = $("dashboardView");
const loginForm = $("loginForm");
const loginError = $("loginError");
const refreshButton = $("refreshButton");
const logoutButton = $("logoutButton");

const formatNumber = (value) => new Intl.NumberFormat("en-CA").format(Number(value || 0));

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = !message;
}

function setDashboardStatus(message, kind = "neutral") {
  const element = $("dashboardStatus");
  element.textContent = message;
  element.className = `status-pill status-${kind}`;
}

function millis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

function daysAgo(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

async function isAdmin(user) {
  const snapshot = await getDoc(doc(db, "admins", user.uid));
  return snapshot.exists() && snapshot.data()?.role === "admin";
}

async function readInstallations() {
  const snapshot = await getDocs(collection(db, "installations"));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function readRecentEvents() {
  const start = Timestamp.fromMillis(daysAgo(7));
  const eventQuery = query(
    collection(db, "events"),
    where("createdAt", ">=", start),
    limit(5000),
  );
  const snapshot = await getDocs(eventQuery);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function readGitHubReleases() {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const releases = await response.json();
  const published = releases.filter((release) => !release.draft && !release.prerelease);
  const downloads = published.reduce(
    (total, release) => total + (release.assets || [])
      .filter((asset) => asset.name.toLowerCase().endsWith(".exe"))
      .reduce((sum, asset) => sum + Number(asset.download_count || 0), 0),
    0,
  );
  return {
    downloads,
    latest: published[0]?.tag_name || "—",
    releases: published,
  };
}

function countBy(items, property) {
  return items.reduce((counts, item) => {
    const key = item[property] || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function setText(id, value) {
  $(id).textContent = value;
}

function renderVersions(installations) {
  const container = $("versionRows");
  const counts = countBy(installations, "version");
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    container.innerHTML = '<p class="empty-state">No installation data yet.</p>';
    return;
  }
  const maximum = entries[0][1];
  container.innerHTML = entries.map(([version, count]) => `
    <div class="bar-row">
      <span class="bar-label" title="${escapeHtml(version)}">${escapeHtml(version)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, (count / maximum) * 100)}%"></div></div>
      <span class="bar-value">${formatNumber(count)}</span>
    </div>
  `).join("");
}

function renderEvents(events) {
  const container = $("eventRows");
  const counts = countBy(events, "name");
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    container.innerHTML = '<p class="empty-state">No events yet.</p>';
    return;
  }
  container.innerHTML = entries.map(([name, count]) => `
    <div class="event-card"><span title="${escapeHtml(name)}">${escapeHtml(name.replaceAll("_", " "))}</span><strong>${formatNumber(count)}</strong></div>
  `).join("");
}

function renderMetrics(installations, events, releases) {
  const activeDay = installations.filter((item) => millis(item.lastSeenAt) >= daysAgo(1)).length;
  const activeWeek = installations.filter((item) => millis(item.lastSeenAt) >= daysAgo(7)).length;
  const activeMonth = installations.filter((item) => millis(item.lastSeenAt) >= daysAgo(30)).length;
  const eventCounts = countBy(events, "name");
  const playbackStarts = eventCounts.playback_started || 0;
  const playbackFailures = eventCounts.playback_failed || 0;
  const portalSuccesses = eventCounts.portal_load_success || 0;
  const portalFailures = eventCounts.portal_load_failed || 0;
  const playbackTotal = playbackStarts + playbackFailures;
  const portalTotal = portalSuccesses + portalFailures;
  const playbackSuccessRate = playbackTotal ? Math.round((playbackStarts / playbackTotal) * 100) : 0;
  const portalSuccessRate = portalTotal ? Math.round((portalSuccesses / portalTotal) * 100) : 0;

  setText("metricDownloads", formatNumber(releases?.downloads));
  setText("metricInstalls", formatNumber(installations.length));
  setText("metricActiveDay", formatNumber(activeDay));
  setText("metricActiveMonth", formatNumber(activeMonth));
  setText("retentionDay", formatNumber(activeDay));
  setText("retentionWeek", formatNumber(activeWeek));
  setText("retentionMonth", formatNumber(activeMonth));
  setText("playbackStarts", formatNumber(playbackStarts));
  setText("playbackFailures", formatNumber(playbackFailures));
  setText("vlcFallbacks", formatNumber(eventCounts.vlc_fallback || 0));
  setText("portalSuccesses", formatNumber(portalSuccesses));
  setText("portalFailures", formatNumber(portalFailures));
  setText("crashReports", formatNumber(eventCounts.crash_reported || 0));
  setText("playbackRate", playbackTotal ? `${playbackSuccessRate}% successful starts in the last 7 days.` : "No playback events yet.");
  setText("portalRate", portalTotal ? `${portalSuccessRate}% successful portal loads in the last 7 days.` : "No portal events yet.");
  $("playbackMeter").style.width = `${playbackSuccessRate}%`;
  $("latestRelease").textContent = `Latest: ${releases?.latest || "—"}`;
  renderVersions(installations);
  renderEvents(events);
}

async function loadDashboard() {
  refreshButton.disabled = true;
  setDashboardStatus("Loading data…", "neutral");
  try {
    const [installations, events, releases] = await Promise.all([
      readInstallations(),
      readRecentEvents(),
      readGitHubReleases().catch(() => ({ downloads: 0, latest: "Unavailable", releases: [] })),
    ]);
    renderMetrics(installations, events, releases);
    $("lastUpdated").textContent = `Updated ${new Intl.DateTimeFormat("en-CA", { timeStyle: "short" }).format(new Date())}`;
    setDashboardStatus("All data loaded", "good");
  } catch (error) {
    console.error(error);
    setDashboardStatus("Could not load data", "bad");
    $("lastUpdated").textContent = "Check Firestore rules";
  } finally {
    refreshButton.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showLoginError("");
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $("emailInput").value.trim(), $("passwordInput").value);
  } catch (error) {
    showLoginError(error.code === "auth/invalid-credential" ? "Email or password is incorrect." : error.message);
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", loadDashboard);
logoutButton.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginView.hidden = false;
    dashboardView.hidden = true;
    return;
  }
  try {
    if (!(await isAdmin(user))) throw new Error("This account is not an STB PLAY admin.");
    loginView.hidden = true;
    dashboardView.hidden = false;
    await loadDashboard();
  } catch (error) {
    await signOut(auth);
    loginView.hidden = false;
    dashboardView.hidden = true;
    showLoginError(error.message || "Admin access was denied.");
  }
});
