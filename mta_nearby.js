// MTA Nearby Stops Widget
// for use in Scriptable on iOS
// Uses the MTAPI proxy (wheresthefuckingtrain.com) for location-based JSON
// API docs: https://github.com/jonthornton/MTAPI/blob/master/docs/endpoints.md
// Layout: medium landscape widget — compact 3-row design

// ===================================================
// FONTS
// ===================================================

const FONT_REG = (size) => new Font("Menlo", size);
const FONT_BOLD = (size) => new Font("Menlo-Bold", size);
const SYS_REG = (size) => Font.systemFont(size);
const SYS_BOLD = (size) => Font.boldSystemFont(size);

// ===================================================
// CONFIGURATION
// ===================================================

const MTAPI_BASE = "https://api.wheresthefuckingtrain.com";
const MAX_TRAINS = 3; // arrivals per direction per station
const MAX_STATIONS = 2; // must be 2 for side-by-side layout
const MAX_MINUTES = 30; // ignore trains beyond this many minutes out
const LOC_CACHE_SECS = 300; // reuse cached location if < 5 min old
const DATA_CACHE_SECS = 30; // reuse cached API response if < 30 sec old
const REFRESH_SECS = 300; // ask iOS to refresh widget every 5 min

// ===================================================
// CACHE  (FileManager-backed)
// ===================================================

const FM = FileManager.local();
const CACHE_DIR = FM.joinPath(FM.cacheDirectory(), "mta_nearby");

if (!FM.fileExists(CACHE_DIR)) FM.createDirectory(CACHE_DIR, true);

function cachePath(name) {
  return FM.joinPath(CACHE_DIR, name + ".json");
}

function readCache(name, maxAgeSecs) {
  const path = cachePath(name);
  if (!FM.fileExists(path)) return null;
  const ageMs = Date.now() - FM.modificationDate(path).getTime();
  if (ageMs > maxAgeSecs * 1000) return null;
  try {
    return JSON.parse(FM.readString(path));
  } catch {
    return null;
  }
}

function writeCache(name, data) {
  try {
    FM.writeString(cachePath(name), JSON.stringify(data));
  } catch {}
}

// ===================================================
// MTA OFFICIAL LINE COLORS
// Source: https://web.mta.info/developers/resources/line_colors.htm
// ===================================================

const LINE_COLORS = {
  1: "#EE352E",
  2: "#EE352E",
  3: "#EE352E",
  A: "#0039A6",
  C: "#0039A6",
  E: "#0039A6",
  B: "#FF6319",
  D: "#FF6319",
  F: "#FF6319",
  M: "#FF6319",
  N: "#FCCC0A",
  Q: "#FCCC0A",
  R: "#FCCC0A",
  W: "#FCCC0A",
  4: "#00933C",
  5: "#00933C",
  6: "#00933C",
  "6X": "#00933C",
  7: "#B933AD",
  "7X": "#B933AD",
  L: "#A7A9AC",
  G: "#6CBE45",
  J: "#996633",
  Z: "#996633",
  S: "#808183",
  SI: "#0039A6",
};

const DARK_TEXT_LINES = new Set(["N", "Q", "R", "W", "L", "G"]);

function lineColor(route) {
  return LINE_COLORS[route] || "#808183";
}
function lineTextColor(route) {
  return DARK_TEXT_LINES.has(route) ? "#000000" : "#FFFFFF";
}

// ===================================================
// HELPERS
// ===================================================

function minutesUntil(isoString) {
  return Math.round((new Date(isoString) - new Date()) / 60000);
}

function formatTime(mins) {
  if (mins <= 0) return "~";
  return String(mins);
}

