const DEFAULT_MONTHS = makeDefaultMonthLabels(3);
const OLD_GENERIC_MONTHS = ["This Month", "Next Month", "2 Months Later", "3 Months Later", "4 Months Later"];
function makeDefaultMonthLabels(count, startDate = new Date()) {
  const labels = [];
  const base = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });
  for (let i = 0; i < count; i++) labels.push(fmt.format(new Date(base.getFullYear(), base.getMonth() + i, 1)));
  return labels;
}
function isGenericMonthLabels(months) {
  if (!Array.isArray(months) || !months.length) return true;
  return months.every((m, i) => String(m || "").trim() === (OLD_GENERIC_MONTHS[i] || `${i + 1} Months Later`));
}
function isGeneratedMonthLabels(months) {
  if (!Array.isArray(months) || !months.length) return false;
  const generated = makeDefaultMonthLabels(months.length);
  return months.every((m, i) => String(m || "").trim() === generated[i]);
}
function maxUsedWeekInUnits(units = state.units || []) {
  let max = 1;
  for (const unit of units || []) {
    max = Math.max(max, Number(unit.week) || 1);
    for (const seg of unit.segments || []) max = Math.max(max, Number(seg.end || seg.metaEnd || seg.start || seg.metaStart) || 1);
  }
  return max;
}
function suggestedMonthLabel(index) {
  return makeDefaultMonthLabels(index + 1)[index] || `Month ${index + 1}`;
}
const DEFAULT_TIERS = [
  { id: "human", label: "Human Rights", color: "#ff4b59" },
  { id: "must", label: "Must Pull", color: "#47a9ff" },
  { id: "ideal", label: "Ideally Pull", color: "#67ef87" },
  { id: "luxury", label: "Luxury Pull", color: "#ffcc4d" },
  { id: "skip", label: "Skip", color: "#8d96a6" }
];
const DEFAULT_META_STATUSES = [
  { id: "s1", label: "Human Rights", color: "#ff4b59" },
  { id: "s2", label: "Era-Defining", color: "#47a9ff" },
  { id: "s3", label: "Strong", color: "#67ef87" },
  { id: "s4", label: "Rotational", color: "#ffcc4d" },
  { id: "s5", label: "Situational", color: "#c18cff" }
];
const LEGACY_TIER_COLORS = { must: ["#ffa12a"], ideal: ["#47a9ff"], luxury: ["#a66bff"], skip: ["#9aa0ab", "#c18cff", "#a66bff", "#8b5cf6", "#9333ea", "#7c3aed", "#6d28d9"] };
const LEGACY_TIER_LABELS = {
  must: ["Era-Defining"],
  ideal: ["Strong"],
  luxury: ["Rotational"]
};
const LEGACY_STATUS_COLORS = { s2: "#37e6ff" };
const OLD_STATUS_MAP = { top: "s1", strong: "s3", niche: "s5", fading: "s4", custom: "s5" };
const TAG_OPTIONS = ["PVP", "PVE", "Must P5", "Buff", "Core", "Tech", "Def", "Sub", "CB"];
const MAX_TAGS = 10;
const TAGS_PER_COLUMN = 5;
const MUST_P5_TAG = "Must P5";
const BUFF_TAG = "Buff";
const TAG_ORDER = new Map(TAG_OPTIONS.map((tag, i) => [tag.toLowerCase(), i]));
const CELL_W = 200;
const LEFT_W = 260;
const MONTH_H = 58;
const WEEK_H = 48;
const HEADER_H = MONTH_H + WEEK_H;
const BLANK_TIER_H = 250;
const ICON_W = 176;
const ICON_TOP = 28;
const ICON_STACK_GAP = 14;
const COMPACT_PILOT_W = 96;
const COMPACT_STACK_GAP = 8;
const BAR_TOP = 222;
const BAR_GAP = 23;
const BAR_H = 18;
const BAR_BOTTOM_PAD = 34;
const STORAGE_KEY = "gundam-u-c-e-roadmap-builder-v1";
const ZOOM_STORAGE_KEY = "gundam-u-c-e-roadmap-builder-zoom-v2";

