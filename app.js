const DEFAULT_MONTHS = ["This Month", "Next Month", "2 Months Later", "3 Months Later", "4 Months Later"];
const TIERS = [
  { id: "human", label: "Human Rights", color: "#ff4b59" },
  { id: "must", label: "Must Pull", color: "#ffa12a" },
  { id: "ideal", label: "Ideally Pull", color: "#47a9ff" },
  { id: "luxury", label: "Luxury Pull", color: "#a66bff" },
  { id: "skip", label: "Skip", color: "#9aa0ab" }
];
const DEFAULT_META_STATUSES = [
  { id: "s1", label: "Human Rights", color: "#ff4b59" },
  { id: "s2", label: "Era-Defining", color: "#37e6ff" },
  { id: "s3", label: "Strong", color: "#67ef87" },
  { id: "s4", label: "Rotational", color: "#ffcc4d" },
  { id: "s5", label: "Situational", color: "#c18cff" }
];
const OLD_STATUS_MAP = { top: "s1", strong: "s3", niche: "s5", fading: "s4", custom: "s5" };
const TAG_OPTIONS = ["PVP", "PVE", "Core", "Tech", "Def"];
const TAG_ORDER = new Map(TAG_OPTIONS.map((tag, i) => [tag.toLowerCase(), i]));
const CELL_W = 200;
const LEFT_W = 260;
const MONTH_H = 58;
const WEEK_H = 48;
const HEADER_H = MONTH_H + WEEK_H;
const BLANK_TIER_H = 250;
const ICON_W = 176;
const ICON_TOP = 28;
const BAR_TOP = 222;
const BAR_GAP = 23;
const BAR_H = 18;
const BAR_BOTTOM_PAD = 34;
const STORAGE_KEY = "gundam-u-c-e-roadmap-builder-v1";
const ZOOM_STORAGE_KEY = "gundam-u-c-e-roadmap-builder-zoom-v2";

const DEFAULT_ROADMAP = {
  updated: new Date().toISOString(),
  months: [...DEFAULT_MONTHS],
  metaStatuses: structuredClone(DEFAULT_META_STATUSES),
  units: []
};

let state = structuredClone(DEFAULT_ROADMAP);
let catalog = [];
let selectedId = null;
let selectedSegmentId = null;
let filterKind = "all";
let searchTerm = "";
let tooltipEl = null;
let drag = null;
let suppressRoadmapClick = false;
let zoomScale = Number(localStorage.getItem(ZOOM_STORAGE_KEY) || "1") || 1;

const els = {
  roadmap: document.getElementById("roadmap"),
  roadmapStage: document.getElementById("roadmapStage"),
  chartScroll: document.getElementById("chartScroll"),
  catalogList: document.getElementById("catalogList"),
  catalogStatus: document.getElementById("catalogStatus"),
  saveStatus: document.getElementById("saveStatus"),
  editForm: document.getElementById("editForm"),
  noSelection: document.getElementById("noSelection"),
  catalogSearch: document.getElementById("catalogSearch"),
  importJson: document.getElementById("importJson"),
  zoomRange: document.getElementById("zoomRange"),
  zoomLabel: document.getElementById("zoomLabel"),
  tagDropdown: document.getElementById("tagDropdown"),
  tagPreview: document.getElementById("tagPreview"),
  legend: document.getElementById("legend"),
  statusDialog: document.getElementById("statusDialog"),
  statusForm: document.getElementById("statusForm")
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function weekCount() { return Math.max(1, (state.months || DEFAULT_MONTHS).length * 4); }
function tierIndex(id) { return Math.max(0, TIERS.findIndex(t => t.id === id)); }
function getStatuses() { return state.metaStatuses?.length ? state.metaStatuses : DEFAULT_META_STATUSES; }
function metaStatus(id) { return getStatuses().find(s => s.id === id) || getStatuses()[2] || DEFAULT_META_STATUSES[2]; }
function weekX(week) { return LEFT_W + (week - 1) * CELL_W; }
function visibleLaneCount(tierId) {
  let maxLane = 0;
  for (const unit of state.units || []) {
    if (unit.tier === tierId) maxLane = Math.max(maxLane, Number(unit.lane) || 0);
  }
  return maxLane;
}
function tierHeight(tierId) {
  const lanes = visibleLaneCount(tierId);
  if (!lanes) return BLANK_TIER_H;
  return Math.max(BLANK_TIER_H, BAR_TOP + lanes * BAR_GAP + BAR_BOTTOM_PAD);
}
function tierY(tierId) {
  let y = HEADER_H;
  for (const tier of TIERS) {
    if (tier.id === tierId) return y;
    y += tierHeight(tier.id);
  }
  return y;
}
function laneY(unitOrTier, laneMaybe) {
  const tier = typeof unitOrTier === "string" ? unitOrTier : unitOrTier.tier;
  const lane = typeof unitOrTier === "string" ? laneMaybe : unitOrTier.lane;
  return tierY(tier) + BAR_TOP + (lane - 1) * BAR_GAP;
}
function laneCenterY(tier, lane) { return laneY(tier, lane) + BAR_H / 2; }
function iconY(unit) { return tierY(unit.tier) + ICON_TOP; }
function iconX(unit) { return weekX(unit.week) + Math.round((CELL_W - ICON_W) / 2); }
function normalizeWeek(n) { return clamp(Math.round(Number(n) || 1), 1, weekCount()); }
function normalizeLane(n) { return clamp(Math.round(Number(n) || 1), 1, 99); }
function idOfWeekFromX(x) { return normalizeWeek(Math.round((x - LEFT_W - CELL_W / 2) / CELL_W) + 1); }
function idOfTierFromY(y) {
  let top = HEADER_H;
  for (const tier of TIERS) {
    const bottom = top + tierHeight(tier.id);
    if (y < bottom) return tier.id;
    top = bottom;
  }
  return TIERS[TIERS.length - 1].id;
}
function laneFromY(y, tier) {
  const firstCenter = laneCenterY(tier, 1);
  return normalizeLane(Math.round((y - firstCenter) / BAR_GAP) + 1);
}
function chartPoint(event) {
  const rect = els.roadmap.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / zoomScale, y: (event.clientY - rect.top) / zoomScale };
}
function baseChartWidth() { return LEFT_W + weekCount() * CELL_W; }
function baseChartHeight() { return HEADER_H + TIERS.reduce((sum, t) => sum + tierHeight(t.id), 0); }
function setStatus(message) { els.saveStatus.textContent = message; }
function sanitizeText(text) { return String(text || "").replace(/\s+/g, " ").trim(); }
function cleanTags(tags) {
  const byKey = new Map();
  (tags || []).forEach(tag => {
    const clean = sanitizeText(tag);
    if (!clean) return;
    const canonical = TAG_OPTIONS.find(t => t.toLowerCase() === clean.toLowerCase()) || clean;
    byKey.set(canonical.toLowerCase(), canonical);
  });
  return [...byKey.values()].sort((a, b) => {
    const ai = TAG_ORDER.has(a.toLowerCase()) ? TAG_ORDER.get(a.toLowerCase()) : 100 + a.toLowerCase().charCodeAt(0);
    const bi = TAG_ORDER.has(b.toLowerCase()) ? TAG_ORDER.get(b.toLowerCase()) : 100 + b.toLowerCase().charCodeAt(0);
    return ai === bi ? a.localeCompare(b) : ai - bi;
  }).slice(0, 8);
}
function statusColor(id) { return metaStatus(id).color; }
function segmentColor(segment) { return statusColor(segment.statusId); }
function defaultMetaStatusId() { return getStatuses()[2]?.id || DEFAULT_META_STATUSES[2].id; }
function firstSegment(unit) { return unit?.segments?.[0] || null; }
function selectedSegment(unit = getSelected()) {
  if (!unit) return null;
  return unit.segments.find(s => s.id === selectedSegmentId) || unit.segments[0] || null;
}

