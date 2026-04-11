// MTA Nearby Stops Widget
// for use in Scriptable on iOS
// Uses the MTAPI proxy (wheresthefuckingtrain.com) for location-based JSON
// API docs: https://github.com/jonthornton/MTAPI/blob/master/docs/endpoints.md
// Layout: small-medium landscape widget — ultra-compact 3-row design

// ===================================================
// CONFIGURATION
// ===================================================

const MTAPI_BASE = "https://www.wheresthefuckingtrain.com";
const MAX_TRAINS = 3; // arrivals per direction per station
const MAX_STATIONS = 2; // must be 2 for side-by-side columns
const MAX_MINUTES = 30; // ignore trains beyond this many minutes out

// ===================================================
// MTA OFFICIAL LINE COLORS
// Source: https://web.mta.info/developers/resources/line_colors.htm
// ===================================================

const LINE_COLORS = {
  // IRT Broadway / 7th Ave
  1: "#EE352E",
  2: "#EE352E",
  3: "#EE352E",
  // IND 8th Ave
  A: "#0039A6",
  C: "#0039A6",
  E: "#0039A6",
  // IND 6th Ave
  B: "#FF6319",
  D: "#FF6319",
  F: "#FF6319",
  M: "#FF6319",
  // BMT Broadway
  N: "#FCCC0A",
  Q: "#FCCC0A",
  R: "#FCCC0A",
  W: "#FCCC0A",
  // IRT Lexington Ave
  4: "#00933C",
  5: "#00933C",
  6: "#00933C",
  "6X": "#00933C",
  // IRT Flushing
  7: "#B933AD",
  "7X": "#B933AD",
  // BMT Canarsie
  L: "#A7A9AC",
  // IND Crosstown
  G: "#6CBE45",
  // BMT Jamaica / Nassau
  J: "#996633",
  Z: "#996633",
  // Shuttles
  S: "#808183",
  // SIR
  SI: "#0039A6",
};

// Lines whose badge background is light enough to need black text
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

// Single-digit or "~" for imminent, no "min" label — keeps pills compact
function formatTime(mins) {
  if (mins <= 0) return "~";
  if (mins >= 10) return String(mins); // two digits still fine
  return String(mins);
}

function urgencyColor(mins) {
  if (mins <= 2) return new Color("#EE352E");
  if (mins <= 5) return new Color("#FF6319");
  return new Color("#E0E0E0");
}

// Haversine distance
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

// Returns { N: [...], S: [...] } each sorted by arrival time
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
// DRAWING PRIMITIVES
// ===================================================

// Circular-ish line bullet: colored background, bold route letter, time right of it
function drawTrainPill(parent, route, mins) {
  const pill = parent.addStack();
  pill.layoutHorizontally();
  pill.centerAlignContent();
  pill.spacing = 3;
  pill.setPadding(2, 4, 2, 6);
  pill.backgroundColor = new Color("#1E1E1E");
  pill.cornerRadius = 5;

  // Colored route badge
  const badge = pill.addStack();
  badge.backgroundColor = new Color(lineColor(route));
  badge.cornerRadius = 3;
  badge.setPadding(1, 4, 1, 4);
  badge.centerAlignContent();
  const routeLbl = badge.addText(route);
  routeLbl.font = Font.boldSystemFont(10);
  routeLbl.textColor = new Color(lineTextColor(route));
  routeLbl.lineLimit = 1;

  // Arrival time
  const timeLbl = pill.addText(formatTime(mins));
  timeLbl.font = Font.monospacedDigitSystemFont(10);
  timeLbl.textColor = urgencyColor(mins);
  timeLbl.lineLimit = 1;
}

// One direction row: arrow label + train pills
function drawDirectionRow(parent, label, trains) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 5;

  // Direction label  ↑ / ↓
  const dirLbl = row.addText(label);
  dirLbl.font = Font.boldSystemFont(10);
  dirLbl.textColor = new Color("#555555");
  dirLbl.lineLimit = 1;

  if (trains.length === 0) {
    const none = row.addText("no service");
    none.font = Font.italicSystemFont(9);
    none.textColor = new Color("#444444");
  } else {
    for (const t of trains) {
      drawTrainPill(row, t.route, t.mins);
    }
  }

  row.addSpacer();
}

// ===================================================
// STATION BLOCK
// Fills one half (left or right column) of the widget body
// ===================================================

function drawStationBlock(col, station, userLat, userLon) {
  const [sLat, sLon] = station.location;
  const dist = distanceMiles(userLat, userLon, sLat, sLon);
  const trains = trainsByDirection(station);

  // ── Station name + distance ──────────────────────
  const nameRow = col.addStack();
  nameRow.layoutHorizontally();
  nameRow.centerAlignContent();
  nameRow.spacing = 5;

  const name = nameRow.addText(station.name.toUpperCase());
  name.font = Font.boldSystemFont(9);
  name.textColor = new Color("#FFFFFF");
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.6;

  nameRow.addSpacer();

  const dist_lbl = nameRow.addText(formatDistance(dist));
  dist_lbl.font = Font.systemFont(8);
  dist_lbl.textColor = new Color("#555555");
  dist_lbl.lineLimit = 1;

  col.addSpacer(5);

  // ── Uptown row ────────────────────────────────────
  drawDirectionRow(col, "↑", trains.N);

  col.addSpacer(4);

  // ── Downtown row ──────────────────────────────────
  drawDirectionRow(col, "↓", trains.S);
}