const DEFAULT_ROADMAP = {
  updated: new Date().toISOString(),
  months: [...DEFAULT_MONTHS],
  tiers: structuredClone(DEFAULT_TIERS),
  metaStatuses: structuredClone(DEFAULT_META_STATUSES),
  monthWeeks: DEFAULT_MONTHS.map(() => 4),
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
let ignoreNextUnitClick = false;
let autoApplyTimer = null;
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
  statusForm: document.getElementById("statusForm"),
  tierDialog: document.getElementById("tierDialog"),
  tierForm: document.getElementById("tierForm"),
  contextMenu: document.getElementById("contextMenu")
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function legibleTextScale(scale = zoomScale) {
  const normalized = clamp(Number(scale) || 1, 0.5, 1.6);
  return clamp(Math.pow(1 / normalized, 0.45), 1, 1.42);
}
function barLabelTextScale(scale = zoomScale) {
  const normalized = clamp(Number(scale) || 1, 0.5, 1.6);
  return clamp(Math.pow(1 / normalized, 0.85), 1, 1.82);
}
function fontPx(px, scale = zoomScale) { return Math.round(px * legibleTextScale(scale) * 10) / 10; }
function barFontPx(px, scale = zoomScale) { return Math.round(px * barLabelTextScale(scale) * 10) / 10; }
function canvasFont(weight, px, family = "Arial, sans-serif") { return `${weight} ${fontPx(px)}px ${family}`; }
function canvasBarFont(weight, px, family = "Arial, sans-serif") { return `${weight} ${barFontPx(px)}px ${family}`; }
function normalizeMonthWeekCount(value) { return Number(value) === 5 ? 5 : 4; }
function getMonthWeeks() {
  const months = Array.isArray(state.months) && state.months.length ? state.months : DEFAULT_MONTHS;
  const raw = Array.isArray(state.monthWeeks) ? state.monthWeeks : [];
  return months.map((_, i) => normalizeMonthWeekCount(raw[i]));
}
function weekCount() { return Math.max(1, getMonthWeeks().reduce((sum, weeks) => sum + weeks, 0)); }
function monthStartWeek(index) { return 1 + getMonthWeeks().slice(0, index).reduce((sum, weeks) => sum + weeks, 0); }
function weekToMonthWeek(week) {
  const total = weekCount();
  const normalized = clamp(Math.round(Number(week) || 1), 1, total);
  const counts = getMonthWeeks();
  let start = 1;
  for (let i = 0; i < counts.length; i++) {
    const end = start + counts[i] - 1;
    if (normalized <= end) return { monthIndex: i, weekInMonth: normalized - start + 1, monthStart: start, monthEnd: end };
    start = end + 1;
  }
  const last = Math.max(0, counts.length - 1);
  return { monthIndex: last, weekInMonth: counts[last] || 1, monthStart: Math.max(1, total - (counts[last] || 1) + 1), monthEnd: total };
}
function getTiers() { return state.tiers?.length ? state.tiers : DEFAULT_TIERS; }
function tierIndex(id) { return Math.max(0, getTiers().findIndex(t => t.id === id)); }
function tierById(id) { return getTiers().find(t => t.id === id) || getTiers()[0] || DEFAULT_TIERS[0]; }
function tierIds() { return getTiers().map(t => t.id); }
function getStatuses() { return state.metaStatuses?.length ? state.metaStatuses : DEFAULT_META_STATUSES; }
function metaStatus(id) { return getStatuses().find(s => s.id === id) || getStatuses()[2] || DEFAULT_META_STATUSES[2]; }
function formatWeek(week) {
  const { monthIndex, weekInMonth } = weekToMonthWeek(week);
  const label = state.months?.[monthIndex] || DEFAULT_MONTHS[monthIndex] || `Month ${monthIndex + 1}`;
  return `${label} W${weekInMonth}`;
}
function formatWeekRange(start, end) {
  return start === end ? formatWeek(start) : `${formatWeek(start)}–${formatWeek(end)}`;
}
function weekX(week) { return LEFT_W + (week - 1) * CELL_W; }
function normalizeRowOffset(value) {
  const n = Number(value) || 0;
  if (n <= -0.25) return -0.5;
  if (n >= 0.25) return 0.5;
  return 0;
}
function rowOffsetLabel(value, tierId = null) {
  const offset = normalizeRowOffset(value);
  if (!offset) return "In row";
  const tiers = getTiers();
  const index = tierId ? tiers.findIndex(t => t.id === tierId) : -1;
  if (index >= 0) {
    const upper = offset < 0 ? tiers[index - 1] : tiers[index];
    const lower = offset < 0 ? tiers[index] : tiers[index + 1];
    if (upper && lower) return `${upper.label} - ${lower.label}`;
  }
  return offset < 0 ? "Between rows" : "Between rows";
}
function rowOffsetForIcon(unit) {
  const offset = normalizeRowOffset(unit?.rowOffset);
  if (!offset) return 0;
  const baseCenter = ICON_TOP + ICON_W / 2;
  return offset < 0 ? -Math.round(baseCenter) : Math.max(0, Math.round(tierHeight(unit.tier) - baseCenter));
}
function rowOffsetForBar(unit) {
  const offset = normalizeRowOffset(unit?.rowOffset);
  if (!offset) return 0;
  const baseCenter = dynamicBarTop(unit.tier) + BAR_H / 2;
  return offset < 0 ? -Math.round(baseCenter) : Math.max(0, Math.round(tierHeight(unit.tier) - baseCenter));
}
function isPilot(unit) { return String(unit?.kind || "").toLowerCase() === "pilot"; }
function isMs(unit) { return String(unit?.kind || "").toLowerCase() === "ms"; }
function hasMetaBars(unit) { return !isPilot(unit); }
function rowSlotKey(unit) {
  if (!unit) return "row:";
  const offset = normalizeRowOffset(unit.rowOffset);
  const tiers = getTiers();
  const index = tierIndex(unit.tier);
  if (!offset || index < 0) return `row:${unit.tier}`;
  const upper = offset < 0 ? tiers[index - 1] : tiers[index];
  const lower = offset < 0 ? tiers[index] : tiers[index + 1];
  return upper && lower ? `between:${upper.id}|${lower.id}` : `row:${unit.tier}`;
}
function visualSlotKey(unit) {
  return `${normalizeWeek(unit?.week)}|${rowSlotKey(unit)}`;
}
function sameVisualSlot(a, b) {
  return !!a && !!b && normalizeWeek(a.week) === normalizeWeek(b.week) && rowSlotKey(a) === rowSlotKey(b);
}
function visualStackRank(unit) {
  if (isMs(unit)) return 0;
  if (String(unit?.kind || "").toLowerCase() === "custom") return 1;
  if (isPilot(unit)) return 2;
  return 1;
}
function sameSlotGroup(unit) {
  if (!unit) return [];
  return (state.units || [])
    .filter(other => sameVisualSlot(unit, other))
    .sort((a, b) => {
      const rankDiff = visualStackRank(a) - visualStackRank(b);
      if (rankDiff) return rankDiff;
      const orderDiff = (Number(a.stackOrder) || 0) - (Number(b.stackOrder) || 0);
      return orderDiff || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}
function isCompactBetweenSlot(group) {
  return group.length > 1
    && group.some(unit => normalizeRowOffset(unit.rowOffset))
    && group.some(isMs)
    && group.some(isPilot);
}
function slotSizeForUnit(unit, group = sameSlotGroup(unit)) {
  return isCompactBetweenSlot(group) && isPilot(unit) ? COMPACT_PILOT_W : ICON_W;
}
function slotLayoutForGroup(group) {
  const compact = isCompactBetweenSlot(group);
  let y = 0;
  const layout = new Map();
  group.forEach((unit, index) => {
    const size = slotSizeForUnit(unit, group);
    const x = compact && size < ICON_W ? Math.round((ICON_W - size) / 2) : 0;
    layout.set(unit.id, { x, y, size, z: group.length - index, index });
    y += size + (compact ? COMPACT_STACK_GAP : ICON_STACK_GAP);
  });
  return { layout, groupHeight: Math.max(ICON_W, y - (compact ? COMPACT_STACK_GAP : ICON_STACK_GAP)), compact };
}
function sameSlotOffset(unit) {
  const group = sameSlotGroup(unit);
  if (group.length <= 1) return { x: 0, y: 0, z: 0, index: 0, count: 1, groupHeight: ICON_W, size: ICON_W, compact: false };
  const { layout, groupHeight, compact } = slotLayoutForGroup(group);
  const slot = layout.get(unit.id) || { x: 0, y: 0, z: 0, index: 0, size: ICON_W };
  return { ...slot, count: group.length, groupHeight, compact };
}
function iconSize(unit) { return sameSlotOffset(unit).size || ICON_W; }
function unitZIndex(unit, slot = sameSlotOffset(unit), isDragging = false) {
  if (isDragging) return 10000;
  const stack = Math.max(0, Number(unit?.stackOrder) || 0);
  const selectedBoost = selectedId === unit?.id && !selectedSegmentId ? 2 : 0;
  return 20 + stack * 2 + (slot?.z || 0) + selectedBoost;
}
function iconRect(unit) {
  const size = iconSize(unit);
  return { left: iconX(unit), top: iconY(unit), right: iconX(unit) + size, bottom: iconY(unit) + size };
}
function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function overlappingUnits(unit) {
  if (!unit) return [];
  const rect = iconRect(unit);
  return (state.units || []).filter(other => other.id !== unit.id && rectsOverlap(rect, iconRect(other)));
}
function bringUnitToFront(unitId) {
  if (drag) return;
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  const overlaps = overlappingUnits(unit);
  if (!overlaps.length) return;
  const slot = sameSlotOffset(unit);
  const currentZ = unitZIndex(unit, slot);
  const maxOverlapZ = Math.max(...overlaps.map(other => unitZIndex(other, sameSlotOffset(other))));
  if (currentZ > maxOverlapZ) return;
  let maxOrder = Math.max(0, ...state.units.map(u => Number(u.stackOrder) || 0));
  if (maxOrder > 100000) {
    state.units
      .slice()
      .sort((a, b) => (Number(a.stackOrder) || 0) - (Number(b.stackOrder) || 0))
      .forEach((u, index) => { u.stackOrder = index; });
    maxOrder = Math.max(0, ...state.units.map(u => Number(u.stackOrder) || 0));
  }
  unit.stackOrder = maxOrder + 1;
  refreshUnitZIndices();
}
function refreshUnitZIndices() {
  els.roadmap?.querySelectorAll?.(".unit-card").forEach(card => {
    const unit = state.units.find(u => u.id === card.dataset.id);
    if (!unit) return;
    card.style.zIndex = String(unitZIndex(unit));
  });
}
function slotGroupHeight(group) { return slotLayoutForGroup(group).groupHeight || ICON_W; }
function maxIconStackVisualHeight(tierId) {
  const seen = new Set();
  const heights = [ICON_W];
  for (const unit of state.units || []) {
    if (unit.tier !== tierId) continue;
    const key = visualSlotKey(unit);
    if (seen.has(key)) continue;
    seen.add(key);
    heights.push(slotGroupHeight(sameSlotGroup(unit)));
  }
  return Math.max(...heights);
}
function dynamicBarTop(tierId) {
  return Math.max(BAR_TOP, ICON_TOP + maxIconStackVisualHeight(tierId) + 18);
}
function kindSort(kind) {
  if (kind === "pilot") return 0;
  if (kind === "custom") return 1;
  if (kind === "ms") return 2;
  return 1;
}
function hasTag(unit, tag) { return !!unit?.tags?.some(t => t.toLowerCase() === tag.toLowerCase()); }
function hasMustP5(unit) { return hasTag(unit, MUST_P5_TAG); }
function hasBuff(unit) { return hasTag(unit, BUFF_TAG); }
function hasVisibleMetaSegments(unit) { return hasMetaBars(unit) && Array.isArray(unit?.segments) && unit.segments.length > 0; }
function visibleLaneCount(tierId) {
  let maxLane = 0;
  for (const unit of state.units || []) {
    if (unit.tier === tierId && hasVisibleMetaSegments(unit)) maxLane = Math.max(maxLane, Number(unit.lane) || 0);
  }
  return maxLane;
}
function tierHeight(tierId) {
  const lanes = visibleLaneCount(tierId);
  const iconContentHeight = ICON_TOP + maxIconStackVisualHeight(tierId) + 28;
  const minHeight = Math.max(BLANK_TIER_H, iconContentHeight);
  if (!lanes) return minHeight;
  return Math.max(minHeight, dynamicBarTop(tierId) + lanes * BAR_GAP + BAR_BOTTOM_PAD);
}
function tierY(tierId) {
  let y = HEADER_H;
  for (const tier of getTiers()) {
    if (tier.id === tierId) return y;
    y += tierHeight(tier.id);
  }
  return y;
}
function laneY(unitOrTier, laneMaybe) {
  const tier = typeof unitOrTier === "string" ? unitOrTier : unitOrTier.tier;
  const lane = typeof unitOrTier === "string" ? laneMaybe : unitOrTier.lane;
  return tierY(tier) + dynamicBarTop(tier) + (lane - 1) * BAR_GAP;
}
function laneCenterY(tier, lane) { return laneY(tier, lane) + BAR_H / 2; }
function iconY(unit) {
  const slot = sameSlotOffset(unit);
  const size = slot.size || ICON_W;
  const rowOffset = normalizeRowOffset(unit.rowOffset);
  let top = tierY(unit.tier) + ICON_TOP + slot.y;
  if (rowOffset > 0) top = tierY(unit.tier) + tierHeight(unit.tier) - slot.groupHeight / 2 + slot.y;
  if (rowOffset < 0) top = tierY(unit.tier) - slot.groupHeight / 2 + slot.y;
  return clamp(top, HEADER_H - size / 2, baseChartHeight() - size);
}
function iconX(unit) {
  const slot = sameSlotOffset(unit);
  const size = slot.size || ICON_W;
  return clamp(weekX(unit.week) + Math.round((CELL_W - ICON_W) / 2) + slot.x, LEFT_W, baseChartWidth() - size);
}
function normalizeWeek(n) { return clamp(Math.round(Number(n) || 1), 1, weekCount()); }
function normalizeLane(n) { return clamp(Math.round(Number(n) || 1), 1, 99); }
function idOfWeekFromX(x) { return normalizeWeek(Math.round((x - LEFT_W - CELL_W / 2) / CELL_W) + 1); }
function idOfTierFromY(y) {
  let top = HEADER_H;
  for (const tier of getTiers()) {
    const bottom = top + tierHeight(tier.id);
    if (y < bottom) return tier.id;
    top = bottom;
  }
  const tiers = getTiers();
  return tiers[tiers.length - 1].id;
}
function rowPlacementFromY(y) {
  const tiers = getTiers();
  let top = HEADER_H;
  const betweenThreshold = 42;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const bottom = top + tierHeight(tier.id);
    if (i < tiers.length - 1 && Math.abs(y - bottom) <= betweenThreshold) {
      return { tier: tier.id, rowOffset: 0.5 };
    }
    if (y >= top && y < bottom) return { tier: tier.id, rowOffset: 0 };
    top = bottom;
  }
  return { tier: tiers[tiers.length - 1].id, rowOffset: 0 };
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
function baseChartHeight() { return HEADER_H + getTiers().reduce((sum, t) => sum + tierHeight(t.id), 0); }
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
  }).slice(0, MAX_TAGS);
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
  loadCatalog();
  maybeLoadPublishedRoadmap();
}