function init() {
  const loadedFromHash = loadFromShareHash();
  if (!loadedFromHash) loadLocal();
  buildTierSelect();
  bindUI();
  renderAll();
  setZoom(zoomScale, false);
  maybeLoadPublishedRoadmap();
}

function normalizeState() {
  if (!Array.isArray(state.months) || !state.months.length) state.months = [...DEFAULT_MONTHS];
  state.months = state.months.map(m => sanitizeText(m) || "Month").slice(0, 12);
  if (!state.months.length) state.months = [...DEFAULT_MONTHS];

  if (!Array.isArray(state.metaStatuses) || !state.metaStatuses.length) state.metaStatuses = structuredClone(DEFAULT_META_STATUSES);
  state.metaStatuses = state.metaStatuses.slice(0, 8).map((s, i) => ({
    id: sanitizeText(s.id) || `s${i + 1}`,
    label: sanitizeText(s.label) || DEFAULT_META_STATUSES[i]?.label || `Status ${i + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(s.color || "") ? s.color : DEFAULT_META_STATUSES[i]?.color || "#8aa0ff"
  }));
  const statusIds = new Set(state.metaStatuses.map(s => s.id));
  const fallbackStatus = defaultMetaStatusId();

  state.units = (state.units || []).map((u) => {
    const oldStatus = OLD_STATUS_MAP[u.metaStatus] || u.metaStatus;
    const metaStart = normalizeWeek(u.metaStart || u.week || 1);
    const metaEnd = normalizeWeek(u.metaEnd || u.metaStart || u.week || 1);
    let segments = Array.isArray(u.segments) ? u.segments : [];
    if (!segments.length) {
      segments = [{ id: crypto.randomUUID(), start: Math.min(metaStart, metaEnd), end: Math.max(metaStart, metaEnd), statusId: statusIds.has(oldStatus) ? oldStatus : fallbackStatus }];
    }
    segments = segments.map(seg => {
      const start = normalizeWeek(seg.start || seg.metaStart || metaStart || 1);
      const end = normalizeWeek(seg.end || seg.metaEnd || metaEnd || start);
      const mapped = OLD_STATUS_MAP[seg.statusId] || OLD_STATUS_MAP[seg.metaStatus] || seg.statusId || oldStatus;
      return {
        id: seg.id || crypto.randomUUID(),
        start: Math.min(start, end),
        end: Math.max(start, end),
        statusId: statusIds.has(mapped) ? mapped : fallbackStatus
      };
    }).sort((a, b) => a.start - b.start || a.end - b.end);
    const tier = TIERS.some(t => t.id === u.tier) ? u.tier : "must";
    const rawTags = Array.isArray(u.tags) ? u.tags : (Array.isArray(u.badges) ? u.badges : []);
    return {
      id: u.id || crypto.randomUUID(),
      name: sanitizeText(u.name || "Unnamed Unit"),
      kind: u.kind || "custom",
      tier,
      week: normalizeWeek(u.week || 1),
      lane: normalizeLane(u.lane || 1),
      icon: u.icon || "",
      tags: cleanTags(rawTags),
      note: u.note || "",
      segments
    };
  });

  for (const unit of state.units) {
    unit.week = normalizeWeek(unit.week);
    unit.segments.forEach(seg => {
      seg.start = normalizeWeek(seg.start);
      seg.end = normalizeWeek(seg.end);
      if (seg.end < seg.start) [seg.start, seg.end] = [seg.end, seg.start];
    });
  }
}

function renderAll() {
  normalizeState();
  buildStaticGrid();
  renderLegend();
  buildMetaStatusSelect();
  renderUnits();
  renderForm();
  applyZoom();
}

function buildStaticGrid() {
  els.roadmap.innerHTML = "";
  els.roadmap.style.setProperty("--weeks", weekCount());
  els.roadmap.style.width = `${baseChartWidth()}px`;
  els.roadmap.style.height = `${baseChartHeight()}px`;

  const corner = document.createElement("div");
  corner.className = "month-head corner";
  corner.style.left = "0px";
  corner.style.width = `${LEFT_W}px`;
  els.roadmap.appendChild(corner);

  state.months.forEach((month, i) => {
    const head = document.createElement("button");
    head.type = "button";
    head.className = "month-head month-button";
    head.style.left = `${LEFT_W + i * 4 * CELL_W}px`;
    head.style.width = `${4 * CELL_W}px`;
    head.textContent = month;
    head.title = "Click to rename this month";
    head.addEventListener("click", (event) => {
      event.stopPropagation();
      renameMonth(i);
    });
    els.roadmap.appendChild(head);
  });

  for (let w = 1; w <= weekCount(); w++) {
    const week = document.createElement("div");
    week.className = "week-head";
    week.style.left = `${weekX(w)}px`;
    week.textContent = `W${((w - 1) % 4) + 1}`;
    els.roadmap.appendChild(week);
  }

  TIERS.forEach((tier) => {
    const label = document.createElement("div");
    label.className = `tier-label ${tier.id}`;
    label.style.top = `${tierY(tier.id)}px`;
    label.style.height = `${tierHeight(tier.id)}px`;
    label.textContent = tier.label;
    els.roadmap.appendChild(label);
  });

  for (let w = 0; w <= weekCount(); w++) {
    const line = document.createElement("div");
    line.className = `grid-line v${w % 4 === 0 ? " month" : ""}`;
    line.style.left = `${LEFT_W + w * CELL_W}px`;
    line.style.height = w % 4 === 0 ? "100%" : `${baseChartHeight() - HEADER_H}px`;
    els.roadmap.appendChild(line);
  }

  TIERS.forEach((tier) => {
    const line = document.createElement("div");
    line.className = "grid-line h";
    line.style.top = `${tierY(tier.id)}px`;
    els.roadmap.appendChild(line);
  });
  const bottom = document.createElement("div");
  bottom.className = "grid-line h";
  bottom.style.top = `${baseChartHeight()}px`;
  els.roadmap.appendChild(bottom);

  TIERS.forEach((tier) => {
    const count = visibleLaneCount(tier.id);
    for (let lane = 1; lane <= count; lane++) {
      const track = document.createElement("div");
      track.className = "lane-track";
      track.style.top = `${laneY(tier.id, lane)}px`;
      els.roadmap.appendChild(track);
    }
  });
}

function buildTierSelect() {
  const select = els.editForm.elements.tier;
  select.innerHTML = TIERS.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join("");
}

function buildMetaStatusSelect() {
  const selectedValue = els.editForm.elements.metaStatus?.value;
  const select = els.editForm.elements.metaStatus;
  select.innerHTML = getStatuses().map(s => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join("");
  if (selectedValue && getStatuses().some(s => s.id === selectedValue)) select.value = selectedValue;
}

function bindUI() {
  document.getElementById("btnAddBlank").addEventListener("click", () => addUnit({ name: "New Unit", kind: "custom" }));
  document.getElementById("btnExportJson").addEventListener("click", exportJson);
  document.getElementById("btnCopyShareLink").addEventListener("click", copyShareLink);
  document.getElementById("btnSaveLocal").addEventListener("click", saveLocal);
  document.getElementById("btnClearLocal").addEventListener("click", clearLocal);
  document.getElementById("btnExportPng").addEventListener("click", exportPng);
  document.getElementById("btnLoadCatalog").addEventListener("click", loadCatalog);
  document.getElementById("btnDelete").addEventListener("click", deleteSelected);
  document.getElementById("btnAddMonth").addEventListener("click", addMonth);
  document.getElementById("btnRemoveMonth").addEventListener("click", removeMonth);
  document.getElementById("btnAddSegment").addEventListener("click", addSegmentToSelected);
  document.getElementById("btnDeleteSegment").addEventListener("click", deleteSelectedSegment);
  document.getElementById("btnZoomOut").addEventListener("click", () => setZoom(zoomScale - 0.1));
  document.getElementById("btnZoomIn").addEventListener("click", () => setZoom(zoomScale + 0.1));
  document.getElementById("btnZoomReset").addEventListener("click", () => setZoom(1));
  els.zoomRange.addEventListener("input", () => setZoom(Number(els.zoomRange.value) / 100));
  document.getElementById("btnAddTag").addEventListener("click", addTagFromDropdown);
  document.getElementById("btnClearTags").addEventListener("click", clearTagsForSelected);
  document.getElementById("btnCancelStatusEdit").addEventListener("click", () => els.statusDialog.close());
  els.statusForm.addEventListener("submit", saveStatusEdit);
  els.editForm.elements.tags.addEventListener("input", renderTagPreview);
  els.editForm.elements.segment.addEventListener("change", () => {
    selectedSegmentId = els.editForm.elements.segment.value;
    renderForm();
    refreshSelectionUi();
  });

  els.roadmap.addEventListener("click", (event) => {
    if (suppressRoadmapClick) {
      suppressRoadmapClick = false;
      return;
    }
    if (!event.target.closest(".unit-card,.meta-bar,.month-head")) select(null);
  });

  els.catalogSearch.addEventListener("input", (e) => {
    searchTerm = e.target.value.toLowerCase().trim();
    renderCatalog();
  });

  document.querySelectorAll(".seg").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".seg").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterKind = btn.dataset.kind;
      renderCatalog();
    });
  });

  els.importJson.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      state = Array.isArray(json) ? { ...structuredClone(DEFAULT_ROADMAP), units: json } : { ...structuredClone(DEFAULT_ROADMAP), ...json };
      normalizeState();
      selectedId = null;
      selectedSegmentId = null;
      renderAll();
      autoSave();
      setStatus(`Imported ${state.units.length} unit(s).`);
    } catch (error) {
      alert(`Could not import JSON: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });

  els.editForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyForm();
  });

  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      const active = document.activeElement?.tagName;
      if (selectedId && active !== "INPUT" && active !== "TEXTAREA" && active !== "SELECT") deleteSelected();
    }
  });
}