// ===================================================
// ERROR STATE
// ===================================================

function showError(widget, msg, sub = null) {
  widget.addSpacer();
  const t = widget.addText(msg);
  t.font = Font.boldSystemFont(11);
  t.textColor = new Color("#EE352E");
  t.centerAlignText();
  if (sub) {
    widget.addSpacer(4);
    const s = widget.addText(sub);
    s.font = Font.systemFont(9);
    s.textColor = new Color("#666666");
    s.centerAlignText();
  }
  widget.addSpacer();
}

// ===================================================
// MAIN
// ===================================================

async function run() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#111111");
  widget.setPadding(10, 12, 10, 12);

  // ── HEADER ROW ────────────────────────────────────
  // [MTA]  Closest station name          ↺ updated time
  const header = widget.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();
  header.spacing = 6;

  // MTA badge
  const mtaBadge = header.addStack();
  mtaBadge.backgroundColor = new Color("#0039A6");
  mtaBadge.cornerRadius = 4;
  mtaBadge.setPadding(2, 5, 2, 5);
  mtaBadge.centerAlignContent();
  const mtaLbl = mtaBadge.addText("MTA");
  mtaLbl.font = Font.boldSystemFont(8);
  mtaLbl.textColor = new Color("#FFFFFF");

  // Station name placeholder — filled in after fetch
  const stationNameText = header.addText("Loading…");
  stationNameText.font = Font.boldSystemFont(11);
  stationNameText.textColor = new Color("#FFFFFF");
  stationNameText.lineLimit = 1;
  stationNameText.minimumScaleFactor = 0.6;

  header.addSpacer();

  // Refresh symbol + last-updated time
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const refreshStack = header.addStack();
  refreshStack.layoutHorizontally();
  refreshStack.centerAlignContent();
  refreshStack.spacing = 3;

  const refreshIcon = refreshStack.addText("↺");
  refreshIcon.font = Font.boldSystemFont(11);
  refreshIcon.textColor = new Color("#444444");

  const timeLbl = refreshStack.addText(timeStr);
  timeLbl.font = Font.monospacedDigitSystemFont(9);
  timeLbl.textColor = new Color("#444444");

  // ── Divider below header ──────────────────────────
  widget.addSpacer(6);
  const rule = widget.addStack();
  rule.backgroundColor = new Color("#222222");
  rule.size = new Size(0, 1);
  widget.addSpacer(7);

  // ── Location ──────────────────────────────────────
  let lat, lon;
  try {
    Location.setAccuracyToHundredMeters();
    const loc = await Location.current();
    lat = loc.latitude;
    lon = loc.longitude;
  } catch (e) {
    showError(
      widget,
      "⚠️ Location unavailable",
      "Enable location for Scriptable",
    );
    Script.setWidget(widget);
    await widget.presentMedium();
    Script.complete();
    return;
  }

  // ── Fetch ─────────────────────────────────────────
  let stations = [];
  try {
    const req = new Request(`${MTAPI_BASE}/by-location?lat=${lat}&lon=${lon}`);
    req.timeoutInterval = 10;
    const data = await req.loadJSON();
    stations = (data.data || []).slice(0, MAX_STATIONS);
  } catch (e) {
    showError(widget, "⚠️ Could not load MTA data", "Check connection");
    Script.setWidget(widget);
    await widget.presentMedium();
    Script.complete();
    return;
  }

  if (stations.length === 0) {
    showError(widget, "No stations found nearby");
    Script.setWidget(widget);
    await widget.presentMedium();
    Script.complete();
    return;
  }

  // Update header station name to closest station
  stationNameText.text = stations[0].name.toUpperCase();

  // ── Two-column body ───────────────────────────────
  const body = widget.addStack();
  body.layoutHorizontally();
  body.spacing = 0;

  // Left column — closest station
  const leftCol = body.addStack();
  leftCol.layoutVertically();
  drawStationBlock(leftCol, stations[0], lat, lon);

  // Vertical divider
  body.addSpacer(10);
  const divider = body.addStack();
  divider.backgroundColor = new Color("#222222");
  divider.size = new Size(1, 0);
  body.addSpacer(10);

  // Right column — second closest station (or fallback)
  const rightCol = body.addStack();
  rightCol.layoutVertically();

  if (stations.length >= 2) {
    drawStationBlock(rightCol, stations[1], lat, lon);
  } else {
    const ph = rightCol.addText("No second station");
    ph.font = Font.italicSystemFont(9);
    ph.textColor = new Color("#444444");
  }

  // ── Present ───────────────────────────────────────
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }

  Script.complete();
}

await run();