function urgencyColor(mins) {
  if (mins <= 2) return new Color("#EE352E");
  if (mins <= 5) return new Color("#FF6319");
  return new Color("#E0E0E0");
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(miles) {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(2)} mi`;
}

function trainsByDirection(station) {
  const result = { N: [], S: [] };
  for (const dir of ["N", "S"]) {
    for (const entry of station[dir] || []) {
      const mins = minutesUntil(entry.time);
      if (mins >= 0 && mins <= MAX_MINUTES) {
        result[dir].push({ route: entry.route, mins });
      }
    }
    result[dir].sort((a, b) => a.mins - b.mins);
    result[dir] = result[dir].slice(0, MAX_TRAINS);
  }
  return result;
}

// ===================================================
// LOCATION  (cached)
// ===================================================

async function getLocation() {
  // 1. Try fresh GPS — lowest accuracy class that still works for subway stops
  try {
    Location.setAccuracyToKilometer();
    const loc = await Location.current();
    writeCache("location", { lat: loc.latitude, lon: loc.longitude });
    return { lat: loc.latitude, lon: loc.longitude };
  } catch {}

  // 2. Fall back to cached location if GPS failed
  const cached = readCache("location", LOC_CACHE_SECS);
  if (cached) return cached;

  return null;
}

// ===================================================
// FETCH  (cached)
// ===================================================

async function fetchStations(lat, lon) {
  // 1. Try fresh network request
  try {
    const req = new Request(`${MTAPI_BASE}/by-location?lat=${lat}&lon=${lon}`);
    req.timeoutInterval = 8;
    const data = await req.loadJSON();
    const stations = (data.data || []).slice(0, MAX_STATIONS);
    if (stations.length > 0) {
      writeCache("stations", stations);
      return stations;
    }
  } catch {}

  // 2. Fall back to cached station data if network failed
  const cached = readCache("stations", DATA_CACHE_SECS);
  if (cached) return cached;

  return [];
}

// ===================================================
// DRAWING PRIMITIVES
// ===================================================

function drawTrainPill(parent, route, mins) {
  const pill = parent.addStack();
  pill.layoutHorizontally();
  pill.centerAlignContent();
  pill.spacing = 5;
  pill.setPadding(0, 0, 0, 4);

  // Route badge — border only, colored border + text, no fill
  const badge = pill.addStack();
  badge.cornerRadius = 4;
  badge.setPadding(2, 5, 2, 5);
  badge.centerAlignContent();
  badge.borderColor = new Color(lineColor(route));
  badge.borderWidth = 2;
  const routeLbl = badge.addText(route);
  routeLbl.font = SYS_BOLD(12);
  routeLbl.textColor = new Color(lineColor(route));
  routeLbl.lineLimit = 1;

  // Arrival time
  const timeLbl = pill.addText(formatTime(mins));
  timeLbl.font = SYS_BOLD(12);
  timeLbl.textColor = urgencyColor(mins);
  timeLbl.lineLimit = 1;
}

function drawDirectionRow(parent, label, trains) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 6;

  const dirLbl = row.addText(label);
  dirLbl.font = SYS_BOLD(12);
  dirLbl.textColor = new Color("#666666");
  dirLbl.lineLimit = 1;

  if (trains.length === 0) {
    const none = row.addText("no service");
    none.font = SYS_REG(11);
    none.textColor = new Color("#555555");
  } else {
    for (const t of trains) {
      drawTrainPill(row, t.route, t.mins);
    }
  }

  row.addSpacer();
}

function drawStationBlock(col, station, userLat, userLon) {
  const [sLat, sLon] = station.location;
  const dist = distanceMiles(userLat, userLon, sLat, sLon);
  const trains = trainsByDirection(station);

  const nameRow = col.addStack();
  nameRow.layoutHorizontally();
  nameRow.centerAlignContent();
  nameRow.spacing = 5;

  const name = nameRow.addText(station.name.toUpperCase());
  name.font = SYS_BOLD(12);
  name.textColor = new Color("#FFFFFF");
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.6;

  nameRow.addSpacer();

  const distLbl = nameRow.addText(formatDistance(dist));
  distLbl.font = SYS_REG(10);
  distLbl.textColor = new Color("#888888");
  distLbl.lineLimit = 1;

  col.addSpacer(4);

  drawDirectionRow(col, "↑", trains.N);
  col.addSpacer(3);
  drawDirectionRow(col, "↓", trains.S);
}

// ===================================================
// ERROR STATE
// ===================================================

function showError(widget, msg, sub = null) {
  widget.addSpacer();
  const t = widget.addText(msg);
  t.font = SYS_BOLD(11);
  t.textColor = Color.dynamic(new Color("#CC0000"), new Color("#EE352E"));
  t.centerAlignText();
  if (sub) {
    widget.addSpacer(4);
    const s = widget.addText(sub);
    s.font = SYS_REG(9);
    s.textColor = Color.dynamic(new Color("#444444"), new Color("#666666"));
    s.centerAlignText();
  }
  widget.addSpacer();
}

// ===================================================
// MAIN
// ===================================================

async function run() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#000000");
  widget.setPadding(0, 16, 0, 16);

  // Ask iOS to refresh on schedule
  const nextRefresh = new Date();
  nextRefresh.setSeconds(nextRefresh.getSeconds() + REFRESH_SECS);
  widget.refreshAfterDate = nextRefresh;

  // Tapping the widget re-runs the script immediately
  widget.url = `scriptable:///run/${encodeURIComponent(Script.name())}`;

  // ── HEADER ──────────────────────────────────────────────────────────────
  const header = widget.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();
  header.spacing = 7;
  header.setPadding(2, 0, 2, 0);

  const mtaBadge = header.addStack();
  // No fill — border only with the MTA blue as the text/border color
  mtaBadge.cornerRadius = 4;
  mtaBadge.setPadding(4, 7, 4, 7);
  mtaBadge.centerAlignContent();
  mtaBadge.borderColor = new Color("#0039A6");
  mtaBadge.borderWidth = 2;
  const mtaLbl = mtaBadge.addText("MTA");
  mtaLbl.font = SYS_BOLD(16);
  mtaLbl.textColor = new Color("#0039A6");

  // Placeholder — overwritten after data resolves
  const stationNameText = header.addText("Loading…");
  stationNameText.font = FONT_BOLD(28);
  stationNameText.textColor = new Color("#FFFFFF");
  stationNameText.lineLimit = 1;
  stationNameText.minimumScaleFactor = 0.5;

  header.addSpacer();

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeLbl = header.addText(timeStr);
  timeLbl.font = FONT_BOLD(20);
  timeLbl.textColor = new Color("#888888");

  // ── Divider ─────────────────────────────────────────────────────────────
  widget.addSpacer(2);
  const rule = widget.addStack();
  rule.backgroundColor = new Color("#333333");
  rule.size = new Size(0, 1);
  widget.addSpacer(3);

  // ── Data — location + fetch fired in parallel ────────────────────────────
  // getLocation() reads cache first so it often returns instantly.
  // If location cache is warm, fetchStations from the last known coords
  // can also be pre-seeded from the data cache — both resolve in one tick.
  const locCache = readCache("location", LOC_CACHE_SECS);
  const stationCache = readCache("stations", DATA_CACHE_SECS);

  let lat, lon, stations;

  if (locCache && stationCache) {
    // Both caches warm — no async work at all, render immediately
    ({ lat, lon } = locCache);
    stations = stationCache;
  } else {
    // Fire location lookup; if location cache exists use it for the fetch
    // immediately while fresh GPS resolves in background
    const locPromise = getLocation();

    // If we have a stale-but-present location, kick off the fetch in parallel
    const prefetchLat = locCache ? locCache.lat : null;
    const prefetchLon = locCache ? locCache.lon : null;
    const fetchPromise = prefetchLat
      ? fetchStations(prefetchLat, prefetchLon)
      : locPromise.then((l) => (l ? fetchStations(l.lat, l.lon) : []));

    // Await both
    const [locResult, fetchResult] = await Promise.all([
      locPromise,
      fetchPromise,
    ]);

    if (!locResult) {
      showError(
        widget,
        "⚠️ Location unavailable",
        "Enable location for Scriptable",
      );
      Script.setWidget(widget);
      if (!config.runsInWidget) await widget.presentMedium();
      Script.complete();
      return;
    }

    lat = locResult.lat;
    lon = locResult.lon;
    stations = fetchResult;

    // If parallel fetch used stale coords, re-fetch with fresh coords if they differ
    if (
      prefetchLat !== null &&
      (Math.abs(prefetchLat - lat) > 0.005 ||
        Math.abs(prefetchLon - lon) > 0.005)
    ) {
      stations = await fetchStations(lat, lon);
    }
  }

  if (!stations || stations.length === 0) {
    showError(widget, "⚠️ Could not load MTA data", "Check connection");
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentMedium();
    Script.complete();
    return;
  }

  // ── Populate header station name ─────────────────────────────────────────
  stationNameText.text = stations[0].name.toUpperCase();

  // ── Two-column body ───────────────────────────────────────────────────────
  const body = widget.addStack();
  body.layoutHorizontally();
  body.spacing = 0;
  body.setPadding(0, 0, 0, 0);

  const leftCol = body.addStack();
  leftCol.layoutVertically();
  drawStationBlock(leftCol, stations[0], lat, lon);

  body.addSpacer(10);
  const divider = body.addStack();
  divider.backgroundColor = new Color("#333333");
  divider.size = new Size(1, 0);
  body.addSpacer(10);

  const rightCol = body.addStack();
  rightCol.layoutVertically();

  if (stations.length >= 2) {
    drawStationBlock(rightCol, stations[1], lat, lon);
  } else {
    const ph = rightCol.addText("No second station");
    ph.font = SYS_REG(9);
    ph.textColor = Color.dynamic(new Color("#555555"), new Color("#444444"));
    rightCol.addSpacer();
  }

  // ── Footer — last updated time ────────────────────────────────────────────
  widget.addSpacer(3);
  const footerRow = widget.addStack();
  footerRow.layoutHorizontally();
  footerRow.centerAlignContent();
  footerRow.setPadding(0, 0, 2, 0);
  footerRow.addSpacer();

  const updatedLbl = footerRow.addText("↺ " + timeStr);
  updatedLbl.font = SYS_REG(9);
  updatedLbl.textColor = new Color("#444444");

  // ── Present ───────────────────────────────────────────────────────────────
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }

  Script.complete();
}

await run();