function normalizeState() {
  const unitsBeforeNormalize = Array.isArray(state.units) ? state.units : [];
  const monthsNeedDefault = !Array.isArray(state.months) || !state.months.length || isGenericMonthLabels(state.months);
  const blankGeneratedDefault = !unitsBeforeNormalize.length && isGeneratedMonthLabels(state.months) && state.months.length !== DEFAULT_MONTHS.length;
  if (monthsNeedDefault || blankGeneratedDefault) {
    const neededMonths = Math.max(DEFAULT_MONTHS.length, Math.ceil(maxUsedWeekInUnits(unitsBeforeNormalize) / 4));
    state.months = makeDefaultMonthLabels(Math.min(12, neededMonths));
  }
  state.months = state.months.map((m, i) => sanitizeText(m) || suggestedMonthLabel(i)).slice(0, 12);
  if (!state.months.length) state.months = [...DEFAULT_MONTHS];
  const rawMonthWeeks = Array.isArray(state.monthWeeks) ? state.monthWeeks : [];
  state.monthWeeks = state.months.map((_, i) => normalizeMonthWeekCount(rawMonthWeeks[i]));
  while (state.months.length < 12 && weekCount() < maxUsedWeekInUnits(unitsBeforeNormalize)) {
    const nextIndex = state.months.length;
    state.months.push(suggestedMonthLabel(nextIndex));
    state.monthWeeks.push(4);
  }

  const oldTierLabels = new Map((state.tiers || []).map(t => [t.id, t.label]));
  const oldTierColors = new Map((state.tiers || []).map(t => [t.id, t.color]));
  state.tiers = DEFAULT_TIERS.map((fallback) => {
    const oldColorRaw = String(oldTierColors.get(fallback.id) || "").trim();
    const oldColor = oldColorRaw.toLowerCase();
    const legacyColors = LEGACY_TIER_COLORS[fallback.id] || [];
    const wasLegacyDefault = legacyColors.some(c => c.toLowerCase() === oldColor);
    const oldLabel = sanitizeText(oldTierLabels.get(fallback.id));
    const wasLegacyLabel = (LEGACY_TIER_LABELS[fallback.id] || []).some(l => l.toLowerCase() === oldLabel.toLowerCase());
    const label = oldLabel && !wasLegacyLabel ? oldLabel : fallback.label;
    const oldIsValid = /^#[0-9a-f]{6}$/i.test(oldColorRaw);
    const forceSkipGrey = fallback.id === "skip" && (!oldColorRaw || wasLegacyDefault || ["#c18cff", "#a66bff", "#8b5cf6", "#9333ea", "#7c3aed", "#6d28d9"].includes(oldColor));
    const color = oldIsValid && !wasLegacyDefault && !forceSkipGrey ? oldColorRaw : fallback.color;
    return { id: fallback.id, label, color };
  });

  if (!Array.isArray(state.metaStatuses) || !state.metaStatuses.length) state.metaStatuses = structuredClone(DEFAULT_META_STATUSES);
  state.metaStatuses = state.metaStatuses.slice(0, 8).map((s, i) => {
    const id = sanitizeText(s.id) || `s${i + 1}`;
    const fallback = DEFAULT_META_STATUSES[i] || { label: `Status ${i + 1}`, color: "#8aa0ff" };
    const oldColor = s.color || "";
    const color = oldColor && oldColor.toLowerCase() !== (LEGACY_STATUS_COLORS[id] || "").toLowerCase() && /^#[0-9a-f]{6}$/i.test(oldColor)
      ? oldColor
      : fallback.color;
    return {
      id,
      label: sanitizeText(s.label) || fallback.label,
      color
    };
  });
  const statusIds = new Set(state.metaStatuses.map(s => s.id));
  const fallbackStatus = defaultMetaStatusId();

  state.units = (state.units || []).map((u) => {
    const oldStatus = OLD_STATUS_MAP[u.metaStatus] || u.metaStatus;
    const metaStart = normalizeWeek(u.metaStart || u.week || 1);
    const metaEnd = normalizeWeek(u.metaEnd || u.metaStart || u.week || 1);
    const hasExplicitSegments = Array.isArray(u.segments);
    let segments = hasExplicitSegments ? u.segments : [];
    if (!hasExplicitSegments) {
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
    const tier = tierIds().includes(u.tier) ? u.tier : "must";
    const rawTags = Array.isArray(u.tags) ? u.tags : (Array.isArray(u.badges) ? u.badges : []);
    return {
      id: u.id || crypto.randomUUID(),
      name: sanitizeText(u.name || "Unnamed Unit"),
      kind: u.kind || "custom",
      tier,
      week: normalizeWeek(u.week || 1),
      lane: normalizeLane(u.lane || 1),
      rowOffset: normalizeRowOffset(u.rowOffset ?? u.tierOffset ?? 0),
      stackOrder: Number(u.stackOrder) || 0,
      icon: u.icon || "",
      tags: cleanTags(rawTags),
      note: u.note || "",
      segments
    };
  });

  for (const unit of state.units) {
    unit.week = normalizeWeek(unit.week);
    unit.rowOffset = normalizeRowOffset(unit.rowOffset);
    unit.stackOrder = Number(unit.stackOrder) || 0;
    unit.segments.forEach(seg => {
      seg.start = normalizeWeek(seg.start);
      seg.end = normalizeWeek(seg.end);
      if (seg.end < seg.start) [seg.start, seg.end] = [seg.end, seg.start];
    });
    unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  for (const tier of getTiers()) reflowLanes(tier.id);
  syncPilotLanes();
}

function renderAll() {
  normalizeState();
  buildStaticGrid();
  renderLegend();
  buildTierSelect();
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

  const monthWeeks = getMonthWeeks();
  state.months.forEach((month, i) => {
    const head = document.createElement("button");
    head.type = "button";
    head.className = "month-head month-button";
    head.style.left = `${weekX(monthStartWeek(i))}px`;
    head.style.width = `${monthWeeks[i] * CELL_W}px`;
    head.textContent = month;
    head.setAttribute("aria-label", `${month}. Click to rename. Right-click for 4/5-week options.`);
    head.addEventListener("click", (event) => {
      event.stopPropagation();
      renameMonth(i);
    });
    head.addEventListener("contextmenu", (event) => openMonthContextMenu(event, i));
    els.roadmap.appendChild(head);
  });

  for (let w = 1; w <= weekCount(); w++) {
    const week = document.createElement("div");
    const { weekInMonth } = weekToMonthWeek(w);
    week.className = "week-head";
    week.style.left = `${weekX(w)}px`;
    week.textContent = `W${weekInMonth}`;
    els.roadmap.appendChild(week);
  }

  getTiers().forEach((tier) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = `tier-label ${tier.id}`;
    label.style.top = `${tierY(tier.id)}px`;
    label.style.height = `${tierHeight(tier.id)}px`;
    label.style.color = tier.color;
    label.textContent = tier.label;
    label.setAttribute("aria-label", `${tier.label}. Click to rename or recolor this row.`);
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      openTierEditor(tier.id);
    });
    els.roadmap.appendChild(label);
  });

  const monthBoundaries = new Set([0]);
  getMonthWeeks().reduce((sum, weeks) => {
    const next = sum + weeks;
    monthBoundaries.add(next);
    return next;
  }, 0);
  for (let w = 0; w <= weekCount(); w++) {
    const isMonthBoundary = monthBoundaries.has(w);
    const line = document.createElement("div");
    line.className = `grid-line v${isMonthBoundary ? " month" : ""}`;
    line.style.left = `${LEFT_W + w * CELL_W}px`;
    line.style.height = isMonthBoundary ? "100%" : `${baseChartHeight() - HEADER_H}px`;
    els.roadmap.appendChild(line);
  }

  getTiers().forEach((tier) => {
    const line = document.createElement("div");
    line.className = "grid-line h";
    line.style.top = `${tierY(tier.id)}px`;
    els.roadmap.appendChild(line);
  });
  const bottom = document.createElement("div");
  bottom.className = "grid-line h";
  bottom.style.top = `${baseChartHeight()}px`;
  els.roadmap.appendChild(bottom);

  getTiers().forEach((tier) => {
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
  select.innerHTML = getTiers().map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join("");
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
  document.getElementById("btnLoadCatalog")?.addEventListener("click", loadCatalog);
  document.getElementById("btnDelete").addEventListener("click", deleteSelected);
  document.getElementById("btnAddMonth").addEventListener("click", addMonth);
  document.getElementById("btnRemoveMonth").addEventListener("click", removeMonth);
  document.getElementById("btnAddSegment").addEventListener("click", () => addSegmentToSelected());
  document.getElementById("btnDeleteSegment").addEventListener("click", deleteSelectedSegment);
  document.getElementById("btnZoomOut").addEventListener("click", () => setZoom(zoomScale - 0.1));
  document.getElementById("btnZoomIn").addEventListener("click", () => setZoom(zoomScale + 0.1));
  document.getElementById("btnZoomReset").addEventListener("click", () => setZoom(1));
  els.zoomRange.addEventListener("input", () => setZoom(Number(els.zoomRange.value) / 100));
  document.getElementById("btnAddTag").addEventListener("click", addTagFromDropdown);
  document.getElementById("btnClearTags").addEventListener("click", clearTagsForSelected);
  document.getElementById("btnCancelStatusEdit").addEventListener("click", () => els.statusDialog.close());
  document.getElementById("btnCancelTierEdit").addEventListener("click", () => els.tierDialog.close());
  els.statusForm.addEventListener("submit", saveStatusEdit);
  els.tierForm.addEventListener("submit", saveTierEdit);
  bindAutoApplyForm();
  document.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !event.target.closest(".context-menu")) hideContextMenu();
  });
  document.addEventListener("contextmenu", (event) => {
    if (!event.target.closest("#roadmap")) hideContextMenu();
  });
  window.addEventListener("resize", hideContextMenu);
  window.addEventListener("scroll", hideContextMenu, true);
  els.editForm.elements.tags.addEventListener("input", renderTagPreview);
  els.editForm.elements.segment.addEventListener("change", () => {
    selectedSegmentId = els.editForm.elements.segment.value;
    renderForm();
    refreshSelectionUi();
  });

  els.roadmap.addEventListener("contextmenu", openChartContextMenu);
  els.roadmap.addEventListener("click", (event) => {
    if (suppressRoadmapClick) {
      suppressRoadmapClick = false;
      return;
    }
    if (event.target.closest(".unit-card,.meta-bar,.month-head,.tier-label,.context-menu")) return;
    hideContextMenu();
    select(null);
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
    btn.setAttribute("aria-label", `Edit meta status: ${status.label}`);
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

function openTierEditor(tierId) {
  const tier = tierById(tierId);
  const f = els.tierForm.elements;
  f.tierId.value = tier.id;
  f.label.value = tier.label;
  f.color.value = tier.color;
  els.tierDialog.showModal();
}

function saveTierEdit(event) {
  event.preventDefault();
  const f = els.tierForm.elements;
  const tier = state.tiers.find(t => t.id === f.tierId.value);
  if (!tier) return;
  tier.label = sanitizeText(f.label.value) || tier.label;
  tier.color = /^#[0-9a-f]{6}$/i.test(f.color.value) ? f.color.value : tier.color;
  state.updated = new Date().toISOString();
  els.tierDialog.close();
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
function openMonthContextMenu(event, index) {
  event.preventDefault();
  event.stopPropagation();
  const currentWeeks = getMonthWeeks()[index] || 4;
  const month = state.months[index] || `Month ${index + 1}`;
  showContextMenu(event.clientX, event.clientY, [
    { label: `Rename ${month}…`, action: () => renameMonth(index) },
    { label: `${currentWeeks === 4 ? "✓ " : ""}Use 4 weeks`, action: () => setMonthWeekCount(index, 4) },
    { label: `${currentWeeks === 5 ? "✓ " : ""}Use 5 weeks`, action: () => setMonthWeekCount(index, 5) }
  ]);
}
function setMonthWeekCount(index, weeks) {
  state.monthWeeks = getMonthWeeks();
  state.monthWeeks[index] = normalizeMonthWeekCount(weeks);
  normalizeState();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
  setStatus(`${state.months[index] || `Month ${index + 1}`} set to ${state.monthWeeks[index]} week(s).`);
}
function addMonth() {
  const next = state.months.length + 1;
  const value = prompt("New month label:", suggestedMonthLabel(next - 1));
  if (value === null) return;
  state.months.push(sanitizeText(value) || suggestedMonthLabel(next - 1));
  state.monthWeeks = [...getMonthWeeks().slice(0, state.months.length - 1), 4];
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function removeMonth() {
  if (state.months.length <= 1) return alert("You need at least one month.");
  const removed = state.months[state.months.length - 1];
  if (!confirm(`Remove the last month: ${removed}? Any units/bars beyond the new end will be clamped.`)) return;
  state.months.pop();
  state.monthWeeks = getMonthWeeks().slice(0, state.months.length);
  normalizeState();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function renderUnits() {
  state.units.forEach(unit => {
    const card = document.createElement("article");
    const isDraggingUnit = drag?.type === "unit" && drag.id === unit.id && Number.isFinite(drag.previewLeft);
    const slot = sameSlotOffset(unit);
    const compactPilot = slot.compact && isPilot(unit);
    const size = slot.size || ICON_W;
    card.className = `unit-card${selectedId === unit.id && !selectedSegmentId ? " selected" : ""}${isDraggingUnit ? " dragging" : ""}${hasMustP5(unit) ? " must-p5" : ""}${hasBuff(unit) ? " buff" : ""}${normalizeRowOffset(unit.rowOffset) ? " between-row" : ""}${compactPilot ? " compact-pilot" : ""}`;
    card.dataset.id = unit.id;
    card.style.left = `${isDraggingUnit ? drag.previewLeft : iconX(unit)}px`;
    card.style.top = `${isDraggingUnit ? drag.previewTop : iconY(unit)}px`;
    card.style.width = `${isDraggingUnit ? ICON_W : size}px`;
    card.style.height = `${isDraggingUnit ? ICON_W : size}px`;
    card.style.zIndex = String(unitZIndex(unit, slot, isDraggingUnit));
    card.setAttribute("aria-label", unit.name);

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
    const displayTags = unit.tags.slice(0, MAX_TAGS);
    tags.className = `tags${displayTags.length > TAGS_PER_COLUMN ? " two-col" : ""}`;
    const appendTag = (container, t) => {
      const span = document.createElement("span");
      span.className = `tag ${tagClass(t)}`;
      span.textContent = t;
      container.appendChild(span);
    };
    if (displayTags.length > TAGS_PER_COLUMN) {
      [displayTags.slice(TAGS_PER_COLUMN), displayTags.slice(0, TAGS_PER_COLUMN)].forEach(colTags => {
        const column = document.createElement("div");
        column.className = "tag-column";
        colTags.forEach(t => appendTag(column, t));
        tags.appendChild(column);
      });
    } else {
      displayTags.forEach(t => appendTag(tags, t));
    }
    card.appendChild(tags);

    const plate = document.createElement("div");
    plate.className = "nameplate";
    plate.textContent = unit.name;
    card.appendChild(plate);

    card.addEventListener("pointerdown", (event) => beginDragUnit(event, unit.id));
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (ignoreNextUnitClick) {
        ignoreNextUnitClick = false;
        return;
      }
      select(unit.id, null);
    });
    card.addEventListener("contextmenu", (event) => openUnitContextMenu(event, unit.id, null));
    card.addEventListener("dblclick", (event) => { event.stopPropagation(); renameUnit(unit.id); });
    card.addEventListener("mouseenter", (event) => { bringUnitToFront(unit.id); showTooltip(event, unit); });
    card.addEventListener("mouseleave", hideTooltip);
    card.addEventListener("pointermove", moveTooltip);
    els.roadmap.appendChild(card);

    if (!hasMetaBars(unit)) return;

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
      const label = document.createElement("span");
      label.className = "bar-label";
      label.textContent = `${unit.name} - ${metaStatus(segment.statusId).label}`;
      const left = document.createElement("span");
      left.className = "handle left";
      left.dataset.handle = "left";
      const right = document.createElement("span");
      right.className = "handle right";
      right.dataset.handle = "right";
      bar.append(label, left, right);
      bar.addEventListener("pointerdown", (event) => beginDragBar(event, unit.id, segment.id));
      bar.addEventListener("click", (event) => { event.stopPropagation(); select(unit.id, segment.id); });
      bar.addEventListener("contextmenu", (event) => openUnitContextMenu(event, unit.id, segment.id));
      bar.addEventListener("dblclick", (event) => { event.stopPropagation(); openUnitContextMenu(event, unit.id, segment.id); });
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
  if (t === "buff") return "buff";
  if (t === "core") return "core";
  if (t === "tech") return "tech";
  if (t === "def") return "def";
  if (t === "sub") return "sub";
  if (t === "cb") return "cb";
  if (t === "must p5" || t === "must-p5") return "must-p5";
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
  if (selectedSegmentId && !unit.segments.some(s => s.id === selectedSegmentId)) selectedSegmentId = null;
  const segment = selectedSegmentId ? selectedSegment(unit) : (unit.segments[0] || null);
  const f = els.editForm.elements;
  f.name.value = unit.name;
  f.icon.value = unit.icon;
  f.kind.value = unit.kind;
  f.tier.value = unit.tier;
  if (f.rowOffset) f.rowOffset.value = String(normalizeRowOffset(unit.rowOffset));
  f.week.max = String(weekCount());
  f.week.value = unit.week;
  f.lane.value = unit.lane;
  els.editForm.querySelectorAll(".meta-editor").forEach(node => node.classList.toggle("hidden", isPilot(unit)));
  f.segment.innerHTML = unit.segments.length
    ? unit.segments.map((s, i) => `<option value="${s.id}">Segment ${i + 1}: ${escapeHtml(formatWeekRange(s.start, s.end))} · ${escapeHtml(metaStatus(s.statusId).label)}</option>`).join("")
    : `<option value="">No meta bars</option>`;
  if (segment) f.segment.value = segment.id;
  f.segment.disabled = !unit.segments.length;
  f.metaStart.max = String(weekCount());
  f.metaEnd.max = String(weekCount());
  f.metaStart.value = segment?.start || unit.week;
  f.metaEnd.value = segment?.end || unit.week;
  buildMetaStatusSelect();
  f.metaStatus.value = segment?.statusId || defaultMetaStatusId();
  f.metaStart.disabled = !segment;
  f.metaEnd.disabled = !segment;
  f.metaStatus.disabled = !segment;
  f.tags.value = unit.tags.join(", ");
  f.note.value = unit.note;
  document.getElementById("btnDeleteSegment").disabled = !segment;
  renderTagPreview();
}

function applyForm(options = {}) {
  const unit = getSelected();
  if (!unit) return;
  const f = els.editForm.elements;
  unit.name = sanitizeText(f.name.value) || "Unnamed Unit";
  unit.icon = f.icon.value.trim();
  unit.kind = f.kind.value;
  unit.tier = f.tier.value;
  unit.rowOffset = normalizeRowOffset(f.rowOffset?.value ?? unit.rowOffset);
  unit.week = normalizeWeek(f.week.value);
  unit.lane = normalizeLane(f.lane.value);
  unit.tags = cleanTags(f.tags.value.split(","));
  unit.note = f.note.value.trim();
  const segment = selectedSegment(unit);
  if (segment && hasMetaBars(unit)) {
    segment.start = normalizeWeek(f.metaStart.value);
    segment.end = normalizeWeek(f.metaEnd.value);
    if (segment.end < segment.start) [segment.start, segment.end] = [segment.end, segment.start];
    segment.statusId = f.metaStatus.value;
  }
  unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const tier of getTiers()) reflowLanes(tier.id);
  syncPilotLanes();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function bindAutoApplyForm() {
  const immediateNames = new Set(["kind", "tier", "rowOffset", "week", "lane", "segment", "metaStart", "metaEnd", "metaStatus", "tags"]);
  els.editForm.querySelectorAll("input, select, textarea").forEach(input => {
    if (input.name === "segment") return;
    const handler = () => scheduleAutoApply(immediateNames.has(input.name) ? 40 : 420);
    input.addEventListener("input", handler);
    input.addEventListener("change", handler);
  });
}
function scheduleAutoApply(delay = 250) {
  if (!getSelected() || els.editForm.classList.contains("hidden")) return;
  clearTimeout(autoApplyTimer);
  autoApplyTimer = setTimeout(() => {
    const active = document.activeElement;
    const name = active?.form === els.editForm ? active.name : null;
    const start = typeof active?.selectionStart === "number" ? active.selectionStart : null;
    const end = typeof active?.selectionEnd === "number" ? active.selectionEnd : null;
    applyForm({ auto: true });
    if (name) {
      const next = els.editForm.elements[name];
      if (next && typeof next.focus === "function") {
        next.focus({ preventScroll: true });
        if (start !== null && typeof next.setSelectionRange === "function") next.setSelectionRange(start, end ?? start);
      }
    }
  }, delay);
}

function addSegmentToSelected(startOverride = null, statusOverride = null) {
  const unit = getSelected();
  if (!unit) return;
  const desiredWeek = startOverride ? normalizeWeek(startOverride) : null;
  let segment;
  if (desiredWeek) segment = smartAddSegmentAtWeek(unit, desiredWeek, statusOverride);
  else {
    const maxEnd = unit.segments.length ? Math.max(...unit.segments.map(s => s.end)) : 0;
    const start = maxEnd && maxEnd < weekCount() ? maxEnd + 1 : normalizeWeek(unit.week);
    segment = addNonOverlappingSegment(unit, start, statusOverride || defaultMetaStatusId());
  }
  if (!segment) return;
  selectedId = unit.id;
  selectedSegmentId = segment.id;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function addNonOverlappingSegment(unit, week, statusId = defaultMetaStatusId()) {
  const start = normalizeWeek(week);
  const next = unit.segments.filter(s => s.start > start).sort((a, b) => a.start - b.start)[0];
  const previous = unit.segments.filter(s => s.end < start).sort((a, b) => b.end - a.end)[0];
  const minStart = previous ? previous.end + 1 : 1;
  const maxEnd = next ? next.start - 1 : weekCount();
  if (start < minStart || start > maxEnd) return null;
  const end = Math.min(maxEnd, start + 3);
  const segment = { id: crypto.randomUUID(), start, end, statusId };
  unit.segments.push(segment);
  unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
  return segment;
}
function smartAddSegmentAtWeek(unit, week, statusId = null) {
  const w = normalizeWeek(week);
  const current = unit.segments.find(s => s.start <= w && s.end >= w);
  if (current) {
    const newStatus = statusId || current.statusId;
    if (current.start < w && w < current.end) {
      const left = { id: crypto.randomUUID(), start: current.start, end: w, statusId: newStatus };
      current.start = w + 1;
      unit.segments.push(left);
      unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
      return left;
    }
    if (w === current.start && current.end > current.start) {
      const one = { id: crypto.randomUUID(), start: w, end: w, statusId: newStatus };
      current.start = w + 1;
      unit.segments.push(one);
      unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
      return one;
    }
    if (w === current.end && current.end > current.start) {
      const one = { id: crypto.randomUUID(), start: w, end: w, statusId: newStatus };
      current.end = w - 1;
      unit.segments.push(one);
      unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
      return one;
    }
    current.statusId = statusId || current.statusId;
    return current;
  }
  return addNonOverlappingSegment(unit, w, statusId || defaultMetaStatusId());
}

function deleteSelectedSegment() {
  const unit = getSelected();
  if (!unit || !unit.segments.length) return;
  const segmentId = selectedSegment(unit)?.id;
  if (!segmentId) return;
  unit.segments = unit.segments.filter(s => s.id !== segmentId);
  selectedSegmentId = unit.segments[0]?.id || null;
  for (const tier of getTiers()) reflowLanes(tier.id);
  syncPilotLanes();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function laneAvailable(tier, lane, segments, excludeId = null) {
  for (const unit of state.units) {
    if (!hasMetaBars(unit) || unit.id === excludeId || unit.tier !== tier || unit.lane !== lane) continue;
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
  const anchor = getSelected() || state.units[state.units.length - 1] || null;
  const tier = partial.tier || anchor?.tier || "must";
  const releaseWeek = normalizeWeek(partial.week ?? (anchor ? Math.min(weekCount(), anchor.week + 1) : 1));
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
    rowOffset: normalizeRowOffset(partial.rowOffset || 0),
    stackOrder: Number(partial.stackOrder) || 0,
    icon: partial.icon || "",
    tags: cleanTags(partial.tags || partial.badges || []),
    note: partial.note || "",
    segments
  };
  state.units.push(newUnit);
  reflowLanes(tier);
  syncPilotLanes();
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
  for (const tier of getTiers()) reflowLanes(tier.id);
  syncPilotLanes();
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
    originWeek: unit.week,
    originTier: unit.tier,
    originRowOffset: normalizeRowOffset(unit.rowOffset),
    originLane: unit.lane,
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
    const dragSize = iconSize(unit);
    const rawX = clamp(point.x - drag.offsetX, LEFT_W, baseChartWidth() - dragSize);
    const rawY = clamp(point.y - drag.offsetY, HEADER_H, baseChartHeight() - dragSize);
    drag.previewLeft = rawX;
    drag.previewTop = rawY;
    const oldTier = unit.tier;
    const oldOffset = normalizeRowOffset(unit.rowOffset);
    const placement = rowPlacementFromY(rawY + dragSize / 2);
    const nextWeek = idOfWeekFromX(rawX + dragSize / 2);
    unit.week = nextWeek;
    alignUnitSegmentsToReleaseWeek(unit);
    unit.tier = placement.tier;
    unit.rowOffset = placement.rowOffset;
    if (oldTier !== unit.tier || oldOffset !== unit.rowOffset) unit.lane = autoLaneFor(unit.tier, unit.segments, unit.id);
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
  const endedDrag = drag;
  if (endedDrag.type === "unit") finalizeUnitDrop(endedDrag);
  if (endedDrag.type === "unit" && endedDrag.didMove) ignoreNextUnitClick = true;
  suppressRoadmapClick = true;
  drag = null;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
  setTimeout(() => { if (suppressRoadmapClick) suppressRoadmapClick = false; }, 0);
}
function finalizeUnitDrop(endedDrag) {
  const unit = state.units.find(u => u.id === endedDrag.id);
  if (!unit) return;
  const displaced = hasMetaBars(unit)
    ? state.units.find(other => hasMetaBars(other) && other.id !== unit.id && other.tier === unit.tier && other.week === unit.week && normalizeRowOffset(other.rowOffset) === normalizeRowOffset(unit.rowOffset))
    : null;
  if (displaced) {
    displaced.week = normalizeWeek(endedDrag.originWeek);
    alignUnitSegmentsToReleaseWeek(displaced);
    displaced.tier = endedDrag.originTier;
    displaced.rowOffset = normalizeRowOffset(endedDrag.originRowOffset ?? 0);
    // Preserve the dragged unit's lane, so its meta bar stays visually attached to the unit being moved.
    // Only reassign the displaced unit when it would collide in its new slot.
    if (displaced.lane === unit.lane || !laneAvailable(displaced.tier, displaced.lane, displaced.segments, displaced.id)) {
      displaced.lane = autoLaneFor(displaced.tier, displaced.segments, displaced.id);
    }
  }
  reflowLanes(unit.tier);
  if (endedDrag.originTier !== unit.tier) reflowLanes(endedDrag.originTier);
  syncPilotLanes();
}
function reflowLanes(tierId) {
  const units = state.units
    .filter(u => u.tier === tierId && hasVisibleMetaSegments(u))
    .sort((a, b) => normalizeWeek(a.week) - normalizeWeek(b.week)
      || normalizeRowOffset(a.rowOffset) - normalizeRowOffset(b.rowOffset)
      || a.name.localeCompare(b.name));
  units.forEach((unit, index) => { unit.lane = index + 1; });
}
function alignUnitSegmentsToReleaseWeek(unit) {
  if (!unit || !hasMetaBars(unit) || !Array.isArray(unit.segments) || !unit.segments.length) return;
  const earliestStart = Math.min(...unit.segments.map(segment => normalizeWeek(segment.start)));
  const deltaWeeks = normalizeWeek(unit.week) - earliestStart;
  if (!deltaWeeks) return;
  const totalWeeks = weekCount();
  for (const segment of unit.segments) {
    const start = normalizeWeek(segment.start);
    const end = normalizeWeek(segment.end);
    const span = Math.max(0, end - start);
    const maxStart = Math.max(1, totalWeeks - span);
    const nextStart = clamp(start + deltaWeeks, 1, maxStart);
    segment.start = nextStart;
    segment.end = nextStart + span;
  }
  unit.segments.sort((a, b) => a.start - b.start || a.end - b.end);
}
function compactLanes(tierId) { reflowLanes(tierId); syncPilotLanes(); }
function syncPilotLanes() {
  for (const pilot of state.units.filter(isPilot)) {
    const ms = pairedMsForPilot(pilot);
    if (ms) pilot.lane = ms.lane;
  }
}
function pairedMsForPilot(pilot) {
  if (!isPilot(pilot)) return null;
  const sameWeek = state.units.filter(unit => isMs(unit) && normalizeWeek(unit.week) === normalizeWeek(pilot.week));
  if (!sameWeek.length) return null;
  return sameWeek
    .sort((a, b) => {
      const aExact = sameVisualSlot(a, pilot) ? 1 : 0;
      const bExact = sameVisualSlot(b, pilot) ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      const aTier = a.tier === pilot.tier ? 1 : 0;
      const bTier = b.tier === pilot.tier ? 1 : 0;
      if (aTier !== bTier) return bTier - aTier;
      const aDistance = Math.abs(tierIndex(a.tier) + normalizeRowOffset(a.rowOffset) - (tierIndex(pilot.tier) + normalizeRowOffset(pilot.rowOffset)));
      const bDistance = Math.abs(tierIndex(b.tier) + normalizeRowOffset(b.rowOffset) - (tierIndex(pilot.tier) + normalizeRowOffset(pilot.rowOffset)));
      return aDistance - bDistance || visualStackRank(a) - visualStackRank(b) || a.name.localeCompare(b.name);
    })[0] || null;
}
function metaOwnerForUnit(unit) {
  if (!unit) return null;
  return isPilot(unit) ? (pairedMsForPilot(unit) || null) : unit;
}

function laneAtPointY(y, tierId) {
  const count = visibleLaneCount(tierId);
  for (let lane = 1; lane <= count; lane++) {
    const top = laneY(tierId, lane) - Math.max(5, (BAR_GAP - BAR_H) / 2);
    const bottom = laneY(tierId, lane) + BAR_H + Math.max(5, (BAR_GAP - BAR_H) / 2);
    if (y >= top && y <= bottom) return lane;
  }
  return null;
}
function unitForLane(tierId, lane) {
  return state.units.find(unit => hasVisibleMetaSegments(unit) && unit.tier === tierId && unit.lane === lane) || null;
}
function isEditableChartTarget(event) {
  return event.target.closest(".unit-card,.meta-bar,.month-head,.tier-label,.context-menu");
}
function openChartContextMenu(event, options = {}) {
  if (isEditableChartTarget(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const point = chartPoint(event);
  if (point.y < HEADER_H || point.x < LEFT_W) return;
  const placement = rowPlacementFromY(point.y);
  const tier = placement.tier;
  const rowOffset = placement.rowOffset;
  const week = idOfWeekFromX(point.x);
  const lane = laneAtPointY(point.y, tier);
  const laneUnit = lane ? unitForLane(tier, lane) : null;
  const selectedUnit = getSelected();
  const items = [];

  if (laneUnit) {
    items.push({ label: `Add/split segment for ${laneUnit.name} at ${formatWeek(week)}`, action: () => addSegmentAtWeek(laneUnit.id, week) });
    items.push({ label: `Select ${laneUnit.name}`, action: () => select(laneUnit.id, null) });
  }

  if (selectedUnit) {
    const selectedMetaOwner = metaOwnerForUnit(selectedUnit);
    if (selectedMetaOwner && (!laneUnit || laneUnit.id !== selectedMetaOwner.id)) {
      const label = selectedMetaOwner.id === selectedUnit.id ? `Add segment to selected: ${selectedUnit.name}` : `Add segment to same-week MS: ${selectedMetaOwner.name}`;
      items.push({ label, action: () => addSegmentAtWeek(selectedMetaOwner.id, week) });
    }
    if (!laneUnit || laneUnit.id !== selectedUnit.id) items.push({ label: `Move selected here`, action: () => moveSelectedUnitTo(tier, week, rowOffset) });
  }

  items.push({ label: `Add blank unit at ${formatWeek(week)}`, action: () => addUnit({ name: "New Unit", tier, week, rowOffset }) });
  showContextMenu(event.clientX, event.clientY, items);
}
function moveSelectedUnitTo(tier, week, rowOffset = 0) {
  const unit = getSelected();
  if (!unit) return;
  const oldTier = unit.tier;
  unit.tier = tier;
  unit.rowOffset = normalizeRowOffset(rowOffset);
  unit.week = normalizeWeek(week);
  alignUnitSegmentsToReleaseWeek(unit);
  unit.lane = autoLaneFor(unit.tier, unit.segments, unit.id);
  reflowLanes(oldTier);
  reflowLanes(unit.tier);
  syncPilotLanes();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function openUnitContextMenu(event, unitId, segmentId = null) {
  event.preventDefault();
  event.stopPropagation();
  select(unitId, segmentId);
  const point = chartPoint(event);
  const week = idOfWeekFromX(point.x);
  const unit = state.units.find(u => u.id === unitId);
  const metaOwner = metaOwnerForUnit(unit);
  const items = [];
  if (metaOwner) {
    const label = metaOwner.id === unitId ? `Add/split segment at ${formatWeek(week)}` : `Add/split same-week MS segment at ${formatWeek(week)}`;
    items.push({ label, action: () => addSegmentAtWeek(metaOwner.id, week) });
  }
  items.push(
    { label: "Rename unit…", action: () => renameUnit(unitId) },
    { label: "Edit note…", action: () => editUnitNote(unitId) },
    { label: "Edit tags…", action: () => editUnitTags(unitId) },
    { label: "Row position", children: [
      { label: `${normalizeRowOffset(unit?.rowOffset) === -0.5 ? "✓ " : ""}${rowOffsetLabel(-0.5, unit?.tier)}`, action: () => setUnitRowOffset(unitId, -0.5) },
      { label: `${normalizeRowOffset(unit?.rowOffset) === 0 ? "✓ " : ""}In row`, action: () => setUnitRowOffset(unitId, 0) },
      { label: `${normalizeRowOffset(unit?.rowOffset) === 0.5 ? "✓ " : ""}${rowOffsetLabel(0.5, unit?.tier)}`, action: () => setUnitRowOffset(unitId, 0.5) }
    ] },
    { label: "Toggle tag", children: TAG_OPTIONS.map(tag => ({ label: `${unit?.tags?.some(t => t.toLowerCase() === tag.toLowerCase()) ? "✓ " : ""}${tag}`, action: () => toggleUnitTag(unitId, tag) })) }
  );
  if (segmentId && hasMetaBars(unit)) {
    items.push({
      label: "Change meta status",
      children: getStatuses().map(status => ({
        label: `${status.label}`,
        swatch: status.color,
        action: () => setSegmentStatus(unitId, segmentId, status.id)
      }))
    });
    items.push({ label: "Delete this segment", action: () => { selectedId = unitId; selectedSegmentId = segmentId; deleteSelectedSegment(); } });
  }
  items.push({ label: "Delete unit", danger: true, action: () => { selectedId = unitId; deleteSelected(); } });
  showContextMenu(event.clientX, event.clientY, items);
}
function showContextMenu(clientX, clientY, items) {
  const menu = els.contextMenu;
  menu.innerHTML = "";
  menu.style.maxHeight = "";
  menu.style.overflow = "visible";
  menu.style.left = "0px";
  menu.style.top = "0px";
  items.forEach(item => menu.appendChild(contextMenuItem(item)));
  menu.classList.remove("hidden");
  positionMenuInViewport(menu, clientX, clientY);
}
function positionMenuInViewport(menu, clientX, clientY) {
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
  const left = clamp(clientX, margin, maxLeft);
  const top = clamp(clientY, margin, maxTop);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
function contextMenuItem(item) {
  if (item.children?.length) {
    const wrap = document.createElement("div");
    wrap.className = "context-submenu-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "has-submenu";
    btn.innerHTML = `<span>${escapeHtml(item.label)}</span><span class="chevron">›</span>`;
    const sub = document.createElement("div");
    sub.className = "context-submenu";
    item.children.forEach(child => sub.appendChild(contextMenuItem(child)));
    wrap.addEventListener("mouseenter", () => positionSubmenu(wrap, sub));
    wrap.addEventListener("focusin", () => positionSubmenu(wrap, sub));
    wrap.append(btn, sub);
    return wrap;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  if (item.swatch) btn.innerHTML = `<i class="menu-swatch" style="background:${item.swatch}"></i><span>${escapeHtml(item.label)}</span>`;
  else btn.textContent = item.label;
  if (item.danger) btn.className = "danger";
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    hideContextMenu();
    item.action();
  });
  return btn;
}
function positionSubmenu(wrap, sub) {
  const margin = 8;
  sub.classList.remove("open-left");
  wrap.classList.remove("open-left");
  sub.style.top = "-6px";
  sub.style.visibility = "hidden";
  sub.style.display = "block";
  const wrapRect = wrap.getBoundingClientRect();
  let subRect = sub.getBoundingClientRect();
  if (wrapRect.right + 6 + subRect.width > window.innerWidth - margin) {
    sub.classList.add("open-left");
    wrap.classList.add("open-left");
  }
  let top = -6;
  let actualTop = wrapRect.top + top;
  if (actualTop + subRect.height > window.innerHeight - margin) {
    top -= (actualTop + subRect.height) - (window.innerHeight - margin);
  }
  actualTop = wrapRect.top + top;
  if (actualTop < margin) top += margin - actualTop;
  sub.style.top = `${Math.round(top)}px`;
  sub.style.visibility = "";
  sub.style.display = "";
}
function hideContextMenu() {
  if (!els.contextMenu) return;
  els.contextMenu.classList.add("hidden");
  els.contextMenu.innerHTML = "";
}
function addSegmentAtWeek(unitId, week) {
  const requested = state.units.find(u => u.id === unitId);
  const unit = metaOwnerForUnit(requested);
  if (!unit || !hasMetaBars(unit)) {
    setStatus("Pilots are tied to an MS. Add or select an MS in the same week first.");
    return;
  }
  selectedId = unit.id;
  addSegmentToSelected(week);
  setStatus(`Added/split segment for ${unit.name} at ${formatWeek(week)}.`);
}
function setSegmentStatus(unitId, segmentId, statusId) {
  const unit = state.units.find(u => u.id === unitId);
  const segment = unit?.segments.find(s => s.id === segmentId);
  if (!unit || !segment) return;
  segment.statusId = statusId;
  selectedId = unitId;
  selectedSegmentId = segmentId;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function renameUnit(unitId) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  const value = prompt("Rename unit:", unit.name);
  if (value === null) return;
  unit.name = sanitizeText(value) || unit.name;
  selectedId = unit.id;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function editUnitNote(unitId) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  const value = prompt("Edit note:", unit.note || "");
  if (value === null) return;
  unit.note = value.trim();
  selectedId = unit.id;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function editUnitTags(unitId) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  const value = prompt("Edit tags, separated by commas:", cleanTags(unit.tags).join(", "));
  if (value === null) return;
  unit.tags = cleanTags(value.split(","));
  selectedId = unit.id;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function toggleUnitTag(unitId, tag) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  const lower = tag.toLowerCase();
  const has = unit.tags.some(t => t.toLowerCase() === lower);
  unit.tags = cleanTags(has ? unit.tags.filter(t => t.toLowerCase() !== lower) : [...unit.tags, tag]);
  selectedId = unit.id;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function setUnitRowOffset(unitId, offset) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  unit.rowOffset = normalizeRowOffset(offset);
  selectedId = unit.id;
  selectedSegmentId = null;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
  setStatus(`${unit.name} row position: ${rowOffsetLabel(unit.rowOffset, unit.tier)}.`);
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
  els.roadmap.style.setProperty("--textBoost", legibleTextScale().toFixed(3));
  els.roadmap.style.setProperty("--barTextBoost", barLabelTextScale().toFixed(3));
  const gridLinePx = clamp(1 / zoomScale, 1, 2.2);
  els.roadmap.style.setProperty("--gridLine", `${gridLinePx.toFixed(2)}px`);
  els.roadmap.style.setProperty("--monthGridLine", `${(gridLinePx * 2).toFixed(2)}px`);
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
    chip.setAttribute("aria-label", `Remove ${tag}`);
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
  const payload = { v: 4, updated: new Date().toISOString(), months: state.months, monthWeeks: getMonthWeeks(), tiers: state.tiers, metaStatuses: state.metaStatuses, units: state.units };
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
    for (const unit of state.units) if (hasVisibleMetaSegments(unit)) for (const segment of unit.segments) drawBarToCanvas(ctx, unit, segment);
    for (const unit of state.units) await drawUnitToCanvas(ctx, unit);
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
  ctx.font = canvasFont(900, 18);
  ctx.fillStyle = "#eef3fb";
  const monthWeeks = getMonthWeeks();
  state.months.forEach((month, i) => {
    const x = weekX(monthStartWeek(i));
    ctx.fillText(month.toUpperCase(), x + monthWeeks[i] * CELL_W / 2, MONTH_H / 2);
  });
  ctx.font = canvasFont(900, 14);
  ctx.fillStyle = "#dce4f0";
  for (let w = 1; w <= weekCount(); w++) {
    const { weekInMonth } = weekToMonthWeek(w);
    ctx.fillText(`W${weekInMonth}`, weekX(w) + CELL_W / 2, MONTH_H + WEEK_H / 2);
  }

  ctx.textAlign = "left";
  ctx.font = canvasFont(900, 16);
  getTiers().forEach((tier) => {
    ctx.fillStyle = tier.color;
    ctx.fillText(tier.label.toUpperCase(), 22, tierY(tier.id) + tierHeight(tier.id) / 2);
  });

  const monthBoundaries = new Set([0]);
  getMonthWeeks().reduce((sum, weeks) => {
    const next = sum + weeks;
    monthBoundaries.add(next);
    return next;
  }, 0);
  for (let w = 0; w <= weekCount(); w++) {
    const x = LEFT_W + w * CELL_W;
    const isMonthBoundary = monthBoundaries.has(w);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, isMonthBoundary ? 0 : HEADER_H);
    ctx.lineTo(x + 0.5, height);
    ctx.strokeStyle = isMonthBoundary ? "rgba(255,255,255,.22)" : "rgba(255,255,255,.14)";
    ctx.lineWidth = isMonthBoundary ? 2 : 1;
    ctx.stroke();
  }
  ctx.lineWidth = 1;
  getTiers().forEach((tier) => {
    const y = tierY(tier.id);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.stroke();
  });

  getTiers().forEach(tier => {
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
  const size = iconSize(unit);
  const radius = size < 140 ? 10 : 12;
  const plateH = size < 140 ? 38 : 58;
  ctx.save();
  roundedRect(ctx, x, y, size, size, radius);
  ctx.clip();
  const img = await loadImageForCanvas(unit.icon);
  if (img) coverImage(ctx, img, x, y, size, size);
  else drawPlaceholder(ctx, unit.name, x, y, size, size);
  const grad = ctx.createLinearGradient(0, y + size - plateH, 0, y + size);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.35, "rgba(0,0,0,.78)");
  grad.addColorStop(1, "rgba(0,0,0,.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y + size - plateH, size, plateH);
  ctx.fillStyle = "#ffffff";
  ctx.font = canvasFont(800, size < 140 ? 9.5 : 12);
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  wrapText(ctx, unit.name, x + 8, y + size - 7, size - 16, fontPx(size < 140 ? 11 : 14), size < 140 ? 1 : 2);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,.25)";
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, radius);
  ctx.stroke();
  drawIconTagBordersToCanvas(ctx, unit, x, y, size, radius);
  drawTagsToCanvas(ctx, unit.tags, x, y, size);
}
function drawIconTagBordersToCanvas(ctx, unit, x, y, size, radius) {
  const rings = [];
  if (hasMustP5(unit)) rings.push({ color: "#ff3b4d", alpha: "rgba(255,59,77,.28)" });
  if (hasBuff(unit)) rings.push({ color: "#43dc7d", alpha: "rgba(67,220,125,.24)" });
  rings.forEach((ring, i) => {
    const inset = 2 + i * 5;
    const line = size < 140 ? 4 : 5;
    ctx.save();
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = line;
    roundedRect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, Math.max(6, radius - i * 2));
    ctx.stroke();
    ctx.strokeStyle = ring.alpha;
    ctx.lineWidth = line + 3;
    roundedRect(ctx, x + inset, y + inset, size - inset * 2, size - inset * 2, Math.max(6, radius - i * 2));
    ctx.stroke();
    ctx.restore();
  });
}
function drawTagsToCanvas(ctx, tags, x, y, size = ICON_W) {
  const clean = cleanTags(tags).slice(0, MAX_TAGS);
  const boost = legibleTextScale();
  const compact = size < 140;
  const tagScale = compact ? 0.82 : 1;
  const right = x + size - 7 * tagScale;
  const top = y + 7 * tagScale;
  const h = 17 * boost * tagScale;
  const rowGap = 4 * boost * tagScale;
  const colGap = 2 * boost * tagScale;
  ctx.font = canvasFont(900, compact ? 8.5 : 10);
  const widths = clean.map(tag => Math.ceil(ctx.measureText(String(tag)).width) + 12 * boost * tagScale);
  const isTwoCol = clean.length > TAGS_PER_COLUMN;
  const rightCount = isTwoCol ? TAGS_PER_COLUMN : clean.length;
  const rightColW = isTwoCol ? Math.max(0, ...widths.slice(0, rightCount)) : 0;
  clean.forEach((tag, i) => {
    const inRightCol = !isTwoCol || i < rightCount;
    const row = inRightCol ? i : i - rightCount;
    const w = widths[i];
    const colRight = inRightCol ? right : right - rightColW - colGap;
    const bx = colRight - w;
    const by = top + row * (h + rowGap);
    roundedRect(ctx, bx, by, w, h, 8 * boost * tagScale);
    ctx.fillStyle = tagBg(tag);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.52)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tag), bx + w / 2, by + h / 2 + 0.5);
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
  ctx.save();
  ctx.clip();
  const text = `${unit.name} - ${metaStatus(segment.statusId).label}`;
  ctx.globalAlpha = 1;
  ctx.font = canvasBarFont(950, 12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, barFontPx(12) * 0.16);
  ctx.strokeStyle = "rgba(0,0,0,.72)";
  ctx.strokeText(text, x + w / 2, y + BAR_H / 2 + 0.5, Math.max(20, w - 14));
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + w / 2, y + BAR_H / 2 + 0.5, Math.max(20, w - 14));
  ctx.restore();
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
  ctx.font = canvasFont(900, 36);
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
  if (t === "buff") return "rgba(67,220,125,.92)";
  if (t === "core") return "rgba(247,180,53,.9)";
  if (t === "tech") return "rgba(171,108,255,.88)";
  if (t === "def") return "rgba(86,218,150,.88)";
  if (t === "sub") return "rgba(79,214,190,.88)";
  if (t === "cb") return "rgba(255,140,72,.9)";
  if (t === "must p5" || t === "must-p5") return "rgba(255,43,66,.94)";
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
  const pairedMs = isPilot(unit) ? pairedMsForPilot(unit) : null;
  const metaUnit = hasMetaBars(unit) ? unit : pairedMs;
  const title = pairedMs ? `${unit.name} (${pairedMs.name})` : unit.name;
  tooltipEl = document.createElement("div");
  tooltipEl.className = "tooltip";
  const activeId = metaUnit ? (segment?.id || selectedSegment(metaUnit)?.id || null) : null;
  const segmentsHtml = metaUnit ? segmentListHtml(metaUnit, activeId) : "";
  const mustP5Html = hasMustP5(unit) ? `<div class="tooltip-must-p5">Must P5</div>` : "";
  const buffHtml = hasBuff(unit) ? `<div class="tooltip-buff">Buff</div>` : "";
  const rowLabel = normalizeRowOffset(unit.rowOffset) ? rowOffsetLabel(unit.rowOffset, unit.tier) : tierById(unit.tier).label;
  const tagHtml = unit.tags.length ? `<div class="tooltip-tags">Tags: ${unit.tags.map(tag => `<span class="tooltip-tag ${tagClass(tag)}">${escapeHtml(tag)}</span>`).join(" ")}</div>` : "";
  tooltipEl.innerHTML = `<strong>${escapeHtml(title)}</strong><div>${escapeHtml(rowLabel)} · ${escapeHtml(formatWeek(unit.week))}</div>${mustP5Html}${buffHtml}${segmentsHtml}${tagHtml}${unit.note ? `<p>${escapeHtml(unit.note)}</p>` : ""}`;
  document.body.appendChild(tooltipEl);
  moveTooltip(event);
}
function segmentListHtml(unit, activeSegmentId = null) {
  const segments = (unit.segments || []).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  if (!segments.length) return "";
  const rows = segments.map(seg => {
    const status = metaStatus(seg.statusId);
    const active = activeSegmentId === seg.id ? " active" : "";
    return `<div class="tooltip-segment${active}"><i style="background:${escapeHtml(status.color)}"></i><span>${escapeHtml(formatWeekRange(seg.start, seg.end))} · ${escapeHtml(status.label)}</span></div>`;
  }).join("");
  return `<div class="tooltip-segments"><div class="tooltip-segments-title">Meta segments</div>${rows}</div>`;
}
function moveTooltip(event) {
  if (!tooltipEl) return;
  tooltipEl.style.left = `${event.clientX + 14}px`;
  tooltipEl.style.top = `${event.clientY + 14}px`;
}
function hideTooltip() { tooltipEl?.remove(); tooltipEl = null; }
function escapeHtml(text) { return String(text || "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

init();