function renderLegend() {
  els.legend.innerHTML = "";
  getStatuses().forEach(status => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "legend-item";
    btn.innerHTML = `<i class="dot" style="background:${status.color}"></i><span>${escapeHtml(status.label)}</span>`;
    btn.title = "Click to edit this meta status";
    btn.addEventListener("click", () => openStatusEditor(status.id));
    els.legend.appendChild(btn);
  });
}

function openStatusEditor(statusId) {
  const status = metaStatus(statusId);
  const f = els.statusForm.elements;
  f.statusId.value = status.id;
  f.label.value = status.label;
  f.color.value = status.color;
  els.statusDialog.showModal();
}

function saveStatusEdit(event) {
  event.preventDefault();
  const f = els.statusForm.elements;
  const status = state.metaStatuses.find(s => s.id === f.statusId.value);
  if (!status) return;
  status.label = sanitizeText(f.label.value) || status.label;
  status.color = /^#[0-9a-f]{6}$/i.test(f.color.value) ? f.color.value : status.color;
  state.updated = new Date().toISOString();
  els.statusDialog.close();
  renderAll();
  autoSave();
}

function renameMonth(index) {
  const current = state.months[index] || `Month ${index + 1}`;
  const value = prompt("Rename month label:", current);
  if (value === null) return;
  state.months[index] = sanitizeText(value) || current;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function addMonth() {
  const next = state.months.length + 1;
  const value = prompt("New month label:", `${next} Months Later`);
  if (value === null) return;
  state.months.push(sanitizeText(value) || `Month ${next}`);
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function removeMonth() {
  if (state.months.length <= 1) return alert("You need at least one month.");
  const removed = state.months[state.months.length - 1];
  if (!confirm(`Remove the last month: ${removed}? Any units/bars beyond the new end will be clamped.`)) return;
  state.months.pop();
  normalizeState();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function renderUnits() {
  state.units.forEach(unit => {
    const card = document.createElement("article");
    const isDraggingUnit = drag?.type === "unit" && drag.id === unit.id && Number.isFinite(drag.previewLeft);
    card.className = `unit-card${selectedId === unit.id && !selectedSegmentId ? " selected" : ""}${isDraggingUnit ? " dragging" : ""}`;
    card.dataset.id = unit.id;
    card.style.left = `${isDraggingUnit ? drag.previewLeft : iconX(unit)}px`;
    card.style.top = `${isDraggingUnit ? drag.previewTop : iconY(unit)}px`;
    card.title = unit.note || unit.name;

    if (unit.icon) {
      const img = document.createElement("img");
      img.src = unit.icon;
      img.alt = unit.name;
      img.crossOrigin = "anonymous";
      img.onerror = () => { img.replaceWith(placeholder(unit.name)); };
      card.appendChild(img);
    } else {
      card.appendChild(placeholder(unit.name));
    }

    const tags = document.createElement("div");
    tags.className = "tags";
    unit.tags.slice(0, 6).forEach(t => {
      const span = document.createElement("span");
      span.className = `tag ${tagClass(t)}`;
      span.textContent = t;
      tags.appendChild(span);
    });
    card.appendChild(tags);

    const plate = document.createElement("div");
    plate.className = "nameplate";
    plate.textContent = unit.name;
    card.appendChild(plate);

    card.addEventListener("pointerdown", (event) => beginDragUnit(event, unit.id));
    card.addEventListener("click", (event) => { event.stopPropagation(); select(unit.id, null); });
    card.addEventListener("mouseenter", (event) => showTooltip(event, unit));
    card.addEventListener("mouseleave", hideTooltip);
    card.addEventListener("pointermove", moveTooltip);
    els.roadmap.appendChild(card);

    unit.segments.forEach(segment => {
      const bar = document.createElement("div");
      const selected = selectedId === unit.id && selectedSegmentId === segment.id;
      bar.className = `meta-bar${selected ? " selected" : ""}`;
      bar.dataset.id = unit.id;
      bar.dataset.segmentId = segment.id;
      bar.style.left = `${weekX(segment.start) + 12}px`;
      bar.style.top = `${laneY(unit)}px`;
      bar.style.width = `${(segment.end - segment.start + 1) * CELL_W - 24}px`;
      bar.style.setProperty("--bar", segmentColor(segment));
      const left = document.createElement("span");
      left.className = "handle left";
      left.dataset.handle = "left";
      const right = document.createElement("span");
      right.className = "handle right";
      right.dataset.handle = "right";
      bar.append(left, right);
      bar.addEventListener("pointerdown", (event) => beginDragBar(event, unit.id, segment.id));
      bar.addEventListener("click", (event) => { event.stopPropagation(); select(unit.id, segment.id); });
      bar.addEventListener("mouseenter", (event) => showTooltip(event, unit, segment));
      bar.addEventListener("mouseleave", hideTooltip);
      bar.addEventListener("pointermove", moveTooltip);
      els.roadmap.appendChild(bar);
    });
  });
}

function tagClass(tag) {
  const t = String(tag || "").toLowerCase();
  if (t === "pvp") return "pvp";
  if (t === "pve") return "pve";
  if (t === "core") return "core";
  if (t === "tech") return "tech";
  if (t === "def") return "def";
  return "custom";
}
function placeholder(name) {
  const div = document.createElement("div");
  div.className = "placeholder";
  div.textContent = initials(name);
  return div;
}
function initials(name) {
  const parts = sanitizeText(name).split(/[\s・()\-_/]+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map(p => p[0]).join("").toUpperCase();
}

function select(id, segmentId = null) {
  selectedId = id;
  selectedSegmentId = segmentId;
  if (id && segmentId === undefined) selectedSegmentId = null;
  refreshSelectionUi();
  renderForm();
}
function refreshSelectionUi() {
  document.querySelectorAll(".unit-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.id === selectedId && !selectedSegmentId);
  });
  document.querySelectorAll(".meta-bar").forEach(bar => {
    bar.classList.toggle("selected", bar.dataset.id === selectedId && bar.dataset.segmentId === selectedSegmentId);
  });
}
function getSelected() { return state.units.find(u => u.id === selectedId); }

function renderForm() {
  const unit = getSelected();
  if (!unit) {
    els.noSelection.classList.remove("hidden");
    els.editForm.classList.add("hidden");
    return;
  }
  els.noSelection.classList.add("hidden");
  els.editForm.classList.remove("hidden");
  if (!selectedSegmentId || !unit.segments.some(s => s.id === selectedSegmentId)) selectedSegmentId = unit.segments[0]?.id || null;
  const segment = selectedSegment(unit);
  const f = els.editForm.elements;
  f.name.value = unit.name;
  f.icon.value = unit.icon;
  f.kind.value = unit.kind;
  f.tier.value = unit.tier;
  f.week.max = String(weekCount());
  f.week.value = unit.week;
  f.lane.value = unit.lane;
  f.segment.innerHTML = unit.segments.map((s, i) => `<option value="${s.id}">Segment ${i + 1}: W${s.start}–W${s.end} · ${escapeHtml(metaStatus(s.statusId).label)}</option>`).join("");
  if (segment) f.segment.value = segment.id;
  f.metaStart.max = String(weekCount());
  f.metaEnd.max = String(weekCount());
  f.metaStart.value = segment?.start || unit.week;
  f.metaEnd.value = segment?.end || unit.week;
  buildMetaStatusSelect();
  f.metaStatus.value = segment?.statusId || defaultMetaStatusId();
  f.tags.value = unit.tags.join(", ");
  f.note.value = unit.note;
  document.getElementById("btnDeleteSegment").disabled = unit.segments.length <= 1;
  renderTagPreview();
}

function applyForm() {
  const unit = getSelected();
  if (!unit) return;
  const f = els.editForm.elements;
  unit.name = sanitizeText(f.name.value) || "Unnamed Unit";
  unit.icon = f.icon.value.trim();
  unit.kind = f.kind.value;
  unit.tier = f.tier.value;
  unit.week = normalizeWeek(f.week.value);
  unit.lane = normalizeLane(f.lane.value);
  unit.tags = cleanTags(f.tags.value.split(","));
  unit.note = f.note.value.trim();
  const segment = selectedSegment(unit);
  if (segment) {
    segment.start = normalizeWeek(f.metaStart.value);
    segment.end = normalizeWeek(f.metaEnd.value);
    if (segment.end < segment.start) [segment.start, segment.end] = [segment.end, segment.start];
    segment.statusId = f.metaStatus.value;
  }
  unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function addSegmentToSelected() {
  const unit = getSelected();
  if (!unit) return;
  const maxEnd = Math.max(...unit.segments.map(s => s.end));
  const start = maxEnd < weekCount() ? maxEnd + 1 : normalizeWeek(unit.week);
  const end = Math.min(weekCount(), start + 3);
  const segment = { id: crypto.randomUUID(), start, end, statusId: defaultMetaStatusId() };
  unit.segments.push(segment);
  selectedSegmentId = segment.id;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function deleteSelectedSegment() {
  const unit = getSelected();
  if (!unit || unit.segments.length <= 1) return;
  unit.segments = unit.segments.filter(s => s.id !== selectedSegmentId);
  selectedSegmentId = unit.segments[0]?.id || null;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function laneAvailable(tier, lane, segments, excludeId = null) {
  for (const unit of state.units) {
    if (unit.id === excludeId || unit.tier !== tier || unit.lane !== lane) continue;
    for (const seg of unit.segments) {
      for (const next of segments) {
        if (!(next.end < seg.start || next.start > seg.end)) return false;
      }
    }
  }
  return true;
}
function autoLaneFor(tier, segments, excludeId = null) {
  for (let lane = 1; lane <= 99; lane++) if (laneAvailable(tier, lane, segments, excludeId)) return lane;
  return 1;
}

function addUnit(partial = {}) {
  const tier = partial.tier || "must";
  const releaseWeek = normalizeWeek(partial.week || 1);
  const segments = (partial.segments || [{ id: crypto.randomUUID(), start: partial.metaStart || releaseWeek, end: partial.metaEnd || Math.min(weekCount(), releaseWeek + 5), statusId: partial.metaStatus || defaultMetaStatusId() }]).map(seg => ({
    id: seg.id || crypto.randomUUID(),
    start: normalizeWeek(seg.start || seg.metaStart || releaseWeek),
    end: normalizeWeek(seg.end || seg.metaEnd || Math.min(weekCount(), releaseWeek + 5)),
    statusId: metaStatus(seg.statusId || seg.metaStatus || partial.metaStatus || defaultMetaStatusId()).id
  }));
  segments.forEach(seg => { if (seg.end < seg.start) [seg.start, seg.end] = [seg.end, seg.start]; });
  const newUnit = {
    id: crypto.randomUUID(),
    name: partial.name || "New Unit",
    kind: partial.kind || "custom",
    tier,
    week: releaseWeek,
    lane: partial.lane || autoLaneFor(tier, segments),
    icon: partial.icon || "",
    tags: cleanTags(partial.tags || partial.badges || []),
    note: partial.note || "",
    segments
  };
  state.units.push(newUnit);
  state.updated = new Date().toISOString();
  selectedId = newUnit.id;
  selectedSegmentId = null;
  renderAll();
  autoSave();
}
function deleteSelected() {
  if (!selectedId) return;
  state.units = state.units.filter(u => u.id !== selectedId);
  selectedId = null;
  selectedSegmentId = null;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function beginDragUnit(event, id) {
  if (event.button !== 0) return;
  const unit = state.units.find(u => u.id === id);
  if (!unit) return;
  event.stopPropagation();
  select(id, null);
  const point = chartPoint(event);
  const originLeft = iconX(unit);
  const originTop = iconY(unit);
  drag = {
    type: "unit",
    id,
    startX: point.x,
    startY: point.y,
    originLeft,
    originTop,
    offsetX: point.x - originLeft,
    offsetY: point.y - originTop,
    previewLeft: originLeft,
    previewTop: originTop,
    didMove: false
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}
function beginDragBar(event, id, segmentId) {
  if (event.button !== 0) return;
  const unit = state.units.find(u => u.id === id);
  const segment = unit?.segments.find(s => s.id === segmentId);
  if (!unit || !segment) return;
  event.stopPropagation();
  select(id, segmentId);
  const handle = event.target.dataset.handle || "move";
  const point = chartPoint(event);
  drag = {
    type: "bar",
    handle,
    id,
    segmentId,
    startX: point.x,
    startY: point.y,
    originStart: segment.start,
    originEnd: segment.end,
    originLane: unit.lane,
    originTier: unit.tier,
    didMove: false
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}
function onPointerMove(event) {
  if (!drag) return;
  const unit = state.units.find(u => u.id === drag.id);
  if (!unit) return;
  const point = chartPoint(event);
  if (Math.abs(point.x - drag.startX) > 3 || Math.abs(point.y - drag.startY) > 3) drag.didMove = true;

  if (drag.type === "unit") {
    const rawX = clamp(point.x - drag.offsetX, LEFT_W, baseChartWidth() - ICON_W);
    const rawY = clamp(point.y - drag.offsetY, HEADER_H, baseChartHeight() - ICON_W);
    drag.previewLeft = rawX;
    drag.previewTop = rawY;
    const oldTier = unit.tier;
    unit.week = idOfWeekFromX(rawX + ICON_W / 2);
    unit.tier = idOfTierFromY(rawY + ICON_W / 2);
    if (oldTier !== unit.tier) unit.lane = autoLaneFor(unit.tier, unit.segments, unit.id);
    renderAll();
  }

  if (drag.type === "bar") {
    const segment = unit.segments.find(s => s.id === drag.segmentId);
    if (!segment) return;
    const dxWeeks = Math.round((point.x - drag.startX) / CELL_W);
    const dy = point.y - drag.startY;
    if (drag.handle === "left") {
      segment.start = clamp(drag.originStart + dxWeeks, 1, segment.end);
    } else if (drag.handle === "right") {
      segment.end = clamp(drag.originEnd + dxWeeks, segment.start, weekCount());
    } else {
      const span = drag.originEnd - drag.originStart;
      const newStart = clamp(drag.originStart + dxWeeks, 1, weekCount() - span);
      segment.start = newStart;
      segment.end = newStart + span;
      const centerY = laneCenterY(drag.originTier, drag.originLane) + dy;
      const tier = idOfTierFromY(centerY);
      unit.tier = tier;
      unit.lane = laneFromY(centerY, tier);
    }
    renderAll();
  }
}
function onPointerUp() {
  if (!drag) return;
  suppressRoadmapClick = true;
  drag = null;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
  setTimeout(() => { if (suppressRoadmapClick) suppressRoadmapClick = false; }, 0);
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setStatus(`Saved locally at ${new Date().toLocaleTimeString()}.`);
}
function autoSave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setStatus("Auto-saved locally. Export JSON or copy a share link when ready.");
}
function loadLocal() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    if (isLegacyExampleState(parsed)) {
      state = structuredClone(DEFAULT_ROADMAP);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    state = { ...structuredClone(DEFAULT_ROADMAP), ...parsed };
    normalizeState();
  } catch { state = structuredClone(DEFAULT_ROADMAP); }
}
function isLegacyExampleState(parsed) {
  const units = parsed?.units || [];
  return units.length > 0 && units.length <= 2 && units.every(u => /^Example (MS|Pilot)$/i.test(String(u.name || "")));
}
function clearLocal() {
  if (!confirm("Clear local saved roadmap and reset to a blank template?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_ROADMAP);
  selectedId = null;
  selectedSegmentId = null;
  renderAll();
  setStatus("Local data cleared. Blank template ready.");
}
function exportJson() {
  normalizeState();
  const blob = new Blob([JSON.stringify({ ...state, updated: new Date().toISOString() }, null, 2)], { type: "application/json" });
  downloadBlob(blob, `gundam-u-c-e-roadmap-${new Date().toISOString().slice(0,10)}.json`);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyZoom() {
  if (!els.roadmap || !els.roadmapStage) return;
  els.roadmap.style.transform = `scale(${zoomScale})`;
  els.roadmapStage.style.width = `${baseChartWidth() * zoomScale}px`;
  els.roadmapStage.style.height = `${baseChartHeight() * zoomScale}px`;
  if (els.zoomRange) els.zoomRange.value = String(Math.round(zoomScale * 100));
  if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(zoomScale * 100)}%`;
}
function setZoom(value, persist = true) {
  zoomScale = clamp(Math.round(Number(value || 1) * 100) / 100, 0.5, 1.6);
  applyZoom();
  if (persist) localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomScale));
}

function tagListFromInput() { return cleanTags(els.editForm.elements.tags.value.split(",")); }
function setTagList(tags, apply = false) {
  els.editForm.elements.tags.value = cleanTags(tags).join(", ");
  renderTagPreview();
  if (apply && getSelected()) applyForm();
}
function addTagFromDropdown() {
  if (!getSelected()) return;
  const tag = els.tagDropdown.value;
  setTagList([...tagListFromInput(), tag], true);
}
function clearTagsForSelected() {
  if (!getSelected()) return;
  setTagList([], true);
}
function renderTagPreview() {
  if (!els.tagPreview) return;
  els.tagPreview.innerHTML = "";
  if (els.editForm.classList.contains("hidden")) return;
  tagListFromInput().forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = `tag ${tagClass(tag)}`;
    chip.textContent = tag;
    chip.title = `Remove ${tag}`;
    chip.addEventListener("click", () => {
      setTagList(tagListFromInput().filter(t => t.toLowerCase() !== tag.toLowerCase()), true);
    });
    els.tagPreview.appendChild(chip);
  });
}

function base64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64urlDecode(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function copyShareLink() {
  normalizeState();
  const payload = { v: 2, updated: new Date().toISOString(), months: state.months, metaStatuses: state.metaStatuses, units: state.units };
  const encoded = base64urlEncode(JSON.stringify(payload));
  const url = `${location.origin}${location.pathname}#roadmap=${encoded}`;
  try {
    await navigator.clipboard.writeText(url);
    setStatus(url.length > 12000 ? `Share link copied, but it is long (${url.length.toLocaleString()} characters). Published JSON is better for large roadmaps.` : "Share link copied.");
  } catch {
    prompt("Copy this share link:", url);
  }
}
function loadFromShareHash() {
  const match = location.hash.match(/roadmap=([^&]+)/);
  if (!match) return false;
  try {
    const json = JSON.parse(base64urlDecode(match[1]));
    state = Array.isArray(json) ? { ...structuredClone(DEFAULT_ROADMAP), units: json } : { ...structuredClone(DEFAULT_ROADMAP), ...json };
    normalizeState();
    selectedId = null;
    selectedSegmentId = null;
    return true;
  } catch (error) {
    alert(`Could not load roadmap from share link: ${error.message}`);
    return false;
  }
}
async function maybeLoadPublishedRoadmap() {
  const params = new URLSearchParams(location.search);
  if (params.get("view") !== "published") return;
  try {
    const response = await fetch("data/roadmap.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state = Array.isArray(data) ? { ...structuredClone(DEFAULT_ROADMAP), units: data } : { ...structuredClone(DEFAULT_ROADMAP), ...data };
    normalizeState();
    selectedId = null;
    selectedSegmentId = null;
    renderAll();
    setStatus(`Loaded published roadmap with ${state.units.length} unit(s).`);
  } catch (error) {
    setStatus(`Could not load data/roadmap.json: ${error.message}`);
  }
}

async function exportPng() {
  setStatus("Rendering PNG…");
  try {
    normalizeState();
    const exportScale = 2;
    const width = baseChartWidth();
    const height = baseChartHeight();
    const canvas = document.createElement("canvas");
    canvas.width = width * exportScale;
    canvas.height = height * exportScale;
    const ctx = canvas.getContext("2d");
    ctx.scale(exportScale, exportScale);
    drawTemplateToCanvas(ctx, width, height);
    for (const unit of state.units) await drawUnitToCanvas(ctx, unit);
    for (const unit of state.units) for (const segment of unit.segments) drawBarToCanvas(ctx, unit, segment);
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("PNG export failed: could not create blob.");
        return;
      }
      downloadBlob(blob, `gundam-u-c-e-roadmap-${new Date().toISOString().slice(0,10)}.png`);
      setStatus("PNG exported.");
    }, "image/png");
  } catch (error) {
    setStatus(`PNG export failed: ${error.message}`);
  }
}

function drawTemplateToCanvas(ctx, width, height) {
  ctx.fillStyle = "#050609";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,.025)";
  ctx.fillRect(0, 0, width, MONTH_H);
  ctx.fillRect(0, MONTH_H, width, WEEK_H);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 18px Arial, sans-serif";
  ctx.fillStyle = "#eef3fb";
  state.months.forEach((month, i) => {
    const x = LEFT_W + i * 4 * CELL_W;
    ctx.fillText(month.toUpperCase(), x + 2 * CELL_W, MONTH_H / 2);
  });
  ctx.font = "900 14px Arial, sans-serif";
  ctx.fillStyle = "#dce4f0";
  for (let w = 1; w <= weekCount(); w++) ctx.fillText(`W${((w - 1) % 4) + 1}`, weekX(w) + CELL_W / 2, MONTH_H + WEEK_H / 2);

  ctx.textAlign = "left";
  ctx.font = "900 16px Arial, sans-serif";
  TIERS.forEach((tier) => {
    ctx.fillStyle = tier.color;
    ctx.fillText(tier.label.toUpperCase(), 22, tierY(tier.id) + tierHeight(tier.id) / 2);
  });

  for (let w = 0; w <= weekCount(); w++) {
    const x = LEFT_W + w * CELL_W;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, w % 4 === 0 ? 0 : HEADER_H);
    ctx.lineTo(x + 0.5, height);
    ctx.strokeStyle = w % 4 === 0 ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.14)";
    ctx.lineWidth = w % 4 === 0 ? 2 : 1;
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  TIERS.forEach((tier) => {
    const y = tierY(tier.id);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.stroke();
  });

  TIERS.forEach(tier => {
    for (let lane = 1; lane <= visibleLaneCount(tier.id); lane++) {
      const y = laneY(tier.id, lane);
      roundedRect(ctx, LEFT_W + 10, y, weekCount() * CELL_W - 20, BAR_H, 9);
      ctx.fillStyle = "rgba(255,255,255,.035)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.08)";
      ctx.stroke();
    }
  });
}
async function drawUnitToCanvas(ctx, unit) {
  const x = iconX(unit), y = iconY(unit);
  ctx.save();
  roundedRect(ctx, x, y, ICON_W, ICON_W, 12);
  ctx.clip();
  const img = await loadImageForCanvas(unit.icon);
  if (img) coverImage(ctx, img, x, y, ICON_W, ICON_W);
  else drawPlaceholder(ctx, unit.name, x, y, ICON_W, ICON_W);
  const grad = ctx.createLinearGradient(0, y + ICON_W - 58, 0, y + ICON_W);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.35, "rgba(0,0,0,.78)");
  grad.addColorStop(1, "rgba(0,0,0,.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y + ICON_W - 58, ICON_W, 58);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 12px Arial, sans-serif";
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  wrapText(ctx, unit.name, x + 8, y + ICON_W - 7, ICON_W - 16, 14, 2);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 0.5, y + 0.5, ICON_W - 1, ICON_W - 1, 12);
  ctx.stroke();
  drawTagsToCanvas(ctx, unit.tags, x, y);
}
function drawTagsToCanvas(ctx, tags, x, y) {
  let cy = y + 7;
  const right = x + ICON_W - 7;
  ctx.font = "900 10px Arial, sans-serif";
  cleanTags(tags).slice(0, 6).forEach(tag => {
    const text = String(tag);
    const w = Math.ceil(ctx.measureText(text).width) + 12;
    const h = 17;
    const bx = right - w;
    roundedRect(ctx, bx, cy, w, h, 8);
    ctx.fillStyle = tagBg(tag);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.52)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + w / 2, cy + h / 2 + 0.5);
    cy += h + 4;
  });
}
function drawBarToCanvas(ctx, unit, segment) {
  const x = weekX(segment.start) + 12;
  const y = laneY(unit);
  const w = (segment.end - segment.start + 1) * CELL_W - 24;
  roundedRect(ctx, x, y, w, BAR_H, BAR_H / 2);
  ctx.fillStyle = segmentColor(segment);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
function isCanvasSafeUrl(src) {
  if (!src) return false;
  if (/^data:/i.test(src)) return true;
  try {
    const url = new URL(src, location.href);
    return url.origin === location.origin;
  } catch { return false; }
}
async function loadImageForCanvas(src) {
  if (!isCanvasSafeUrl(src)) return null;
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function coverImage(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
function drawPlaceholder(ctx, name, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, "#111827");
  grad.addColorStop(1, "#0a0d14");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#d9e4f5";
  ctx.font = "900 36px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials(name), x + w / 2, y + h / 2);
}
function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
function wrapText(ctx, text, x, bottomY, maxWidth, lineHeight, maxLines) {
  const words = sanitizeText(text).split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test;
    else { lines.push(line); line = word; }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const startY = bottomY - (lines.length - 1) * lineHeight;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
function tagBg(tag) {
  const t = String(tag || "").toLowerCase();
  if (t === "pvp") return "rgba(230,64,91,.88)";
  if (t === "pve") return "rgba(63,143,245,.88)";
  if (t === "core") return "rgba(247,180,53,.9)";
  if (t === "tech") return "rgba(171,108,255,.88)";
  if (t === "def") return "rgba(86,218,150,.88)";
  return "rgba(0,0,0,.72)";
}

async function loadCatalog() {
  els.catalogStatus.textContent = "Loading data/catalog.json…";
  try {
    const response = await fetch("data/catalog.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    catalog = Array.isArray(data) ? data : (data.items || []);
    els.catalogStatus.textContent = `Loaded ${catalog.length} catalog item(s).`;
    renderCatalog();
  } catch (error) {
    els.catalogStatus.textContent = `Could not load local catalog: ${error.message}`;
  }
}
function renderCatalog() {
  const template = document.getElementById("catalogItemTemplate");
  const list = catalog.filter(item => {
    const kindOk = filterKind === "all" || item.kind === filterKind || item.type === filterKind;
    const haystack = `${item.name || ""} ${item.kind || item.type || ""} ${item.attribute || ""} ${item.role || ""} ${item.rating || ""}`.toLowerCase();
    return kindOk && (!searchTerm || haystack.includes(searchTerm));
  }).slice(0, 250);
  els.catalogList.innerHTML = "";
  list.forEach(item => {
    const node = template.content.firstElementChild.cloneNode(true);
    const img = node.querySelector("img");
    img.src = item.icon || "";
    img.alt = item.name || "";
    img.onerror = () => { img.src = placeholderDataUrl(item.name); };
    node.querySelector("strong").textContent = item.name || "Unnamed";
    const meta = [item.kind || item.type, item.attribute, item.role, item.rating ? `${item.rating}点` : ""].filter(Boolean).join(" · ");
    node.querySelector("small").textContent = meta;
    node.querySelector("button").addEventListener("click", () => {
      addUnit({
        name: item.name,
        kind: item.kind || item.type || "custom",
        icon: item.icon || "",
        tags: [],
        note: item.sourceUrl ? `Source: ${item.sourceUrl}` : ""
      });
    });
    els.catalogList.appendChild(node);
  });
}
function placeholderDataUrl(name) {
  const label = initials(name || "?").slice(0, 2);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='%23131b25'/><text x='48' y='54' text-anchor='middle' font-family='Arial' font-size='26' fill='%23d9e4f5' font-weight='700'>${label}</text></svg>`;
  return `data:image/svg+xml,${svg}`;
}

function showTooltip(event, unit, segment = null) {
  hideTooltip();
  const seg = segment || selectedSegment(unit) || firstSegment(unit);
  tooltipEl = document.createElement("div");
  tooltipEl.className = "tooltip";
  tooltipEl.innerHTML = `<strong>${escapeHtml(unit.name)}</strong><div>${escapeHtml(TIERS[tierIndex(unit.tier)].label)} · Release W${unit.week}</div>${seg ? `<div>Meta: W${seg.start}–W${seg.end} · ${escapeHtml(metaStatus(seg.statusId).label)}</div>` : ""}${unit.tags.length ? `<div>Tags: ${unit.tags.map(escapeHtml).join(", ")}</div>` : ""}${unit.note ? `<p>${escapeHtml(unit.note)}</p>` : ""}`;
  document.body.appendChild(tooltipEl);
  moveTooltip(event);
}
function moveTooltip(event) {
  if (!tooltipEl) return;
  tooltipEl.style.left = `${event.clientX + 14}px`;
  tooltipEl.style.top = `${event.clientY + 14}px`;
}
function hideTooltip() { tooltipEl?.remove(); tooltipEl = null; }
function escapeHtml(text) { return String(text || "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

init();
