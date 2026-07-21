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
  { id: "s1", label: "Human Rights", description: "", color: "#ff4b59" },
  { id: "s2", label: "Era-Defining", description: "", color: "#47a9ff" },
  { id: "s3", label: "Strong", description: "", color: "#67ef87" },
  { id: "s4", label: "Rotational", description: "", color: "#ffcc4d" },
  { id: "s5", label: "Situational", description: "", color: "#c18cff" }
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
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.6;
const ZOOM_BUTTON_STEP = 0.1;
const TIER_LABEL_ABBREVIATIONS = { human: "HR", must: "MP", ideal: "IP", luxury: "LP", skip: "S" };
const CARD_DETAILS_MIN_VISUAL_SIZE = 56;
const CARD_TAGS_MIN_BOTTOM_GAP = 2;
const CARD_NAME_MIN_VISUAL_SIZE = 72;
const CARD_NAME_MIN_TAG_GAP = 8;
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
const BETWEEN_PAIR_GAP = 8;
const WIDE_CELL_W = ICON_W * 2 + BETWEEN_PAIR_GAP + 24;
const BAR_TOP = 222;
const BAR_GAP = 23;
const BAR_H = 18;
const META_LINK_H = BAR_H;
const META_LINK_OVERLAP = 3;
const META_BAR_EDGE_INSET = 6;
const META_LABEL_MIN_RENDERED_HEIGHT = 9;
const BAR_BOTTOM_PAD = 34;
const STORAGE_KEY = "gundam-u-c-e-roadmap-builder-v1";
const ZOOM_STORAGE_KEY = "gundam-u-c-e-roadmap-builder-zoom-v2";

const DEFAULT_ROADMAP = {
  updated: new Date().toISOString(),
  months: [...DEFAULT_MONTHS],
  tiers: structuredClone(DEFAULT_TIERS),
  metaStatuses: structuredClone(DEFAULT_META_STATUSES),
  tagDescriptions: {},
  monthWeeks: DEFAULT_MONTHS.map(() => 4),
  units: []
};

let state = structuredClone(DEFAULT_ROADMAP);
let catalog = [];
let catalogIconIndex = new Map();
let catalogKindNameIndex = new Map();
let selectedId = null;
let selectedSegmentId = null;
let filterKind = "all";
let searchTerm = "";
let tooltipEl = null;
let tooltipPinned = false;
let tooltipAnchorEl = null;
let appTooltipEl = null;
let appTooltipAnchorEl = null;
let drag = null;
let panDrag = null;
let suppressRoadmapClick = false;
let lastUnitClick = { id: null, at: 0 };
let metaOwnerHoverId = null;
let metaOwnerHighlightedId = null;
let metaFocusDimmerEl = null;
let profileOpenTimer = null;
let unitProfileOverlay = null;
let profileReturnFocus = null;
let unitNoteReaderOverlay = null;
let unitNoteReaderReturnFocus = null;
let unitProfileOverflowObserver = null;
let unitProfileLayoutObserver = null;
let autoApplyTimer = null;
let editFormDirty = false;
let editDialogSavePending = false;
let zoomScale = Number(localStorage.getItem(ZOOM_STORAGE_KEY) || "1") || 1;

function createLayoutGeometryCache() {
  return {
    slotLayouts: new Map(),
    visibleLaneCounts: new Map(),
    maxIconStackHeights: new Map(),
    dynamicBarTops: new Map(),
    betweenSafeHeights: new Map(),
    tierHeights: new Map(),
    tierYs: new Map(),
    iconXs: new Map(),
    iconYs: new Map(),
    iconRects: new Map(),
    slotGroups: new Map(),
    segmentHorizontalRects: new Map(),
    segmentBarRects: new Map(),
    laneOwners: new Map(),
    cardRectsByLeft: null,
    betweenSafeComputed: false,
    wideWeeks: null,
    weekBoundaryXs: null,
    baseChartHeight: null
  };
}
let layoutGeometryCache = createLayoutGeometryCache();
let roadmapImageReuseCache = new Map();
function invalidateLayoutGeometryCache() {
  layoutGeometryCache = createLayoutGeometryCache();
}
function captureRoadmapImagesForRender() {
  const next = new Map();
  els.roadmap?.querySelectorAll(".unit-card[data-id] > img").forEach(img => {
    const unitId = img.parentElement?.dataset?.id;
    if (unitId) next.set(unitId, img);
  });
  roadmapImageReuseCache = next;
}
function reusableRoadmapImage(unit) {
  if (!unit?.icon) return null;
  const img = roadmapImageReuseCache.get(unit.id);
  roadmapImageReuseCache.delete(unit.id);
  if (!img || img.getAttribute("src") !== unit.icon) return null;
  img.alt = unit.name;
  img.crossOrigin = "anonymous";
  return img;
}

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
  unitEditDialog: document.getElementById("unitEditDialog"),
  unitEditDialogBody: document.getElementById("unitEditDialogBody"),
  contextMenu: document.getElementById("contextMenu")
};

let editFormHomeParent = null;
let editFormHomeNextSibling = null;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function legibleTextScale(scale = zoomScale) {
  const normalized = clamp(Number(scale) || 1, MIN_ZOOM, MAX_ZOOM);
  return clamp(Math.pow(1 / normalized, 0.65), 1, 3);
}
function barLabelTextScale(scale = zoomScale) {
  const normalized = clamp(Number(scale) || 1, MIN_ZOOM, MAX_ZOOM);
  return clamp(Math.pow(1 / normalized, 0.9), 1, 3.4);
}
function parseHexColor(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || "").trim());
  if (!match) return null;
  const hex = match[1];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}
function relativeLuminance(rgb) {
  if (!rgb) return 0;
  const linear = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function metaBarTextPresentation(color) {
  const background = relativeLuminance(parseHexColor(color));
  const light = [248, 251, 255];
  const dark = [7, 13, 18];
  const lightContrast = (relativeLuminance(light) + 0.05) / (background + 0.05);
  const darkContrast = (background + 0.05) / (relativeLuminance(dark) + 0.05);
  return darkContrast > lightContrast
    ? { color: "#070d12", tone: "dark" }
    : { color: "#f8fbff", tone: "light" };
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
function wideWeekSet() {
  if (layoutGeometryCache.wideWeeks) return layoutGeometryCache.wideWeeks;
  const slots = new Map();
  const wideWeeks = new Set();
  for (const unit of state.units || []) {
    if (!normalizeRowOffset(unit.rowOffset)) continue;
    const rowKey = rowSlotKey(unit);
    if (!rowKey.startsWith("between:")) continue;
    const week = normalizeWeek(unit.week);
    const key = `${week}|${rowKey}`;
    const flags = slots.get(key) || 0;
    const next = flags | (isMs(unit) ? 1 : 0) | (isPilot(unit) ? 2 : 0);
    slots.set(key, next);
    if (next === 3) wideWeeks.add(week);
  }
  layoutGeometryCache.wideWeeks = wideWeeks;
  return wideWeeks;
}
function weekNeedsWideColumn(week) { return wideWeekSet().has(normalizeWeek(week)); }
function weekWidth(week) { return weekNeedsWideColumn(week) ? WIDE_CELL_W : CELL_W; }
function ensureWeekBoundaryXs() {
  if (layoutGeometryCache.weekBoundaryXs) return layoutGeometryCache.weekBoundaryXs;
  const total = weekCount();
  const boundaries = new Array(total + 1);
  boundaries[0] = LEFT_W;
  for (let week = 1; week <= total; week++) boundaries[week] = boundaries[week - 1] + weekWidth(week);
  layoutGeometryCache.weekBoundaryXs = boundaries;
  return boundaries;
}
function weekX(week) {
  const target = clamp(Math.round(Number(week) || 1), 1, weekCount());
  return ensureWeekBoundaryXs()[target - 1];
}
function weekBoundaryX(completedWeeks) {
  const count = clamp(Math.round(Number(completedWeeks) || 0), 0, weekCount());
  return ensureWeekBoundaryXs()[count];
}
function weekSpanWidth(start, end) {
  const first = Math.min(normalizeWeek(start), normalizeWeek(end));
  const last = Math.max(normalizeWeek(start), normalizeWeek(end));
  const boundaries = ensureWeekBoundaryXs();
  return boundaries[last] - boundaries[first - 1];
}
function monthPixelWidth(index) {
  const counts = getMonthWeeks();
  const start = monthStartWeek(index);
  let width = 0;
  for (let offset = 0; offset < (counts[index] || 0); offset++) width += weekWidth(start + offset);
  return width;
}
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
    if (upper && lower) return `${upper.label} / ${lower.label}`;
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
function normalizePotentialLevel(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), 0, 5) : null;
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
  const key = visualSlotKey(unit);
  const cached = layoutGeometryCache.slotGroups.get(key);
  if (cached) return cached;
  const group = (state.units || [])
    .filter(other => visualSlotKey(other) === key)
    .sort((a, b) => {
      const rankDiff = visualStackRank(a) - visualStackRank(b);
      if (rankDiff) return rankDiff;
      const orderDiff = (Number(a.stackOrder) || 0) - (Number(b.stackOrder) || 0);
      return orderDiff || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
  layoutGeometryCache.slotGroups.set(key, group);
  return group;
}
function isCompactBetweenSlot(group) {
  return group.length > 1
    && group.some(unit => normalizeRowOffset(unit.rowOffset))
    && group.some(isMs)
    && group.some(isPilot);
}
function slotSizeForUnit() { return ICON_W; }
function slotLayoutForGroup(group) {
  const compact = isCompactBetweenSlot(group);
  const layout = new Map();
  if (compact) {
    const leftColumn = group.filter(unit => !isPilot(unit));
    const rightColumn = group.filter(isPilot);
    const rightX = ICON_W + BETWEEN_PAIR_GAP;
    const leftHeight = leftColumn.length ? leftColumn.length * ICON_W + (leftColumn.length - 1) * ICON_STACK_GAP : 0;
    const rightHeight = rightColumn.length ? rightColumn.length * ICON_W + (rightColumn.length - 1) * ICON_STACK_GAP : 0;
    const groupHeight = Math.max(ICON_W, leftHeight, rightHeight);
    let leftY = Math.max(0, Math.round((groupHeight - leftHeight) / 2));
    let rightY = Math.max(0, Math.round((groupHeight - rightHeight) / 2));
    leftColumn.forEach((unit, index) => {
      layout.set(unit.id, { x: 0, y: leftY, size: ICON_W, z: group.length - index, index });
      leftY += ICON_W + ICON_STACK_GAP;
    });
    rightColumn.forEach((unit, index) => {
      const groupIndex = group.indexOf(unit);
      layout.set(unit.id, { x: rightX, y: rightY, size: ICON_W, z: group.length - groupIndex, index: groupIndex });
      rightY += ICON_W + ICON_STACK_GAP;
    });
    return {
      layout,
      groupHeight,
      groupWidth: ICON_W + BETWEEN_PAIR_GAP + ICON_W,
      compact
    };
  }

  let y = 0;
  group.forEach((unit, index) => {
    const size = slotSizeForUnit(unit, group);
    layout.set(unit.id, { x: 0, y, size, z: group.length - index, index });
    y += size + ICON_STACK_GAP;
  });
  return { layout, groupHeight: Math.max(ICON_W, y - ICON_STACK_GAP), groupWidth: ICON_W, compact };
}
function sameSlotOffset(unit) {
  if (!unit) return { x: 0, y: 0, z: 0, index: 0, count: 1, groupHeight: ICON_W, groupWidth: ICON_W, size: ICON_W, compact: false };
  const key = visualSlotKey(unit);
  let cached = layoutGeometryCache.slotLayouts.get(key);
  if (!cached) {
    const group = sameSlotGroup(unit);
    if (group.length <= 1) {
      cached = {
        byId: new Map([[unit.id, { x: 0, y: 0, z: 0, index: 0, count: 1, groupHeight: ICON_W, groupWidth: ICON_W, size: ICON_W, compact: false }]])
      };
    } else {
      const { layout, groupHeight, groupWidth, compact } = slotLayoutForGroup(group);
      const byId = new Map();
      group.forEach(member => {
        const slot = layout.get(member.id) || { x: 0, y: 0, z: 0, index: 0, size: ICON_W };
        byId.set(member.id, { ...slot, count: group.length, groupHeight, groupWidth, compact });
      });
      cached = { byId };
    }
    layoutGeometryCache.slotLayouts.set(key, cached);
  }
  return cached.byId.get(unit.id) || { x: 0, y: 0, z: 0, index: 0, count: 1, groupHeight: ICON_W, groupWidth: ICON_W, size: ICON_W, compact: false };
}
function iconSize(unit) { return sameSlotOffset(unit).size || ICON_W; }
function unitZIndex(unit, slot = sameSlotOffset(unit), isDragging = false) {
  if (isDragging) return 10000;
  const stack = Math.max(0, Number(unit?.stackOrder) || 0);
  const selectedBoost = selectedId === unit?.id && !selectedSegmentId ? 2 : 0;
  return 20 + stack * 2 + (slot?.z || 0) + selectedBoost;
}
function iconRect(unit) {
  if (!unit) return { left: 0, top: 0, right: 0, bottom: 0 };
  const cached = layoutGeometryCache.iconRects.get(unit.id);
  if (cached) return cached;
  const size = iconSize(unit);
  const left = iconX(unit);
  const top = iconY(unit);
  const rect = { left, top, right: left + size, bottom: top + size };
  layoutGeometryCache.iconRects.set(unit.id, rect);
  return rect;
}
function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function overlappingUnits(unit) {
  if (!unit) return [];
  const rect = iconRect(unit);
  return (state.units || []).filter(other => other.id !== unit.id && rectsOverlap(rect, iconRect(other)));
}
function bringUnitToFront(unitId, cardEl = null) {
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
  let normalizedStackOrders = false;
  if (maxOrder > 100000) {
    state.units
      .slice()
      .sort((a, b) => (Number(a.stackOrder) || 0) - (Number(b.stackOrder) || 0))
      .forEach((u, index) => { u.stackOrder = index; });
    maxOrder = Math.max(0, ...state.units.map(u => Number(u.stackOrder) || 0));
    normalizedStackOrders = true;
  }
  unit.stackOrder = maxOrder + 1;
  if (normalizedStackOrders) refreshUnitZIndices();
  else {
    const card = cardEl?.isConnected ? cardEl : els.roadmap?.querySelector?.(`.unit-card[data-id="${CSS.escape(unitId)}"]`);
    if (card) card.style.zIndex = String(unitZIndex(unit));
  }
}
function refreshUnitZIndices() {
  const unitsById = new Map((state.units || []).map(unit => [unit.id, unit]));
  els.roadmap?.querySelectorAll?.(".unit-card").forEach(card => {
    const unit = unitsById.get(card.dataset.id);
    if (!unit) return;
    card.style.zIndex = String(unitZIndex(unit));
  });
}
function slotGroupHeight(group) { return slotLayoutForGroup(group).groupHeight || ICON_W; }
function maxIconStackVisualHeight(tierId) {
  if (layoutGeometryCache.maxIconStackHeights.has(tierId)) return layoutGeometryCache.maxIconStackHeights.get(tierId);
  const seen = new Set();
  let maxHeight = ICON_W;
  for (const unit of state.units || []) {
    if (unit.tier !== tierId) continue;
    const key = visualSlotKey(unit);
    if (seen.has(key)) continue;
    seen.add(key);
    maxHeight = Math.max(maxHeight, sameSlotOffset(unit).groupHeight || ICON_W);
  }
  layoutGeometryCache.maxIconStackHeights.set(tierId, maxHeight);
  return maxHeight;
}
function dynamicBarTop(tierId) {
  if (layoutGeometryCache.dynamicBarTops.has(tierId)) return layoutGeometryCache.dynamicBarTops.get(tierId);
  const value = Math.max(BAR_TOP, ICON_TOP + maxIconStackVisualHeight(tierId) + 18);
  layoutGeometryCache.dynamicBarTops.set(tierId, value);
  return value;
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
  if (layoutGeometryCache.visibleLaneCounts.has(tierId)) return layoutGeometryCache.visibleLaneCounts.get(tierId);
  let maxLane = 0;
  for (const unit of state.units || []) {
    if (unit.tier !== tierId || !hasVisibleMetaSegments(unit)) continue;
    const lane = Number(unit.lane) || 0;
    maxLane = Math.max(maxLane, lane);
    layoutGeometryCache.laneOwners.set(`${tierId}|${lane}`, unit);
  }
  layoutGeometryCache.visibleLaneCounts.set(tierId, maxLane);
  return maxLane;
}
function segmentHorizontalRect(segment) {
  const start = Math.min(normalizeWeek(segment?.start), normalizeWeek(segment?.end));
  const end = Math.max(normalizeWeek(segment?.start), normalizeWeek(segment?.end));
  const key = `${start}|${end}`;
  const cached = layoutGeometryCache.segmentHorizontalRects.get(key);
  if (cached) return cached;
  const rect = {
    x: weekX(start) + META_BAR_EDGE_INSET,
    w: Math.max(4, weekSpanWidth(start, end) - META_BAR_EDGE_INSET * 2)
  };
  layoutGeometryCache.segmentHorizontalRects.set(key, rect);
  return rect;
}
function computeBetweenSafeHeights() {
  if (layoutGeometryCache.betweenSafeComputed) return;
  layoutGeometryCache.betweenSafeComputed = true;
  const tiers = getTiers();
  for (const tier of tiers) layoutGeometryCache.betweenSafeHeights.set(tier.id, 0);

  const groupsByTier = new Map();
  const seenSlots = new Set();
  for (const seed of state.units || []) {
    const offset = normalizeRowOffset(seed.rowOffset);
    if (!offset) continue;
    const index = tierIndex(seed.tier);
    const upperTier = offset < 0 ? tiers[index - 1] : tiers[index];
    const lowerTier = offset < 0 ? tiers[index] : tiers[index + 1];
    if (!upperTier || !lowerTier) continue;
    const boundaryKey = `between:${upperTier.id}|${lowerTier.id}`;
    if (rowSlotKey(seed) !== boundaryKey) continue;
    const slotKey = visualSlotKey(seed);
    if (seenSlots.has(slotKey)) continue;
    seenSlots.add(slotKey);
    const slot = sameSlotOffset(seed);
    const groupWidth = slot.groupWidth || ICON_W;
    const maxGroupLeft = Math.max(LEFT_W, baseChartWidth() - groupWidth);
    const left = clamp(weekX(seed.week) + Math.round((weekWidth(seed.week) - groupWidth) / 2), LEFT_W, maxGroupLeft);
    const group = {
      left,
      right: left + groupWidth,
      halfHeight: (slot.groupHeight || ICON_W) / 2,
      lowestBarBottom: 0
    };
    const list = groupsByTier.get(upperTier.id) || [];
    list.push(group);
    groupsByTier.set(upperTier.id, list);
  }

  for (const owner of state.units || []) {
    if (!hasVisibleMetaSegments(owner)) continue;
    const groups = groupsByTier.get(owner.tier);
    if (!groups?.length) continue;
    const laneTop = dynamicBarTop(owner.tier) + ((Number(owner.lane) || 1) - 1) * BAR_GAP;
    const barBottom = laneTop + BAR_H;
    for (const segment of sortedVisibleSegments(owner)) {
      const span = segmentHorizontalRect(segment);
      const right = span.x + span.w;
      for (const group of groups) {
        if (span.x < group.right + 8 && right > group.left - 8) {
          group.lowestBarBottom = Math.max(group.lowestBarBottom, barBottom);
        }
      }
    }
  }

  for (const [tierId, groups] of groupsByTier) {
    let requiredHeight = 0;
    for (const group of groups) {
      if (group.lowestBarBottom) requiredHeight = Math.max(requiredHeight, group.lowestBarBottom + group.halfHeight + 12);
    }
    layoutGeometryCache.betweenSafeHeights.set(tierId, requiredHeight);
  }
}
function betweenBoundaryMetaSafeHeight(tierId) {
  computeBetweenSafeHeights();
  return layoutGeometryCache.betweenSafeHeights.get(tierId) || 0;
}
function tierHeight(tierId) {
  if (layoutGeometryCache.tierHeights.has(tierId)) return layoutGeometryCache.tierHeights.get(tierId);
  const lanes = visibleLaneCount(tierId);
  const iconContentHeight = ICON_TOP + maxIconStackVisualHeight(tierId) + 28;
  const minHeight = Math.max(BLANK_TIER_H, iconContentHeight);
  const betweenSafeHeight = betweenBoundaryMetaSafeHeight(tierId);
  const value = !lanes
    ? Math.max(minHeight, betweenSafeHeight)
    : Math.max(minHeight, dynamicBarTop(tierId) + lanes * BAR_GAP + BAR_BOTTOM_PAD, betweenSafeHeight);
  layoutGeometryCache.tierHeights.set(tierId, value);
  return value;
}
function tierY(tierId) {
  if (layoutGeometryCache.tierYs.has(tierId)) return layoutGeometryCache.tierYs.get(tierId);
  let y = HEADER_H;
  for (const tier of getTiers()) {
    layoutGeometryCache.tierYs.set(tier.id, y);
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
  if (layoutGeometryCache.iconYs.has(unit.id)) return layoutGeometryCache.iconYs.get(unit.id);
  const slot = sameSlotOffset(unit);
  const size = slot.size || ICON_W;
  const rowOffset = normalizeRowOffset(unit.rowOffset);
  let top = tierY(unit.tier) + ICON_TOP + slot.y;
  if (rowOffset > 0) top = tierY(unit.tier) + tierHeight(unit.tier) - slot.groupHeight / 2 + slot.y;
  if (rowOffset < 0) top = tierY(unit.tier) - slot.groupHeight / 2 + slot.y;
  const value = clamp(top, HEADER_H - size / 2, baseChartHeight() - size);
  layoutGeometryCache.iconYs.set(unit.id, value);
  return value;
}
function iconX(unit) {
  if (layoutGeometryCache.iconXs.has(unit.id)) return layoutGeometryCache.iconXs.get(unit.id);
  const slot = sameSlotOffset(unit);
  const groupWidth = slot.groupWidth || ICON_W;
  const maxGroupLeft = Math.max(LEFT_W, baseChartWidth() - groupWidth);
  const groupLeft = clamp(weekX(unit.week) + Math.round((weekWidth(unit.week) - groupWidth) / 2), LEFT_W, maxGroupLeft);
  const value = groupLeft + slot.x;
  layoutGeometryCache.iconXs.set(unit.id, value);
  return value;
}
function normalizeWeek(n) { return clamp(Math.round(Number(n) || 1), 1, weekCount()); }
function normalizeLane(n) { return clamp(Math.round(Number(n) || 1), 1, 99); }
function idOfWeekFromX(x) {
  if (x <= LEFT_W) return 1;
  for (let w = 1; w <= weekCount(); w++) {
    if (x < weekX(w) + weekWidth(w)) return w;
  }
  return weekCount();
}
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
function baseChartWidth() { return weekBoundaryX(weekCount()); }
function baseChartHeight() {
  if (layoutGeometryCache.baseChartHeight != null) return layoutGeometryCache.baseChartHeight;
  layoutGeometryCache.baseChartHeight = HEADER_H + getTiers().reduce((sum, t) => sum + tierHeight(t.id), 0);
  return layoutGeometryCache.baseChartHeight;
}
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
function normalizeTagDescriptions(input) {
  const normalized = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return normalized;
  for (const [rawTag, rawDescription] of Object.entries(input)) {
    const cleanTag = sanitizeText(rawTag);
    const description = String(rawDescription || "").trim();
    if (!cleanTag || !description) continue;
    const canonical = TAG_OPTIONS.find(tag => tag.toLowerCase() === cleanTag.toLowerCase()) || cleanTag;
    normalized[canonical] = description;
  }
  return normalized;
}
function tagDescription(tag) {
  const key = String(tag || "").toLowerCase();
  const match = Object.entries(state.tagDescriptions || {}).find(([name]) => name.toLowerCase() === key);
  return match ? String(match[1] || "").trim() : "";
}
function knownTagsForDescriptionEditor() {
  const tags = new Map(TAG_OPTIONS.map(tag => [tag.toLowerCase(), tag]));
  for (const unit of state.units || []) {
    for (const tag of unit.tags || []) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  }
  for (const tag of Object.keys(state.tagDescriptions || {})) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag);
  return [...tags.values()].sort((a, b) => {
    const ai = TAG_ORDER.has(a.toLowerCase()) ? TAG_ORDER.get(a.toLowerCase()) : 1000;
    const bi = TAG_ORDER.has(b.toLowerCase()) ? TAG_ORDER.get(b.toLowerCase()) : 1000;
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });
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
  editFormHomeParent = els.editForm.parentNode;
  editFormHomeNextSibling = els.editForm.nextSibling;
  const loadedFromHash = loadFromShareHash();
  if (!loadedFromHash) loadLocal();
  buildTierSelect();
  bindUI();
  renderAll();
  setZoom(zoomScale, false);
  loadCatalog();
  maybeLoadPublishedRoadmap();
  scheduleUnitTooltipWarmup();
}

function normalizeState() {
  invalidateLayoutGeometryCache();
  const unitsBeforeNormalize = Array.isArray(state.units) ? state.units : [];
  const monthsNeedDefault = !Array.isArray(state.months) || !state.months.length || isGenericMonthLabels(state.months);
  if (monthsNeedDefault) {
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
    const fallback = DEFAULT_META_STATUSES[i] || { label: `Status ${i + 1}`, description: "", color: "#8aa0ff" };
    const oldColor = s.color || "";
    const color = oldColor && oldColor.toLowerCase() !== (LEGACY_STATUS_COLORS[id] || "").toLowerCase() && /^#[0-9a-f]{6}$/i.test(oldColor)
      ? oldColor
      : fallback.color;
    return {
      id,
      label: sanitizeText(s.label) || fallback.label,
      description: String(s.description ?? fallback.description ?? "").trim(),
      color
    };
  });
  state.tagDescriptions = normalizeTagDescriptions(state.tagDescriptions);
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
    const kind = u.kind || "custom";
    const rawNotesPvp = String(u.notesPvp ?? u.pvpNotes ?? u.note ?? "").trim();
    const rawNotesPve = String(u.notesPve ?? u.pveNotes ?? "").trim();
    const pilotNotes = String(kind).toLowerCase() === "pilot"
      ? [rawNotesPvp, rawNotesPve].filter(Boolean).join("\n\n")
      : rawNotesPvp;
    return {
      id: u.id || crypto.randomUUID(),
      name: sanitizeText(u.name || "Unnamed Unit"),
      kind,
      tier,
      week: normalizeWeek(u.week || 1),
      lane: normalizeLane(u.lane || 1),
      rowOffset: normalizeRowOffset(u.rowOffset ?? u.tierOffset ?? 0),
      stackOrder: Number(u.stackOrder) || 0,
      icon: u.icon || "",
      sourceUrl: normalizeAltemaSourceUrl(u.sourceUrl ?? u.altemaUrl, kind),
      tags: cleanTags(rawTags),
      minPotential: String(kind).toLowerCase() === "ms" ? normalizePotentialLevel(u.minPotential ?? u.minimumPotential ?? u.minP) : null,
      idealPotential: String(kind).toLowerCase() === "ms" ? normalizePotentialLevel(u.idealPotential ?? u.recommendedPotential ?? u.idealP) : null,
      notesPvp: pilotNotes,
      notesPve: String(kind).toLowerCase() === "pilot" ? "" : rawNotesPve,
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
  captureRoadmapImagesForRender();
  metaOwnerHoverId = null;
  metaOwnerHighlightedId = null;
  metaFocusDimmerEl = null;
  normalizeState();
  buildStaticGrid();
  renderLegend();
  buildTierSelect();
  buildMetaStatusSelect();
  renderUnits();
  renderForm();
  applyZoom();
  roadmapImageReuseCache.clear();
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
    head.style.width = `${monthPixelWidth(i)}px`;
    head.textContent = month;
    head.setAttribute("aria-label", `${month}. Click to rename. Right-click to add, delete, or change week count.`);
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
    week.style.width = `${weekWidth(w)}px`;
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
    label.dataset.fullLabel = tier.label;
    label.dataset.tierId = tier.id;
    const labelText = document.createElement("span");
    labelText.className = "tier-label-text";
    labelText.textContent = tier.label;
    label.appendChild(labelText);
    label.setAttribute("aria-label", `${tier.label}. Click to rename or recolor this row.`);
    bindAppTooltip(label, () => `<strong>${escapeHtml(tier.label)}</strong><div>Click to rename or recolor this row.</div>`);
    label.addEventListener("click", (event) => {
      hideAppTooltip();
      event.stopPropagation();
      openTierEditor(tier.id);
    });
    els.roadmap.appendChild(label);

    const rail = document.createElement("div");
    rail.className = "tier-accent-rail";
    rail.style.left = `${LEFT_W}px`;
    rail.style.top = `${tierY(tier.id)}px`;
    rail.style.width = `${Math.max(0, baseChartWidth() - LEFT_W)}px`;
    rail.style.setProperty("--tier-color", tier.color);
    els.roadmap.appendChild(rail);
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
    line.style.left = `${weekBoundaryX(w)}px`;
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
      const owner = layoutGeometryCache.laneOwners.get(`${tier.id}|${lane}`);
      if (owner) track.dataset.unitId = owner.id;
      track.setAttribute("aria-hidden", "true");
      track.style.top = `${laneY(tier.id, lane)}px`;
      track.style.width = `${Math.max(4, baseChartWidth() - LEFT_W - 20)}px`;
      els.roadmap.appendChild(track);
    }
  });

  metaFocusDimmerEl = document.createElement("div");
  metaFocusDimmerEl.className = "meta-focus-dimmer";
  metaFocusDimmerEl.setAttribute("aria-hidden", "true");
  els.roadmap.appendChild(metaFocusDimmerEl);
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
  ensureTagDescriptionEditor();
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
  document.getElementById("btnAddTag").addEventListener("click", addTagFromDropdown);
  document.getElementById("btnClearTags").addEventListener("click", clearTagsForSelected);
  document.getElementById("btnCancelStatusEdit").addEventListener("click", () => els.statusDialog.close());
  document.getElementById("btnCancelTierEdit").addEventListener("click", () => els.tierDialog.close());
  document.getElementById("btnCloseUnitEdit").addEventListener("click", closeSelectedUnitDialog);
  els.unitEditDialog.addEventListener("close", restoreEditFormHome);
  els.unitEditDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSelectedUnitDialog();
  });
  els.unitEditDialog.addEventListener("click", (event) => {
    if (event.target === els.unitEditDialog) closeSelectedUnitDialog();
  });
  els.statusForm.addEventListener("submit", saveStatusEdit);
  els.tierForm.addEventListener("submit", saveTierEdit);
  bindAutoApplyForm();
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!event.target.closest(".unit-card")) lastUnitClick = { id: null, at: 0 };
    if (!event.target.closest(".context-menu")) hideContextMenu();
    if (tooltipPinned && !event.target.closest(".unit-card,.meta-bar,.month-head,.tier-label,.context-menu,.unit-tooltip-card,button,input,select,textarea,a,label,.tag-preview,.tag-controls")) {
      hideTooltip(true);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (unitNoteReaderOverlay) { closeUnitNoteReader(); return; }
    if (unitProfileOverlay) { closeUnitProfile(); return; }
    if (tooltipPinned) hideTooltip(true);
  });
  document.addEventListener("contextmenu", (event) => {
    if (!event.target.closest("#roadmap")) hideContextMenu();
  });
  window.addEventListener("resize", () => {
    hideContextMenu();
    updateAdaptiveRoadmapPresentation();
  });
  window.addEventListener("scroll", hideContextMenu, true);
  els.editForm.elements.tags.addEventListener("input", renderTagPreview);
  els.editForm.elements.segment.addEventListener("change", () => {
    if (els.unitEditDialog?.open && editFormDirty) {
      applyForm({ render: false, save: false });
      editDialogSavePending = true;
    }
    selectedSegmentId = els.editForm.elements.segment.value;
    renderForm();
    refreshSelectionUi();
  });

  els.chartScroll?.addEventListener("pointerdown", beginTimelinePan);
  els.chartScroll?.addEventListener("wheel", handleTimelineWheelZoom, { passive: false });
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
  document.addEventListener("pointercancel", onPointerUp);
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
    btn.innerHTML = `<i class="legend-swatch" style="--legend-color:${status.color}"></i><span>${escapeHtml(status.label)}</span>`;
    const description = String(status.description || "").trim();
    btn.setAttribute("aria-label", description ? `${status.label}: ${description}` : `Edit meta status: ${status.label}`);
    bindAppTooltip(btn, () => `<strong>${escapeHtml(status.label)}</strong>${description ? `<div class="app-tooltip-description">${multilineHtml(description)}</div>` : `<div>Click to edit this meta status.</div>`}`);
    btn.addEventListener("click", () => { hideAppTooltip(); openStatusEditor(status.id); });
    els.legend.appendChild(btn);
  });
}

function openStatusEditor(statusId) {
  const status = metaStatus(statusId);
  const f = els.statusForm.elements;
  f.statusId.value = status.id;
  f.label.value = status.label;
  f.description.value = status.description || "";
  f.color.value = status.color;
  els.statusDialog.showModal();
}

function saveStatusEdit(event) {
  event.preventDefault();
  const f = els.statusForm.elements;
  const status = state.metaStatuses.find(s => s.id === f.statusId.value);
  if (!status) return;
  status.label = sanitizeText(f.label.value) || status.label;
  status.description = String(f.description.value || "").trim();
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
    { label: `Add month to left`, action: () => insertMonthAt(index) },
    { label: `Add month to right`, action: () => insertMonthAt(index + 1) },
    { label: `${currentWeeks === 4 ? "✓ " : ""}Use 4 weeks`, action: () => setMonthWeekCount(index, 4) },
    { label: `${currentWeeks === 5 ? "✓ " : ""}Use 5 weeks`, action: () => setMonthWeekCount(index, 5) },
    { label: `Delete ${month}`, danger: true, action: () => deleteMonthAt(index) }
  ]);
}
function setMonthWeekCount(index, weeks) {
  const oldWeeks = getMonthWeeks()[index] || 4;
  const nextWeeks = normalizeMonthWeekCount(weeks);
  if (oldWeeks === nextWeeks) return;
  const startWeek = monthStartWeek(index);
  state.monthWeeks = getMonthWeeks();
  state.monthWeeks[index] = nextWeeks;
  const delta = nextWeeks - oldWeeks;
  if (delta > 0) shiftTimelineForInsertion(startWeek + oldWeeks, delta);
  else if (delta < 0) removeTimelineRange(startWeek + nextWeeks, -delta);
  finalizeMonthStructureChange();
  setStatus(`${state.months[index] || `Month ${index + 1}`} set to ${state.monthWeeks[index]} week(s).`);
}
function monthLabelShift(label, delta) {
  const parsed = new Date(`1 ${sanitizeText(label)}`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setMonth(parsed.getMonth() + delta);
  return parsed.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function suggestedInsertedMonthLabel(index) {
  if (index < state.months.length) return monthLabelShift(state.months[index], -1) || suggestedMonthLabel(index);
  if (index > 0) return monthLabelShift(state.months[index - 1], 1) || suggestedMonthLabel(index);
  return suggestedMonthLabel(index);
}
function shiftTimelineForInsertion(startWeek, count) {
  for (const unit of state.units || []) {
    if (unit.week >= startWeek) unit.week += count;
    for (const segment of unit.segments || []) {
      if (segment.start >= startWeek) {
        segment.start += count;
        segment.end += count;
      } else if (segment.end >= startWeek) {
        segment.end += count;
      }
    }
  }
}
function removeTimelineRange(startWeek, count) {
  const endWeek = startWeek + count - 1;
  const newTotal = Math.max(1, weekCount());
  const mapUnitWeek = (week) => {
    if (week < startWeek) return week;
    if (week > endWeek) return week - count;
    return clamp(startWeek, 1, newTotal);
  };
  for (const unit of state.units || []) {
    unit.week = mapUnitWeek(unit.week);
    for (const segment of unit.segments || []) {
      const originalStart = segment.start;
      const originalEnd = segment.end;
      const startInside = originalStart >= startWeek && originalStart <= endWeek;
      const endInside = originalEnd >= startWeek && originalEnd <= endWeek;
      if (startInside && endInside) {
        const target = clamp(startWeek, 1, newTotal);
        segment.start = target;
        segment.end = target;
        continue;
      }
      segment.start = originalStart > endWeek ? originalStart - count : (startInside ? clamp(startWeek, 1, newTotal) : originalStart);
      segment.end = originalEnd > endWeek ? originalEnd - count : (endInside ? clamp(startWeek - 1, 1, newTotal) : originalEnd);
      segment.start = clamp(segment.start, 1, newTotal);
      segment.end = clamp(segment.end, 1, newTotal);
      if (segment.end < segment.start) segment.end = segment.start;
    }
  }
}
function finalizeMonthStructureChange() {
  const total = weekCount();
  for (const unit of state.units || []) {
    unit.week = clamp(Math.round(Number(unit.week) || 1), 1, total);
    for (const segment of unit.segments || []) {
      segment.start = clamp(Math.round(Number(segment.start) || 1), 1, total);
      segment.end = clamp(Math.round(Number(segment.end) || segment.start), 1, total);
      if (segment.end < segment.start) [segment.start, segment.end] = [segment.end, segment.start];
    }
  }
  for (const tier of getTiers()) reflowLanes(tier.id);
  syncPilotLanes();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}
function insertMonthAt(index) {
  if (state.months.length >= 12) return alert("The roadmap supports up to 12 months.");
  const insertIndex = clamp(Math.round(Number(index) || 0), 0, state.months.length);
  const value = prompt("New month label:", suggestedInsertedMonthLabel(insertIndex));
  if (value === null) return;
  const oldWeeks = getMonthWeeks();
  const startWeek = insertIndex >= state.months.length ? weekCount() + 1 : monthStartWeek(insertIndex);
  const insertedWeeks = 4;
  state.months.splice(insertIndex, 0, sanitizeText(value) || suggestedInsertedMonthLabel(insertIndex));
  state.monthWeeks = oldWeeks;
  state.monthWeeks.splice(insertIndex, 0, insertedWeeks);
  shiftTimelineForInsertion(startWeek, insertedWeeks);
  finalizeMonthStructureChange();
  setStatus(`Added ${state.months[insertIndex]} with ${insertedWeeks} weeks.`);
}
function deleteMonthAt(index) {
  if (state.months.length <= 1) return alert("You need at least one month.");
  const deleteIndex = clamp(Math.round(Number(index) || 0), 0, state.months.length - 1);
  const counts = getMonthWeeks();
  const removed = state.months[deleteIndex];
  const startWeek = monthStartWeek(deleteIndex);
  const removedWeeks = counts[deleteIndex] || 4;
  if (!confirm(`Delete ${removed} entirely? Units inside this month will move to the nearest remaining week, and later timeline data will shift left.`)) return;
  state.months.splice(deleteIndex, 1);
  state.monthWeeks = counts;
  state.monthWeeks.splice(deleteIndex, 1);
  removeTimelineRange(startWeek, removedWeeks);
  finalizeMonthStructureChange();
  setStatus(`Deleted ${removed}.`);
}
function addMonth() { insertMonthAt(state.months.length); }
function removeMonth() { deleteMonthAt(state.months.length - 1); }

function openSelectedUnitDialog(unitId) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit || !els.unitEditDialog || !els.unitEditDialogBody) return;
  select(unit.id, null);
  hideTooltip(true);
  closeUnitProfile(true);
  hideContextMenu();
  if (!editFormHomeParent) {
    editFormHomeParent = els.editForm.parentNode;
    editFormHomeNextSibling = els.editForm.nextSibling;
  }
  els.unitEditDialogBody.appendChild(els.editForm);
  editFormDirty = false;
  editDialogSavePending = false;
  renderForm();
  if (!els.unitEditDialog.open) els.unitEditDialog.showModal();
}
function restoreEditFormHome() {
  if (!editFormHomeParent || els.editForm.parentNode === editFormHomeParent) return;
  if (editFormHomeNextSibling && editFormHomeNextSibling.parentNode === editFormHomeParent) editFormHomeParent.insertBefore(els.editForm, editFormHomeNextSibling);
  else editFormHomeParent.appendChild(els.editForm);
}
function closeSelectedUnitDialog() {
  if (!els.unitEditDialog?.open) {
    restoreEditFormHome();
    return;
  }
  const shouldCommit = editFormDirty;
  const shouldSave = shouldCommit || editDialogSavePending;
  if (shouldCommit) applyForm({ render: false, save: false });
  els.unitEditDialog.close();
  restoreEditFormHome();
  if (shouldSave) renderAll();
  if (shouldSave) autoSave({ force: true });
  editFormDirty = false;
  editDialogSavePending = false;
}

function renderUnits() {
  state.units.forEach(unit => {
    const card = document.createElement("article");
    const isDraggingUnit = drag?.type === "unit" && drag.id === unit.id && Number.isFinite(drag.previewLeft);
    const slot = sameSlotOffset(unit);
    const size = slot.size || ICON_W;
    card.className = `unit-card${selectedId === unit.id && !selectedSegmentId ? " selected" : ""}${isDraggingUnit ? " dragging" : ""}${hasMustP5(unit) ? " must-p5" : ""}${hasBuff(unit) ? " buff" : ""}${normalizeRowOffset(unit.rowOffset) ? " between-row" : ""}`;
    card.dataset.id = unit.id;
    card.style.left = `${isDraggingUnit ? drag.previewLeft : iconX(unit)}px`;
    card.style.top = `${isDraggingUnit ? drag.previewTop : iconY(unit)}px`;
    card.style.width = `${isDraggingUnit ? ICON_W : size}px`;
    card.style.height = `${isDraggingUnit ? ICON_W : size}px`;
    card.style.zIndex = String(unitZIndex(unit, slot, isDraggingUnit));
    card.setAttribute("aria-label", unit.name);

    if (unit.icon) {
      const img = reusableRoadmapImage(unit) || document.createElement("img");
      if (!img.getAttribute("src")) img.src = unit.icon;
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
    card.addEventListener("contextmenu", (event) => openUnitContextMenu(event, unit.id, null));
    card.addEventListener("mouseenter", (event) => {
      bringUnitToFront(unit.id, card);
      setMetaOwnerHover(metaOwnerForUnit(unit)?.id || null);
      showTooltip(event, unit, null, { anchor: card });
    });
    card.addEventListener("mouseleave", () => {
      setMetaOwnerHover(null);
      hideTooltip();
    });
    els.roadmap.appendChild(card);

    if (!hasMetaBars(unit)) return;

    renderMetaOwnerTether(unit);
    renderMetaSegmentLinks(unit);
    const visibleSegments = sortedVisibleSegments(unit);
    visibleSegments.forEach((segment, index) => {
      const rect = segmentBarRect(unit, segment);
      const bar = document.createElement("div");
      const selected = selectedId === unit.id && selectedSegmentId === segment.id;
      const joinsPrevious = index > 0 && metaSegmentsTouch(visibleSegments[index - 1], segment);
      const joinsNext = index < visibleSegments.length - 1 && metaSegmentsTouch(segment, visibleSegments[index + 1]);
      bar.className = `meta-bar${selected ? " selected" : ""}${joinsPrevious ? " segment-inner-left" : " segment-first"}${joinsNext ? " segment-inner-right" : " segment-last"}`;
      bar.dataset.id = unit.id;
      bar.dataset.segmentId = segment.id;
      bar.dataset.statusId = segment.statusId;
      bar.style.left = `${rect.x}px`;
      bar.style.top = `${rect.y}px`;
      bar.style.width = `${rect.w}px`;
      const color = segmentColor(segment);
      const textPresentation = metaBarTextPresentation(color);
      bar.style.setProperty("--bar", color);
      bar.style.setProperty("--bar-text", textPresentation.color);
      bar.dataset.textTone = textPresentation.tone;
      const label = document.createElement("span");
      label.className = "bar-label";
      label.dataset.fullLabel = `${unit.name} - ${metaStatus(segment.statusId).label}`;
      label.dataset.unitLabel = unit.name;
      label.textContent = label.dataset.fullLabel;
      const left = document.createElement("span");
      left.className = `handle left${joinsPrevious ? " internal" : ""}`;
      left.dataset.handle = "left";
      const right = document.createElement("span");
      right.className = `handle right${joinsNext ? " internal" : ""}`;
      right.dataset.handle = "right";
      bar.append(label, left, right);
      bar.addEventListener("pointerdown", (event) => beginDragBar(event, unit.id, segment.id));
      bar.addEventListener("click", (event) => { event.stopPropagation(); select(unit.id, segment.id); });
      bar.addEventListener("contextmenu", (event) => openUnitContextMenu(event, unit.id, segment.id));
      bar.addEventListener("dblclick", (event) => { event.stopPropagation(); openUnitContextMenu(event, unit.id, segment.id); });
      bar.addEventListener("mouseenter", (event) => {
        setMetaOwnerHover(unit.id);
        showTooltip(event, unit, segment, { anchor: bar });
      });
      bar.addEventListener("mouseleave", () => {
        setMetaOwnerHover(null);
        hideTooltip();
      });
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
function sortedVisibleSegments(unit) {
  return (unit?.segments || [])
    .filter(segment => segment)
    .slice()
    .sort((a, b) => normalizeWeek(a.start) - normalizeWeek(b.start) || normalizeWeek(a.end) - normalizeWeek(b.end));
}
function segmentBarRect(unit, segment) {
  const key = `${unit?.id || ""}|${segment?.id || `${segment?.start}|${segment?.end}`}`;
  const cached = layoutGeometryCache.segmentBarRects.get(key);
  if (cached) return cached;
  const span = segmentHorizontalRect(segment);
  const rect = { x: span.x, y: laneY(unit), w: span.w, h: BAR_H };
  layoutGeometryCache.segmentBarRects.set(key, rect);
  return rect;
}
function metaSegmentsTouch(previousSegment, nextSegment) {
  if (!previousSegment || !nextSegment) return false;
  const previousEnd = Math.max(normalizeWeek(previousSegment.start), normalizeWeek(previousSegment.end));
  const nextStart = Math.min(normalizeWeek(nextSegment.start), normalizeWeek(nextSegment.end));
  return nextStart <= previousEnd + 1;
}
function metaSegmentLinks(unit) {
  const segments = sortedVisibleSegments(unit);
  const links = [];
  for (let i = 1; i < segments.length; i++) {
    if (!metaSegmentsTouch(segments[i - 1], segments[i])) continue;
    const previous = segmentBarRect(unit, segments[i - 1]);
    const next = segmentBarRect(unit, segments[i]);
    const x = previous.x + previous.w - META_LINK_OVERLAP;
    const w = next.x - x + META_LINK_OVERLAP;
    if (w <= META_LINK_OVERLAP * 2) continue;
    links.push({
      x,
      y: previous.y + (BAR_H - META_LINK_H) / 2,
      w,
      fromColor: segmentColor(segments[i - 1]),
      toColor: segmentColor(segments[i])
    });
  }
  return links;
}
function renderMetaSegmentLinks(unit) {
  metaSegmentLinks(unit).forEach(link => {
    const connector = document.createElement("div");
    connector.className = "meta-link";
    connector.dataset.id = unit.id;
    connector.style.left = `${link.x}px`;
    connector.style.top = `${link.y}px`;
    connector.style.width = `${link.w}px`;
    connector.style.setProperty("--link-from", link.fromColor);
    connector.style.setProperty("--link-to", link.toColor);
    els.roadmap.appendChild(connector);
  });
}
function cardRectEntriesByLeft() {
  if (layoutGeometryCache.cardRectsByLeft) return layoutGeometryCache.cardRectsByLeft;
  const entries = (state.units || []).map(unit => ({ unit, rect: iconRect(unit) })).sort((a, b) => a.rect.left - b.rect.left);
  layoutGeometryCache.cardRectsByLeft = entries;
  return entries;
}
function lowerBoundCardRectLeft(entries, value) {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid].rect.left < value) low = mid + 1;
    else high = mid;
  }
  return low;
}
function metaOwnerRouteBlocked(unitId, x, top, bottom) {
  const entries = cardRectEntriesByLeft();
  let index = lowerBoundCardRectLeft(entries, x - ICON_W - 6);
  for (; index < entries.length; index++) {
    const { unit, rect } = entries[index];
    if (rect.left > x + 4) break;
    if (unit.id === unitId || rect.right < x - 4) continue;
    const crossesVertically = bottom > rect.top + 2 && top < rect.bottom - 2;
    if (crossesVertically && x > rect.left - 4 && x < rect.right + 4) return true;
  }
  return false;
}
function metaOwnerRouteX(unit, cardRect, cardEdgeY, laneCenter) {
  const center = (cardRect.left + cardRect.right) / 2;
  const peers = sameSlotGroup(unit).filter(hasVisibleMetaSegments);
  const peerIndex = Math.max(0, peers.findIndex(peer => peer.id === unit.id));
  const candidates = [];
  if (peers.length <= 1) candidates.push(center);
  const preferredSide = peerIndex % 2 ? "right" : "left";
  const oppositeSide = preferredSide === "left" ? "right" : "left";
  const baseLevel = Math.floor(peerIndex / 2) + 1;
  const addSide = (side, offset) => candidates.push(side === "left" ? cardRect.left - offset : cardRect.right + offset);
  for (let level = baseLevel; level <= baseLevel + 3; level++) {
    const offset = 12 * level;
    addSide(preferredSide, offset);
    addSide(oppositeSide, offset);
  }
  if (peers.length > 1) candidates.push(center);
  const top = Math.min(cardEdgeY, laneCenter);
  const bottom = Math.max(cardEdgeY, laneCenter);
  const isBlocked = (x) => metaOwnerRouteBlocked(unit.id, x, top, bottom);
  const minX = LEFT_W + 4;
  const maxX = baseChartWidth() - 4;
  return candidates.find(x => x >= minX && x <= maxX && !isBlocked(x)) ?? clamp(center, minX, maxX);
}
function metaOwnerTetherGeometry(unit) {
  const firstSegment = sortedVisibleSegments(unit)[0];
  if (!firstSegment) return null;
  const slot = sameSlotOffset(unit);
  const size = slot.size || ICON_W;
  const cardTop = iconY(unit);
  const cardBottom = cardTop + size;
  const cardCenterY = cardTop + size / 2;
  const cardRect = { left: iconX(unit), right: iconX(unit) + size, top: cardTop, bottom: cardBottom };
  const laneCenter = laneCenterY(unit.tier, unit.lane);
  const cardEdgeY = laneCenter >= cardCenterY ? cardBottom : cardTop;
  const anchorX = metaOwnerRouteX(unit, cardRect, cardEdgeY, laneCenter);
  const firstRect = segmentBarRect(unit, firstSegment);
  const targetX = clamp(anchorX, firstRect.x, firstRect.x + firstRect.w);
  const cardPortX = anchorX < cardRect.left ? cardRect.left : anchorX > cardRect.right ? cardRect.right : anchorX;
  return {
    anchorX,
    laneCenter,
    stemTop: Math.min(cardEdgeY, laneCenter),
    stemHeight: Math.abs(laneCenter - cardEdgeY),
    cardArmTop: cardEdgeY,
    cardArmLeft: anchorX < cardRect.left ? anchorX : cardRect.right,
    cardArmWidth: anchorX < cardRect.left ? cardRect.left - anchorX : anchorX > cardRect.right ? anchorX - cardRect.right : 0,
    armLeft: Math.min(anchorX, targetX),
    armWidth: Math.abs(targetX - anchorX),
    cardPortX,
    cardPortY: cardEdgeY,
    laneNodeX: anchorX,
    laneNodeY: laneCenter
  };
}
function renderMetaOwnerTether(unit) {
  const geometry = metaOwnerTetherGeometry(unit);
  if (!geometry) return;
  if (geometry.stemHeight > 1) {
    const stem = document.createElement("div");
    stem.className = "meta-owner-tether stem";
    stem.dataset.unitId = unit.id;
    stem.setAttribute("aria-hidden", "true");
    stem.style.left = `${geometry.anchorX}px`;
    stem.style.top = `${geometry.stemTop}px`;
    stem.style.height = `${geometry.stemHeight}px`;
    els.roadmap.appendChild(stem);
  }
  if (geometry.cardArmWidth > 1) {
    const cardArm = document.createElement("div");
    cardArm.className = "meta-owner-tether arm card-arm";
    cardArm.dataset.unitId = unit.id;
    cardArm.setAttribute("aria-hidden", "true");
    cardArm.style.left = `${geometry.cardArmLeft}px`;
    cardArm.style.top = `${geometry.cardArmTop}px`;
    cardArm.style.width = `${geometry.cardArmWidth}px`;
    els.roadmap.appendChild(cardArm);
  }
  if (geometry.armWidth > 1) {
    const arm = document.createElement("div");
    arm.className = "meta-owner-tether arm";
    arm.dataset.unitId = unit.id;
    arm.setAttribute("aria-hidden", "true");
    arm.style.left = `${geometry.armLeft}px`;
    arm.style.top = `${geometry.laneCenter}px`;
    arm.style.width = `${geometry.armWidth}px`;
    els.roadmap.appendChild(arm);
  }
  const cardPort = document.createElement("div");
  cardPort.className = "meta-owner-node card-port";
  cardPort.dataset.unitId = unit.id;
  cardPort.setAttribute("aria-hidden", "true");
  cardPort.style.left = `${geometry.cardPortX}px`;
  cardPort.style.top = `${geometry.cardPortY}px`;
  els.roadmap.appendChild(cardPort);

  const laneNode = document.createElement("div");
  laneNode.className = "meta-owner-node lane-node";
  laneNode.dataset.unitId = unit.id;
  laneNode.setAttribute("aria-hidden", "true");
  laneNode.style.left = `${geometry.laneNodeX}px`;
  laneNode.style.top = `${geometry.laneNodeY}px`;
  els.roadmap.appendChild(laneNode);
}
function setMetaOwnerHover(unitId) {
  metaOwnerHoverId = unitId || null;
  updateMetaOwnerHighlight();
}
function setMetaOwnerHighlightState(unitId, highlighted) {
  if (!els.roadmap || !unitId) return;
  const id = CSS.escape(unitId);
  els.roadmap.querySelectorAll(
    `.unit-card[data-id="${id}"],.meta-bar[data-id="${id}"],.meta-link[data-id="${id}"],` +
    `.meta-owner-tether[data-unit-id="${id}"],.meta-owner-node[data-unit-id="${id}"],.lane-track[data-unit-id="${id}"]`
  ).forEach(element => element.classList.toggle("meta-owner-highlight", highlighted));
}
function updateMetaOwnerHighlight() {
  if (!els.roadmap) return;
  const activeId = metaOwnerHoverId || null;
  if (activeId === metaOwnerHighlightedId) return;
  if (metaOwnerHighlightedId) setMetaOwnerHighlightState(metaOwnerHighlightedId, false);
  if (activeId) setMetaOwnerHighlightState(activeId, true);
  // Dim the rest of the timeline with one compositor-friendly overlay instead
  // of restyling every unrelated bar/tether. Active-owner marks are elevated
  // above this layer in CSS, so the focus+context effect stays strong without
  // a roadmap-wide selector invalidation on every hover.
  metaFocusDimmerEl?.classList.toggle("active", !!activeId);
  els.roadmap.classList.remove("meta-owner-context-active");
  metaOwnerHighlightedId = activeId;
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
  if (f.minPotential) f.minPotential.value = isPilot(unit) || unit.minPotential == null ? "" : String(unit.minPotential);
  if (f.idealPotential) f.idealPotential.value = isPilot(unit) || unit.idealPotential == null ? "" : String(unit.idealPotential);
  els.editForm.querySelectorAll(".investment-editor").forEach(node => node.classList.toggle("hidden", !isMs(unit)));
  f.notesPvp.value = unit.notesPvp || "";
  f.notesPve.value = unit.notesPve || "";
  const pilotNotesOnly = isPilot(unit);
  const notesPvpField = f.notesPvp.closest(".field");
  const notesPveField = f.notesPve.closest(".field");
  const notesPvpLabel = notesPvpField?.querySelector("label");
  if (notesPvpLabel) notesPvpLabel.textContent = pilotNotesOnly ? "Notes" : "PVP Notes";
  notesPveField?.classList.toggle("hidden", pilotNotesOnly);
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
  if (!isMs(unit)) {
    unit.minPotential = null;
    unit.idealPotential = null;
  } else {
    unit.minPotential = normalizePotentialLevel(f.minPotential?.value);
    unit.idealPotential = normalizePotentialLevel(f.idealPotential?.value);
    if (unit.minPotential != null && unit.idealPotential != null && unit.idealPotential < unit.minPotential) {
      unit.idealPotential = unit.minPotential;
    }
  }
  const formNotesPvp = f.notesPvp.value.trim();
  const formNotesPve = f.notesPve.value.trim();
  if (isPilot(unit)) {
    unit.notesPvp = [formNotesPvp, formNotesPve].filter(Boolean).join("\n\n");
    unit.notesPve = "";
  } else {
    unit.notesPvp = formNotesPvp;
    unit.notesPve = formNotesPve;
  }
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
  editFormDirty = false;
  if (options.render !== false) renderAll();
  if (options.save !== false) autoSave();
}

function bindAutoApplyForm() {
  const immediateNames = new Set(["kind", "tier", "rowOffset", "week", "lane", "segment", "metaStart", "metaEnd", "metaStatus", "tags", "minPotential", "idealPotential"]);
  els.editForm.querySelectorAll("input, select, textarea").forEach(input => {
    if (input.name === "segment") return;
    const handler = () => {
      if (els.unitEditDialog?.open) {
        editFormDirty = true;
        return;
      }
      scheduleAutoApply(immediateNames.has(input.name) ? 40 : 420);
    };
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
  if (els.unitEditDialog?.open && editFormDirty) {
    applyForm({ render: false, save: false });
    editDialogSavePending = true;
  }
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
  if (els.unitEditDialog?.open && editFormDirty) {
    applyForm({ render: false, save: false });
    editDialogSavePending = true;
  }
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
  const newUnitKind = partial.kind || "custom";
  const rawNotesPvp = String(partial.notesPvp ?? partial.pvpNotes ?? partial.note ?? "").trim();
  const rawNotesPve = String(partial.notesPve ?? partial.pveNotes ?? "").trim();
  const newUnit = {
    id: crypto.randomUUID(),
    name: partial.name || "New Unit",
    kind: newUnitKind,
    tier,
    week: releaseWeek,
    lane: partial.lane || autoLaneFor(tier, segments),
    rowOffset: normalizeRowOffset(partial.rowOffset || 0),
    stackOrder: Number(partial.stackOrder) || 0,
    icon: partial.icon || "",
    sourceUrl: normalizeAltemaSourceUrl(partial.sourceUrl ?? partial.altemaUrl, newUnitKind),
    tags: cleanTags(partial.tags || partial.badges || []),
    minPotential: String(newUnitKind).toLowerCase() === "ms" ? normalizePotentialLevel(partial.minPotential ?? partial.minimumPotential ?? partial.minP) : null,
    idealPotential: String(newUnitKind).toLowerCase() === "ms" ? normalizePotentialLevel(partial.idealPotential ?? partial.recommendedPotential ?? partial.idealP) : null,
    notesPvp: String(newUnitKind).toLowerCase() === "pilot" ? [rawNotesPvp, rawNotesPve].filter(Boolean).join("\n\n") : rawNotesPvp,
    notesPve: String(newUnitKind).toLowerCase() === "pilot" ? "" : rawNotesPve,
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
  if (els.unitEditDialog?.open) closeSelectedUnitDialog();
  state.units = state.units.filter(u => u.id !== selectedId);
  selectedId = null;
  selectedSegmentId = null;
  for (const tier of getTiers()) reflowLanes(tier.id);
  syncPilotLanes();
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
}

function isTimelinePanBlockedTarget(target) {
  return !!target?.closest?.(
    ".unit-card,.meta-bar,.month-head,.tier-label,.context-menu,button,input,select,textarea,a,label,.tag-preview,.tag-controls"
  );
}
function isLikelyScrollbarGrab(event, scrollEl) {
  const rect = scrollEl.getBoundingClientRect();
  const gutter = 18;
  return event.clientX >= rect.right - gutter || event.clientY >= rect.bottom - gutter;
}
function beginTimelinePan(event) {
  if (event.button !== 0 || drag || !els.chartScroll) return;
  if (isTimelinePanBlockedTarget(event.target)) return;
  if (isLikelyScrollbarGrab(event, els.chartScroll)) return;
  panDrag = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startScrollLeft: els.chartScroll.scrollLeft,
    startScrollTop: els.chartScroll.scrollTop,
    didMove: false
  };
  els.chartScroll.classList.add("panning");
  els.chartScroll.setPointerCapture?.(event.pointerId);
}
function updateTimelinePan(event) {
  if (!panDrag || !els.chartScroll) return;
  const dx = event.clientX - panDrag.startClientX;
  const dy = event.clientY - panDrag.startClientY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panDrag.didMove = true;
  if (!panDrag.didMove) return;
  els.chartScroll.scrollLeft = panDrag.startScrollLeft - dx;
  els.chartScroll.scrollTop = panDrag.startScrollTop - dy;
  hideContextMenu();
  event.preventDefault();
}
function finishTimelinePan(event) {
  const endedPan = panDrag;
  panDrag = null;
  els.chartScroll?.classList.remove("panning");
  if (endedPan?.pointerId != null) els.chartScroll?.releasePointerCapture?.(endedPan.pointerId);
  if (endedPan?.didMove) {
    suppressRoadmapClick = true;
    event?.preventDefault?.();
    setTimeout(() => { if (suppressRoadmapClick) suppressRoadmapClick = false; }, 0);
  }
}

function beginDragUnit(event, id) {
  if (event.button !== 0) return;
  if (profileOpenTimer) { clearTimeout(profileOpenTimer); profileOpenTimer = null; }
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
    startPointerWeek: idOfWeekFromX(point.x),
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
  if (panDrag) {
    updateTimelinePan(event);
    return;
  }
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
    const dxWeeks = idOfWeekFromX(point.x) - drag.startPointerWeek;
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
function onPointerUp(event) {
  if (panDrag) {
    finishTimelinePan(event);
    return;
  }
  if (!drag) return;
  const endedDrag = drag;
  drag = null;

  // Handle stationary unit presses here instead of relying on native click/dblclick.
  // The unit cards participate in pointer-captured drag handling, and some browsers
  // suppress or lose follow-up mouse events when pointerdown is cancelled for dragging.
  if (!endedDrag.didMove) {
    if (endedDrag.type === "unit") handleUnitClickGesture(event, endedDrag.id);
    if (endedDrag.type === "bar") handleMetaBarClickGesture(event, endedDrag.id, endedDrag.segmentId);
    return;
  }

  if (endedDrag.type === "unit") finalizeUnitDrop(endedDrag);
  suppressRoadmapClick = true;
  state.updated = new Date().toISOString();
  renderAll();
  autoSave();
  setTimeout(() => { if (suppressRoadmapClick) suppressRoadmapClick = false; }, 0);
}
function handleUnitClickGesture(event, unitId) {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;

  select(unit.id, null);
  const now = performance.now();
  const isDoubleClick = lastUnitClick.id === unit.id && now - lastUnitClick.at <= 500;

  if (isDoubleClick) {
    if (profileOpenTimer) clearTimeout(profileOpenTimer);
    profileOpenTimer = null;
    lastUnitClick = { id: null, at: 0 };
    closeUnitProfile(true);
    if (isMs(unit) || isPilot(unit)) openSelectedUnitDialog(unit.id);
    else renameUnit(unit.id);
    return;
  }

  lastUnitClick = { id: unit.id, at: now };
  if (profileOpenTimer) clearTimeout(profileOpenTimer);
  if (isMs(unit) || isPilot(unit)) {
    // Preserve Builder's deliberate single-click vs double-click distinction.
    // A short intent delay avoids flashing Full Profile when the user means to edit.
    profileOpenTimer = setTimeout(() => {
      profileOpenTimer = null;
      if (lastUnitClick.id === unit.id) openUnitProfile(unit.id);
    }, 420);
  }
}
function handleMetaBarClickGesture(event, unitId, segmentId) {
  const unit = state.units.find(u => u.id === unitId);
  const segment = unit?.segments.find(s => s.id === segmentId);
  if (!unit || !segment) return;

  select(unit.id, segment.id);
  openUnitProfile(unit.id, segment.id);
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
      || sameSlotOffset(a).y - sameSlotOffset(b).y
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
function pairedPilotForMs(ms) {
  if (!isMs(ms)) return null;
  return state.units
    .filter(isPilot)
    .filter(pilot => pairedMsForPilot(pilot)?.id === ms.id)
    .sort((a, b) => {
      const aExact = sameVisualSlot(a, ms) ? 1 : 0;
      const bExact = sameVisualSlot(b, ms) ? 1 : 0;
      return bExact - aExact || (Number(a.stackOrder) || 0) - (Number(b.stackOrder) || 0) || a.name.localeCompare(b.name);
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
  const noteItems = isPilot(unit)
    ? [{ label: "Edit notes…", action: () => editUnitNotes(unitId, "notesPvp") }]
    : [
        { label: "Edit PVP notes…", action: () => editUnitNotes(unitId, "notesPvp") },
        { label: "Edit PVE notes…", action: () => editUnitNotes(unitId, "notesPve") }
      ];
  items.push(
    { label: "Rename unit…", action: () => renameUnit(unitId) },
    ...noteItems,
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
function editUnitNotes(unitId, fieldName = "notesPvp") {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return;
  openSelectedUnitDialog(unitId);
  requestAnimationFrame(() => {
    const field = els.editForm.elements[fieldName];
    if (!field) return;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange?.(end, end);
  });
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
function autoSave(options = {}) {
  if (!options.force && els.unitEditDialog?.open) {
    editDialogSavePending = true;
    setStatus("Editing… changes will auto-save when the unit editor closes.");
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  editDialogSavePending = false;
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

function compactTierLabel(fullLabel, tierId = "") {
  const preset = TIER_LABEL_ABBREVIATIONS[tierId];
  if (preset) return preset;
  const words = sanitizeText(fullLabel).split(/[\s/|&+\-]+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 4).map(word => word[0]).join("").toUpperCase();
  const single = words[0] || sanitizeText(fullLabel);
  return single.length > 4 ? single.slice(0, 4).toUpperCase() : single;
}
function updateAdaptiveTierLabels() {
  if (!els.roadmap) return;
  const entries = Array.from(els.roadmap.querySelectorAll(".tier-label")).map(label => ({
    label,
    text: label.querySelector(".tier-label-text")
  })).filter(entry => entry.text);

  // Batch writes before reads so one label does not force layout for the next.
  for (const { label, text } of entries) {
    const fullLabel = label.dataset.fullLabel || text.textContent || "";
    text.textContent = fullLabel;
    label.dataset.abbreviated = "false";
    label.setAttribute("aria-label", `${fullLabel}. Click to rename or recolor this row.`);
  }
  const compact = entries.filter(({ text }) => text.scrollWidth > text.clientWidth + 0.5);
  for (const { label, text } of compact) {
    const fullLabel = label.dataset.fullLabel || text.textContent || "";
    text.textContent = compactTierLabel(fullLabel, label.dataset.tierId || "");
    label.dataset.abbreviated = "true";
  }
}
function updateUnitCardDetailVisibility() {
  if (!els.roadmap) return;
  const unitsById = new Map((state.units || []).map(unit => [unit.id, unit]));
  const measurements = [];
  for (const card of els.roadmap.querySelectorAll(".unit-card")) {
    const unit = unitsById.get(card.dataset.id);
    const cardRect = card.getBoundingClientRect();
    const tags = card.querySelector(".tags");
    const nameplate = card.querySelector(".nameplate");
    const tagsRect = tags?.children.length ? tags.getBoundingClientRect() : null;
    const nameRect = nameplate?.getBoundingClientRect() || null;
    measurements.push({ card, unit, cardRect, tagsRect, nameRect, hasTags: !!tags?.children.length });
  }

  // Apply classes only after all geometry has been read. These classes change
  // opacity/visibility, not layout, so the measured geometry remains valid.
  for (const { card, unit, cardRect, tagsRect, nameRect, hasTags } of measurements) {
    const visualSize = Math.min(cardRect.width, cardRect.height);
    if (isMs(unit)) {
      const tagsFitCard = !hasTags || !tagsRect || tagsRect.bottom <= cardRect.bottom - CARD_TAGS_MIN_BOTTOM_GAP;
      const nameHasRoom = visualSize >= CARD_NAME_MIN_VISUAL_SIZE
        && (!tagsRect || !nameRect || nameRect.top - tagsRect.bottom >= CARD_NAME_MIN_TAG_GAP);
      const iconOnly = visualSize < CARD_DETAILS_MIN_VISUAL_SIZE || !tagsFitCard;
      card.classList.toggle("icon-only", iconOnly);
      card.classList.toggle("tags-only", !iconOnly && !nameHasRoom);
      continue;
    }
    const detailsCollide = !!(hasTags && tagsRect && nameRect && tagsRect.bottom >= nameRect.top - 2);
    card.classList.toggle("icon-only", visualSize < CARD_DETAILS_MIN_VISUAL_SIZE || detailsCollide);
    card.classList.remove("tags-only");
  }
}
function updateMetaBarLabelVisibility() {
  if (!els.roadmap) return;
  const entries = Array.from(els.roadmap.querySelectorAll(".meta-bar")).map(bar => ({
    bar,
    label: bar.querySelector(".bar-label")
  })).filter(entry => entry.label);

  // Phase 1: put every label in its full-text measurement state.
  for (const { label } of entries) {
    label.hidden = false;
    label.textContent = label.dataset.fullLabel || label.textContent || "";
  }

  // Phase 2: read all geometry in one layout pass and identify labels that can
  // fall back to the unit name.
  const needsUnitLabel = [];
  const shouldHide = new Set();
  for (const { bar, label } of entries) {
    const renderedHeight = bar.getBoundingClientRect().height;
    if (renderedHeight < META_LABEL_MIN_RENDERED_HEIGHT) {
      shouldHide.add(label);
      continue;
    }
    if (label.scrollWidth > label.clientWidth + 1) needsUnitLabel.push(label);
  }

  // Phase 3: switch all overflowing labels together, then measure them together.
  for (const label of needsUnitLabel) label.textContent = label.dataset.unitLabel || label.dataset.fullLabel || "";
  for (const label of needsUnitLabel) {
    if (label.scrollWidth > label.clientWidth + 1) shouldHide.add(label);
  }

  // Final writes are batched after measurement.
  for (const { label } of entries) label.hidden = shouldHide.has(label);
}
function updateAdaptiveRoadmapPresentation() {
  updateAdaptiveTierLabels();
  updateUnitCardDetailVisibility();
  updateMetaBarLabelVisibility();
}

function applyZoom() {
  if (!els.roadmap || !els.roadmapStage) return;
  els.roadmap.style.transform = `scale(${zoomScale})`;
  els.roadmap.style.setProperty("--textBoost", legibleTextScale().toFixed(3));
  els.roadmap.style.setProperty("--barTextBoost", barLabelTextScale().toFixed(3));
  const gridLinePx = clamp(1 / zoomScale, 1, 5);
  els.roadmap.style.setProperty("--gridLine", `${gridLinePx.toFixed(2)}px`);
  els.roadmap.style.setProperty("--monthGridLine", `${(gridLinePx * 2).toFixed(2)}px`);
  els.roadmapStage.style.width = `${baseChartWidth() * zoomScale}px`;
  els.roadmapStage.style.height = `${baseChartHeight() * zoomScale}px`;
  if (els.zoomRange) els.zoomRange.value = String(Math.round(zoomScale * 100));
  if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(zoomScale * 100)}%`;
  updateAdaptiveRoadmapPresentation();
}
function setZoom(value, persist = true) {
  zoomScale = clamp(Math.round(Number(value || 1) * 100) / 100, MIN_ZOOM, MAX_ZOOM);
  applyZoom();
  if (persist) localStorage.setItem(ZOOM_STORAGE_KEY, String(zoomScale));
}
function setZoomAtClientPoint(value, clientX, clientY, persist = true) {
  if (!els.chartScroll) {
    setZoom(value, persist);
    return;
  }
  const oldZoom = zoomScale;
  const nextZoom = clamp(Math.round(Number(value || 1) * 100) / 100, MIN_ZOOM, MAX_ZOOM);
  if (Math.abs(nextZoom - oldZoom) < 0.0001) return;
  const rect = els.chartScroll.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const contentX = (els.chartScroll.scrollLeft + localX) / oldZoom;
  const contentY = (els.chartScroll.scrollTop + localY) / oldZoom;
  setZoom(nextZoom, persist);
  els.chartScroll.scrollLeft = contentX * zoomScale - localX;
  els.chartScroll.scrollTop = contentY * zoomScale - localY;
}
function handleTimelineWheelZoom(event) {
  if (!event.deltaY) return;
  event.preventDefault();
  event.stopPropagation();
  const delta = clamp(event.deltaY, -200, 200);
  const factor = Math.exp(-delta * 0.0005);
  setZoomAtClientPoint(zoomScale * factor, event.clientX, event.clientY);
}

function tagListFromInput() { return cleanTags(els.editForm.elements.tags.value.split(",")); }
function setTagList(tags, apply = false) {
  els.editForm.elements.tags.value = cleanTags(tags).join(", ");
  renderTagPreview();
  if (!apply || !getSelected()) return;
  if (els.unitEditDialog?.open) {
    editFormDirty = true;
    return;
  }
  applyForm();
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
function ensureTagDescriptionEditor() {
  if (document.getElementById("tagDescriptionDialog")) return;
  const controls = document.querySelector(".tag-controls");
  if (controls && !document.getElementById("btnEditTagDescriptions")) {
    const button = document.createElement("button");
    button.id = "btnEditTagDescriptions";
    button.type = "button";
    button.textContent = "Edit descriptions";
    button.addEventListener("click", openTagDescriptionEditor);
    controls.appendChild(button);
  }

  const dialog = document.createElement("dialog");
  dialog.id = "tagDescriptionDialog";
  dialog.className = "status-dialog tag-description-dialog";
  dialog.innerHTML = `
    <form method="dialog" id="tagDescriptionForm">
      <h2>Edit tag descriptions</h2>
      <p class="hint">Descriptions appear when someone hovers a tag in the full unit profile. Leave a field blank for no explanation.</p>
      <div id="tagDescriptionRows" class="tag-description-rows"></div>
      <div class="row gap dialog-actions">
        <button value="cancel" type="button" id="btnCancelTagDescriptionEdit">Cancel</button>
        <button value="default" type="submit">Save</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.querySelector("#btnCancelTagDescriptionEdit")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("#tagDescriptionForm")?.addEventListener("submit", saveTagDescriptionEditor);
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
}

function openTagDescriptionEditor() {
  const dialog = document.getElementById("tagDescriptionDialog");
  const rows = document.getElementById("tagDescriptionRows");
  if (!dialog || !rows) return;
  rows.innerHTML = knownTagsForDescriptionEditor().map(tag => {
    const description = tagDescription(tag);
    return `<label class="tag-description-row"><span class="unit-profile-tag ${tagClass(tag)}">${escapeHtml(tag)}</span><textarea rows="2" data-tag="${escapeHtml(tag)}" placeholder="Explain what ${escapeHtml(tag)} means…">${escapeHtml(description)}</textarea></label>`;
  }).join("");
  dialog.showModal();
}

function saveTagDescriptionEditor(event) {
  event.preventDefault();
  const dialog = document.getElementById("tagDescriptionDialog");
  const next = {};
  dialog?.querySelectorAll("textarea[data-tag]").forEach(textarea => {
    const tag = sanitizeText(textarea.dataset.tag);
    const description = String(textarea.value || "").trim();
    if (tag && description) next[tag] = description;
  });
  state.tagDescriptions = normalizeTagDescriptions(next);
  state.updated = new Date().toISOString();
  dialog?.close();
  autoSave();
  setStatus("Tag descriptions saved.");
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
  const payload = { v: 4, updated: new Date().toISOString(), months: state.months, monthWeeks: getMonthWeeks(), tiers: state.tiers, metaStatuses: state.metaStatuses, tagDescriptions: state.tagDescriptions, units: state.units };
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
    for (const unit of state.units) if (hasVisibleMetaSegments(unit)) drawMetaLinksToCanvas(ctx, unit);
    for (const unit of state.units) if (hasVisibleMetaSegments(unit)) for (const segment of sortedVisibleSegments(unit)) drawBarToCanvas(ctx, unit, segment);
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
    ctx.fillText(month.toUpperCase(), x + monthPixelWidth(i) / 2, MONTH_H / 2);
  });
  ctx.font = canvasFont(900, 14);
  ctx.fillStyle = "#dce4f0";
  for (let w = 1; w <= weekCount(); w++) {
    const { weekInMonth } = weekToMonthWeek(w);
    ctx.fillText(`W${weekInMonth}`, weekX(w) + weekWidth(w) / 2, MONTH_H + WEEK_H / 2);
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
    const x = weekBoundaryX(w);
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
      roundedRect(ctx, LEFT_W + 10, y, baseChartWidth() - LEFT_W - 20, BAR_H, 9);
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
function drawMetaLinksToCanvas(ctx, unit) {
  for (const link of metaSegmentLinks(unit)) {
    const gradient = ctx.createLinearGradient(link.x, 0, link.x + link.w, 0);
    gradient.addColorStop(0, link.fromColor);
    gradient.addColorStop(1, link.toColor);
    roundedRect(ctx, link.x, link.y, link.w, META_LINK_H, META_LINK_H / 2);
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.78;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
function drawBarToCanvas(ctx, unit, segment) {
  const { x, y, w } = segmentBarRect(unit, segment);
  const segments = sortedVisibleSegments(unit);
  const index = segments.findIndex(s => s.id === segment.id);
  const joinsPrevious = index > 0 && metaSegmentsTouch(segments[index - 1], segment);
  const joinsNext = index >= 0 && index < segments.length - 1 && metaSegmentsTouch(segment, segments[index + 1]);
  roundedRectSides(ctx, x, y, w, BAR_H, BAR_H / 2, !joinsPrevious, !joinsNext);
  const color = segmentColor(segment);
  const textPresentation = metaBarTextPresentation(color);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  const text = `${unit.name} - ${metaStatus(segment.statusId).label}`;
  ctx.globalAlpha = 1;
  ctx.font = canvasBarFont(850, 12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  if (textPresentation.tone === "light") {
    ctx.lineWidth = Math.max(1, barFontPx(12) * 0.08);
    ctx.strokeStyle = "rgba(0,0,0,.58)";
    ctx.strokeText(text, x + w / 2, y + BAR_H / 2 + 0.5, Math.max(20, w - 14));
  }
  ctx.fillStyle = textPresentation.color;
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

function roundedRectSides(ctx, x, y, w, h, r, roundLeft = true, roundRight = true) {
  const rr = Math.min(r, w / 2, h / 2);
  const leftR = roundLeft ? rr : 0;
  const rightR = roundRight ? rr : 0;
  ctx.beginPath();
  ctx.moveTo(x + leftR, y);
  ctx.lineTo(x + w - rightR, y);
  if (rightR) ctx.arcTo(x + w, y, x + w, y + rightR, rightR);
  else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - rightR);
  if (rightR) ctx.arcTo(x + w, y + h, x + w - rightR, y + h, rightR);
  else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + leftR, y + h);
  if (leftR) ctx.arcTo(x, y + h, x, y + h - leftR, leftR);
  else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + leftR);
  if (leftR) ctx.arcTo(x, y, x + leftR, y, leftR);
  else ctx.lineTo(x, y);
  ctx.closePath();
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
    buildCatalogSourceIndices(catalog);
    const backfilled = backfillUnitSourceUrlsFromCatalog();
    els.catalogStatus.textContent = `Loaded ${catalog.length} catalog item(s).${backfilled ? ` Linked ${backfilled} existing roadmap item(s) to Altema.` : ""}`;
    renderCatalog();
  } catch (error) {
    els.catalogStatus.textContent = `Could not load local catalog: ${error.message}`;
  }
}

function normalizeAltemaSourceUrl(value, kind = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://altema.jp/");
    if (url.protocol !== "https:" || !/^(?:www\.)?altema\.jp$/i.test(url.hostname)) return "";
    const match = url.pathname.match(/^\/gundamuce\/(ms|chara)\/(\d+)\/?$/i);
    if (!match) return "";
    const expected = String(kind || "").toLowerCase() === "pilot" ? "chara" : String(kind || "").toLowerCase() === "ms" ? "ms" : "";
    if (expected && match[1].toLowerCase() !== expected) return "";
    return `https://altema.jp/gundamuce/${match[1].toLowerCase()}/${match[2]}`;
  } catch {
    return "";
  }
}

function catalogKindNameKey(kind, name) {
  return `${String(kind || "").trim().toLowerCase()}:${sanitizeText(name).toLowerCase()}`;
}

function buildCatalogSourceIndices(items = catalog) {
  catalogIconIndex = new Map();
  catalogKindNameIndex = new Map();
  for (const item of items || []) {
    const kind = String(item?.kind || item?.type || "").trim().toLowerCase();
    const sourceUrl = normalizeAltemaSourceUrl(item?.sourceUrl, kind);
    if (!sourceUrl) continue;
    for (const icon of [item?.icon, item?.remoteIcon]) {
      const key = String(icon || "").trim();
      if (key && !catalogIconIndex.has(key)) catalogIconIndex.set(key, sourceUrl);
    }
    const nameKey = catalogKindNameKey(kind, item?.name);
    if (!nameKey.endsWith(":")) {
      const existing = catalogKindNameIndex.get(nameKey);
      if (!existing) catalogKindNameIndex.set(nameKey, sourceUrl);
      else if (existing !== sourceUrl) catalogKindNameIndex.set(nameKey, null);
    }
  }
}

function catalogAltemaUrlForUnit(unit) {
  if (!unit) return "";
  const kind = String(unit.kind || unit.type || "").trim().toLowerCase();
  const direct = normalizeAltemaSourceUrl(unit.sourceUrl ?? unit.altemaUrl, kind);
  if (direct) return direct;
  const icon = String(unit.icon || "").trim();
  const byIcon = icon ? catalogIconIndex.get(icon) : "";
  if (byIcon) return normalizeAltemaSourceUrl(byIcon, kind);
  const byName = catalogKindNameIndex.get(catalogKindNameKey(kind, unit.name));
  return byName ? normalizeAltemaSourceUrl(byName, kind) : "";
}

function backfillUnitSourceUrlsFromCatalog() {
  let count = 0;
  for (const unit of state.units || []) {
    if (normalizeAltemaSourceUrl(unit.sourceUrl, unit.kind)) continue;
    const sourceUrl = catalogAltemaUrlForUnit(unit);
    if (!sourceUrl) continue;
    unit.sourceUrl = sourceUrl;
    count += 1;
  }
  return count;
}

const CATALOG_ATTRIBUTE_LABELS = Object.freeze({
  "赤": "red",
  "青": "blue",
  "緑": "green",
  "黄": "yellow",
  "紫": "purple"
});
const CATALOG_ROLE_LABELS = Object.freeze({
  "砲撃": "bombardment",
  "狙撃": "sniper",
  "強襲": "raid",
  "白兵": "close combat",
  "汎用": "generic",
  "重装": "armored",
  "支援": "support"
});
function catalogDisplayKind(item) {
  return String(item.kind || item.type || "").trim().toLowerCase();
}
function catalogDisplayAttribute(item) {
  const raw = String(item.attribute || "").trim();
  return CATALOG_ATTRIBUTE_LABELS[raw] || raw.toLowerCase();
}
function catalogDisplayRole(item) {
  const raw = String(item.role || "").trim();
  return CATALOG_ROLE_LABELS[raw] || raw.toLowerCase();
}
function catalogDisplayRating(item) {
  const raw = String(item.rating ?? "").trim();
  if (!raw) return "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value.toFixed(1) : raw.replace(/点$/u, "").trim();
}
function catalogSearchHaystack(item) {
  return [
    item.name,
    catalogDisplayKind(item),
    catalogDisplayAttribute(item),
    catalogDisplayRole(item),
    catalogDisplayRating(item),
    item.attribute,
    item.role
  ].filter(Boolean).join(" ").toLowerCase();
}
function renderCatalog() {
  const template = document.getElementById("catalogItemTemplate");
  const list = catalog.filter(item => {
    const kindOk = filterKind === "all" || item.kind === filterKind || item.type === filterKind;
    return kindOk && (!searchTerm || catalogSearchHaystack(item).includes(searchTerm));
  }).slice(0, 250);
  els.catalogList.innerHTML = "";
  list.forEach(item => {
    const node = template.content.firstElementChild.cloneNode(true);
    const img = node.querySelector("img");
    img.src = item.icon || "";
    img.alt = item.name || "";
    img.onerror = () => { img.src = placeholderDataUrl(item.name); };

    const fullName = item.name || "Unnamed";
    const nameEl = node.querySelector("strong");
    nameEl.textContent = fullName;

    const meta = [
      catalogDisplayKind(item),
      catalogDisplayAttribute(item),
      catalogDisplayRole(item),
      catalogDisplayRating(item)
    ].filter(Boolean).join(" · ");
    const metaEl = node.querySelector("small");
    metaEl.textContent = meta;
    bindAppTooltip(node, () => `<strong>${escapeHtml(fullName)}</strong>${meta ? `<div>${escapeHtml(meta)}</div>` : ""}`);
    node.querySelector("button").addEventListener("click", () => {
      addUnit({
        name: item.name,
        kind: item.kind || item.type || "custom",
        icon: item.icon || "",
        sourceUrl: item.sourceUrl || "",
        tags: [],
        minPotential: null,
        idealPotential: null,
        notesPvp: "",
        notesPve: ""
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

function bindAppTooltip(element, htmlFactory) {
  if (!element) return;
  element.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    showAppTooltip(event, htmlFactory, element);
  });
  // Deliberately do not reposition on pointermove. Pointermove can fire at a
  // very high rate; the tooltip is anchored to the reference element instead.
  element.addEventListener("pointerleave", hideAppTooltip);
  element.addEventListener("pointerdown", hideAppTooltip);
}

function showAppTooltip(event, htmlFactory, anchorEl = null) {
  hideAppTooltip();
  const html = typeof htmlFactory === "function" ? htmlFactory() : String(htmlFactory || "");
  if (!html) return;
  appTooltipEl = document.createElement("div");
  appTooltipEl.className = "tooltip app-tooltip";
  appTooltipEl.innerHTML = html;
  document.body.appendChild(appTooltipEl);
  appTooltipAnchorEl = anchorEl instanceof Element ? anchorEl : (event?.currentTarget instanceof Element ? event.currentTarget : null);
  positionFloatingTooltip(appTooltipEl, event, 320, appTooltipAnchorEl);
}

function hideAppTooltip() {
  appTooltipEl?.remove();
  appTooltipEl = null;
  appTooltipAnchorEl = null;
}

function tooltipIntersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return width * height;
}
function tooltipOwnerId(anchorEl) {
  return anchorEl?.dataset?.id || anchorEl?.dataset?.unitId || null;
}
function tooltipPlacementOrder(anchorEl, anchorRect) {
  const ownerId = tooltipOwnerId(anchorEl);
  if (ownerId && els.roadmap?.contains(anchorEl)) {
    if (anchorEl.classList.contains("unit-card")) {
      const lane = els.roadmap.querySelector(`.lane-track[data-unit-id="${CSS.escape(ownerId)}"]`);
      const laneRect = lane?.getBoundingClientRect();
      if (laneRect) return laneRect.top + laneRect.height / 2 >= anchorRect.top + anchorRect.height / 2
        ? ["top", "right", "left", "bottom"]
        : ["bottom", "right", "left", "top"];
    }
    if (anchorEl.classList.contains("meta-bar")) {
      const card = els.roadmap.querySelector(`.unit-card[data-id="${CSS.escape(ownerId)}"]`);
      const cardRect = card?.getBoundingClientRect();
      if (cardRect) return cardRect.top + cardRect.height / 2 <= anchorRect.top + anchorRect.height / 2
        ? ["bottom", "right", "left", "top"]
        : ["top", "right", "left", "bottom"];
    }
  }
  return ["right", "left", "bottom", "top"];
}
function tooltipOwnerObstacleRects(anchorEl) {
  if (!anchorEl || !els.roadmap?.contains(anchorEl)) return [];
  const ownerId = tooltipOwnerId(anchorEl);
  if (!ownerId) return [];
  const id = CSS.escape(ownerId);
  const nodes = els.roadmap.querySelectorAll(
    `.unit-card[data-id="${id}"],.meta-bar[data-id="${id}"],.meta-link[data-id="${id}"],` +
    `.meta-owner-tether[data-unit-id="${id}"],.meta-owner-node[data-unit-id="${id}"]`
  );
  return Array.from(nodes).filter(node => node !== anchorEl).map(node => {
    const rect = node.getBoundingClientRect();
    const weight = node.classList.contains("meta-bar") ? 12 : node.classList.contains("unit-card") ? 11 : 5;
    return { rect, weight };
  }).filter(item => item.rect.width > 0 && item.rect.height > 0);
}
function positionFloatingTooltip(element, event, maxWidth = 320, anchorEl = null) {
  if (!element) return;
  const margin = 12;
  const gap = element.classList.contains("unit-tooltip-card") ? 30 : 18;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  element.style.maxWidth = `${Math.max(180, Math.min(maxWidth, viewportWidth - (margin * 2)))}px`;
  const tooltipRect = element.getBoundingClientRect();
  const clientX = Number.isFinite(event?.clientX) ? event.clientX : viewportWidth / 2;
  const clientY = Number.isFinite(event?.clientY) ? event.clientY : viewportHeight / 2;
  const reference = anchorEl instanceof Element && anchorEl.isConnected ? anchorEl : null;
  const anchorRect = reference?.getBoundingClientRect() || { left: clientX, right: clientX, top: clientY, bottom: clientY, width: 0, height: 0 };
  const order = tooltipPlacementOrder(reference, anchorRect);
  const ownerObstacles = tooltipOwnerObstacleRects(reference);
  const maxLeft = Math.max(margin, viewportWidth - tooltipRect.width - margin);
  const maxTop = Math.max(margin, viewportHeight - tooltipRect.height - margin);
  const candidates = order.map((placement, preferenceIndex) => {
    let rawLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2;
    let rawTop = anchorRect.top + (anchorRect.height - tooltipRect.height) / 2;
    if (placement === "right") rawLeft = anchorRect.right + gap;
    if (placement === "left") rawLeft = anchorRect.left - tooltipRect.width - gap;
    if (placement === "bottom") rawTop = anchorRect.bottom + gap;
    if (placement === "top") rawTop = anchorRect.top - tooltipRect.height - gap;
    const left = clamp(rawLeft, margin, maxLeft);
    const top = clamp(rawTop, margin, maxTop);
    const candidateRect = { left, top, right: left + tooltipRect.width, bottom: top + tooltipRect.height };
    let score = preferenceIndex * 650 + (Math.abs(left - rawLeft) + Math.abs(top - rawTop)) * 18;
    const anchorOverlap = tooltipIntersectionArea(candidateRect, anchorRect);
    if (anchorOverlap) score += 2_000_000 + anchorOverlap * 20;
    for (const obstacle of ownerObstacles) {
      const area = tooltipIntersectionArea(candidateRect, obstacle.rect);
      if (area) score += obstacle.weight * (1800 + area);
    }
    return { left, top, placement, score };
  });
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  element.dataset.placement = best.placement;
  element.style.left = `${Math.round(best.left)}px`;
  element.style.top = `${Math.round(best.top)}px`;
}


function profileTagsHtml(unit) {
  if (!unit?.tags?.length) return "";
  return `<div class="unit-profile-tags">${unit.tags.map(tag => {
    const description = tagDescription(tag);
    return `<span class="unit-profile-tag ${tagClass(tag)}${description ? " has-description" : ""}" data-profile-tag="${escapeHtml(tag)}"${description ? ` aria-label="${escapeHtml(`${tag}: ${description}`)}"` : ""}>${escapeHtml(tag)}</span>`;
  }).join("")}</div>`;
}

function bindProfileTagTooltips(root) {
  root?.querySelectorAll(".unit-profile-tag[data-profile-tag]").forEach(chip => {
    const tag = chip.dataset.profileTag || "";
    const description = tagDescription(tag);
    if (!description) return;
    bindAppTooltip(chip, () => `<strong>${escapeHtml(tag)}</strong><div class="app-tooltip-description">${multilineHtml(description)}</div>`);
  });
}

function profileArtHtml(unit, typeLabel) {
  if (!unit) {
    return `<div class="unit-profile-art empty"><div class="unit-profile-placeholder">?</div><span>${escapeHtml(typeLabel)}</span></div>`;
  }
  const image = unit.icon
    ? `<img class="unit-profile-image" src="${escapeHtml(unit.icon)}" alt="${escapeHtml(unit.name)}" decoding="async"><div class="unit-profile-placeholder image-fallback">${escapeHtml(initials(unit.name))}</div>`
    : `<div class="unit-profile-placeholder">${escapeHtml(initials(unit.name))}</div>`;
  return `<div class="unit-profile-art">${image}</div>`;
}


function profileAltemaLinkHtml(unit) {
  if (!isMs(unit)) return "";
  const sourceUrl = catalogAltemaUrlForUnit(unit);
  if (!sourceUrl) return "";
  return `<a class="unit-profile-source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" data-profile-altema-link aria-label="See on Altema"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 5h5v5M19 5l-9 9M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5"/></svg></a>`;
}

function bindProfileAltemaTooltips(root) {
  root?.querySelectorAll("[data-profile-altema-link]").forEach(link => {
    let suppressUntilPointerLeaves = false;
    const showSourceTooltip = event => {
      if (suppressUntilPointerLeaves) return;
      showAppTooltip(event, () => `<strong>See on Altema</strong>`, link);
      appTooltipEl?.classList.add("unit-profile-source-tooltip");
    };
    link.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") showSourceTooltip(event); });
    link.addEventListener("pointerleave", () => {
      suppressUntilPointerLeaves = false;
      hideAppTooltip();
    });
    link.addEventListener("pointerdown", () => {
      suppressUntilPointerLeaves = true;
      hideAppTooltip();
    });
    link.addEventListener("focus", () => {
      if (suppressUntilPointerLeaves) return;
      const rect = link.getBoundingClientRect();
      showSourceTooltip({ clientX: rect.right, clientY: rect.top + rect.height / 2 });
    });
    link.addEventListener("blur", () => {
      // Keep suppression latched after activation. Opening Altema in a new tab can
      // blur and then refocus this link when the user returns; clearing the latch
      // here would make the tooltip immediately reappear without a fresh hover.
      hideAppTooltip();
    });
    link.addEventListener("click", () => {
      suppressUntilPointerLeaves = true;
      hideAppTooltip();
    });
  });
}

function profileContextHtml(unit) {
  if (!unit) return "";
  const color = tierById(unit.tier).color || "#8d96a6";
  return `<div class="unit-profile-context"><span class="unit-profile-tier" style="--profile-tier-color:${escapeHtml(color)}">${escapeHtml(normalizeRowOffset(unit.rowOffset) ? rowOffsetLabel(unit.rowOffset, unit.tier) : tierById(unit.tier).label)}</span><span>${escapeHtml(formatWeek(unit.week))}</span>${profileAltemaLinkHtml(unit)}</div>`;
}

function profileInvestmentHtml(unit) {
  if (!isMs(unit)) return "";
  const minimum = normalizePotentialLevel(unit.minPotential);
  const ideal = normalizePotentialLevel(unit.idealPotential);
  if (minimum == null && ideal == null) return "";
  const cells = [];
  if (minimum != null) cells.push(`<div class="unit-profile-investment-stat"><span>Minimum</span><strong>P${minimum}</strong></div>`);
  if (ideal != null) cells.push(`<div class="unit-profile-investment-stat"><span>Ideal</span><strong>P${ideal}</strong></div>`);
  return `<section class="unit-profile-section unit-profile-investment-section"><div class="unit-profile-section-title">Investment</div><div class="unit-profile-investment">${cells.join("")}</div></section>`;
}

function profileMetaHtml(unit, activeSegmentId = null) {
  if (!unit) return "";
  const segments = (unit.segments || []).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  if (!segments.length) return "";
  const rows = segments.map(seg => {
    const status = metaStatus(seg.statusId);
    const description = String(status.description || "").trim();
    const labelAttrs = description
      ? ` class="unit-profile-meta-label has-description" data-meta-label="${escapeHtml(status.label)}" data-meta-description="${escapeHtml(description)}" tabindex="0" role="button" aria-label="${escapeHtml(`${status.label}: ${description}`)}"`
      : ` class="unit-profile-meta-label"`;
    return `<div class="unit-profile-meta-row${activeSegmentId === seg.id ? " active" : ""}"><i style="background:${escapeHtml(status.color)}"></i><div class="unit-profile-meta-copy"><div class="unit-profile-meta-top"><strong${labelAttrs}>${escapeHtml(status.label)}</strong><span>${escapeHtml(formatWeekRange(seg.start, seg.end))}</span></div></div></div>`;
  }).join("");
  return `<section class="unit-profile-section unit-profile-meta-section"><div class="unit-profile-section-title">PVP Meta</div><div class="unit-profile-meta-list">${rows}</div></section>`;
}

function profileScrollableNotesHtml(title, text, emptyText, extraClass = "", expandable = false) {
  const content = String(text || "").trim();
  const readerAttrs = expandable && content ? ` data-note-reader="true" data-note-title="${escapeHtml(title)}"` : "";
  const readerButton = expandable && content
    ? `<button class="unit-profile-note-expand" type="button" aria-label="Open full ${escapeHtml(title)}" hidden><span aria-hidden="true">i</span></button>`
    : "";
  return `<section class="unit-profile-section unit-profile-scroll-notes ${extraClass}"${readerAttrs}><div class="unit-profile-section-heading"><div class="unit-profile-section-title">${escapeHtml(title)}</div>${readerButton}</div><div class="unit-profile-note-scroll">${content ? `<div class="unit-profile-note-copy">${multilineHtml(content)}</div>` : `<div class="unit-profile-note-empty">${escapeHtml(emptyText)}</div>`}</div></section>`;
}

function bindProfileMetaTooltips(root) {
  root?.querySelectorAll(".unit-profile-meta-label[data-meta-description]").forEach(label => {
    const metaLabel = label.dataset.metaLabel || label.textContent || "PVP Meta";
    const description = label.dataset.metaDescription || "";
    const htmlFactory = () => `<strong>${escapeHtml(metaLabel)}</strong><div class="app-tooltip-description">${multilineHtml(description)}</div>`;
    bindAppTooltip(label, htmlFactory);
    label.addEventListener("focus", () => {
      const rect = label.getBoundingClientRect();
      showAppTooltip({ clientX: rect.left + rect.width / 2, clientY: rect.bottom }, htmlFactory, label);
    });
    label.addEventListener("blur", hideAppTooltip);
    label.addEventListener("pointerdown", event => {
      if (event.pointerType !== "touch") return;
      showAppTooltip(event, htmlFactory, label);
    });
    label.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const rect = label.getBoundingClientRect();
      showAppTooltip({ clientX: rect.left + rect.width / 2, clientY: rect.bottom }, htmlFactory, label);
    });
  });
}

function openUnitNoteReader(title, text, sourceButton = null) {
  const content = String(text || "").trim();
  if (!content) return;
  closeUnitNoteReader(true);
  hideAppTooltip();
  unitNoteReaderReturnFocus = sourceButton instanceof HTMLElement ? sourceButton : null;

  const overlay = document.createElement("div");
  overlay.className = "unit-note-reader-overlay";
  overlay.innerHTML = `
    <article class="unit-note-reader-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)} full notes">
      <header class="unit-note-reader-header">
        <div><span>FULL NOTES</span><h2>${escapeHtml(title)}</h2></div>
        <button class="unit-note-reader-close" type="button" aria-label="Close full notes">×</button>
      </header>
      <div class="unit-note-reader-body">${multilineHtml(content)}</div>
    </article>`;
  overlay.addEventListener("click", event => { if (event.target === overlay) closeUnitNoteReader(); });
  overlay.querySelector(".unit-note-reader-close")?.addEventListener("click", () => closeUnitNoteReader());
  overlay.addEventListener("keydown", event => {
    if (event.key === "Tab") {
      event.preventDefault();
      overlay.querySelector(".unit-note-reader-close")?.focus({ preventScroll: true });
    }
  });
  document.body.appendChild(overlay);
  unitNoteReaderOverlay = overlay;
  overlay.querySelector(".unit-note-reader-close")?.focus({ preventScroll: true });
}

function closeUnitNoteReader(immediate = false) {
  if (!unitNoteReaderOverlay) return;
  const overlay = unitNoteReaderOverlay;
  if (overlay.classList.contains("closing") && !immediate) return;
  const returnFocus = unitNoteReaderReturnFocus;
  unitNoteReaderOverlay = null;
  unitNoteReaderReturnFocus = null;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    overlay.remove();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };
  if (immediate || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    finish();
    return;
  }
  overlay.classList.add("closing");
  overlay.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, 260);
}

function bindProfileNoteReaders(root) {
  unitProfileOverflowObserver?.disconnect();
  unitProfileOverflowObserver = null;
  unitProfileLayoutObserver?.disconnect();
  unitProfileLayoutObserver = null;
  const sections = [...(root?.querySelectorAll('.unit-profile-scroll-notes[data-note-reader="true"]') || [])];
  if (!sections.length) return;

  const updateSection = section => {
    const scroller = section.querySelector(".unit-profile-note-scroll");
    const copy = section.querySelector(".unit-profile-note-copy");
    const button = section.querySelector(".unit-profile-note-expand");
    if (!scroller || !copy || !button) return;
    const overflowed = scroller.scrollHeight > scroller.clientHeight + 2;
    button.hidden = !overflowed;
    section.classList.toggle("has-note-overflow", overflowed);
  };

  sections.forEach(section => {
    const button = section.querySelector(".unit-profile-note-expand");
    button?.addEventListener("click", event => {
      event.stopPropagation();
      const copy = section.querySelector(".unit-profile-note-copy");
      openUnitNoteReader(section.dataset.noteTitle || "Notes", copy?.innerText || copy?.textContent || "", button);
    });
  });

  if (typeof ResizeObserver === "function") {
    unitProfileOverflowObserver = new ResizeObserver(entries => {
      entries.forEach(entry => {
        const section = entry.target.closest?.('.unit-profile-scroll-notes[data-note-reader="true"]') || entry.target;
        if (section?.matches?.('.unit-profile-scroll-notes[data-note-reader="true"]')) updateSection(section);
      });
    });
    sections.forEach(section => {
      unitProfileOverflowObserver.observe(section);
      const scroller = section.querySelector(".unit-profile-note-scroll");
      if (scroller) unitProfileOverflowObserver.observe(scroller);
    });
  }

  const updateAll = () => sections.forEach(updateSection);
  requestAnimationFrame(() => requestAnimationFrame(updateAll));
  setTimeout(updateAll, 120);
}


function profileRequiredContentBottom(panel, target) {
  if (!panel || !target) return 0;
  const panelRect = panel.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const panelStyle = getComputedStyle(panel);
  const paddingBottom = Number.parseFloat(panelStyle.paddingBottom) || 0;
  const fullTargetHeight = Math.max(targetRect.height, target.scrollHeight || 0);
  return Math.ceil((targetRect.top - panelRect.top) + fullTargetHeight + paddingBottom);
}

function updateUnitProfileAdaptiveRows(root) {
  const grid = root?.querySelector('.unit-profile-grid-lshape');
  if (!grid) return;

  // Mobile uses one continuous stacked scroll surface; row sizing only applies to desktop.
  if (window.matchMedia?.('(max-width: 820px)')?.matches) {
    grid.style.removeProperty('--profile-top-row');
    return;
  }

  const gridHeight = grid.clientHeight;
  if (gridHeight <= 0) return;

  const msPanel = grid.querySelector(':scope > .unit-profile-ms-panel');
  const pilotPrimary = grid.querySelector(':scope > .unit-profile-pilot-panel > .unit-profile-pilot-primary');
  const metaList = msPanel?.querySelector('.unit-profile-meta-list');
  const pilotNotes = pilotPrimary?.querySelector('.unit-profile-pilot-notes .unit-profile-note-scroll');

  // Measure the deepest real content node, not the scroll container itself: a flexing scroll
  // container is always at least as tall as its assigned row and would make every unit look
  // artificially identical. The last meta row / pilot note copy reveal the true content depth.
  const msTarget = metaList?.querySelector('.unit-profile-meta-row:last-child') || metaList || msPanel?.lastElementChild;
  const pilotTarget = pilotNotes?.querySelector('.unit-profile-note-copy, .unit-profile-note-empty') || pilotNotes || pilotPrimary?.lastElementChild;
  const msRequired = profileRequiredContentBottom(msPanel, msTarget);
  const pilotRequired = profileRequiredContentBottom(pilotPrimary, pilotTarget);

  // Leave a small measured safety margin above the exact content bottom. Without it,
  // fractional font/layout rounding can produce a 1-2px scroll range even when every
  // visible line appears to fit, which makes an unnecessary scrollbar flash into view.
  const topContentBuffer = 12;

  // Notes are the flexible, lower-priority region, but always retain a usable preview floor.
  // On shorter windows that floor shrinks modestly; on taller windows it is capped so unused
  // top-row space naturally flows back into PVP/PVE notes.
  const notesFloor = clamp(Math.round(gridHeight * 0.24), 130, 190);
  const maxTop = Math.max(0, gridHeight - notesFloor);
  const topFloor = Math.min(maxTop, clamp(Math.round(gridHeight * 0.4), 250, 330));
  const desiredTop = Math.max(topFloor, msRequired + topContentBuffer, pilotRequired + topContentBuffer);
  const topHeight = Math.min(maxTop, Math.ceil(desiredTop));

  grid.style.setProperty('--profile-top-row', `${topHeight}px`);
}

function bindUnitProfileAdaptiveRows(root) {
  unitProfileLayoutObserver?.disconnect();
  unitProfileLayoutObserver = null;

  const card = root?.querySelector('.unit-profile-card');
  if (!card) return;

  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => updateUnitProfileAdaptiveRows(root));
  };

  if (typeof ResizeObserver === 'function') {
    unitProfileLayoutObserver = new ResizeObserver(update);
    unitProfileLayoutObserver.observe(card);
  }

  requestAnimationFrame(() => requestAnimationFrame(update));
  setTimeout(update, 120);
  if (document.fonts?.ready) document.fonts.ready.then(update).catch(() => {});
}

function profileTimelineMsUnits() {
  return state.units
    .filter(isMs)
    .slice()
    .sort((a, b) =>
      normalizeWeek(a.week) - normalizeWeek(b.week)
      || (tierIndex(a.tier) + normalizeRowOffset(a.rowOffset)) - (tierIndex(b.tier) + normalizeRowOffset(b.rowOffset))
      || (Number(a.stackOrder) || 0) - (Number(b.stackOrder) || 0)
      || a.name.localeCompare(b.name)
      || a.id.localeCompare(b.id)
    );
}

function profileNavigationTargets(clicked, ms) {
  const timeline = profileTimelineMsUnits();
  if (!timeline.length) return { previous: null, next: null };

  if (ms) {
    const index = timeline.findIndex(unit => unit.id === ms.id);
    if (index >= 0) {
      return {
        previous: index > 0 ? timeline[index - 1] : null,
        next: index < timeline.length - 1 ? timeline[index + 1] : null
      };
    }
  }

  // A standalone pilot can still move into the MS timeline from its visual position.
  const anchorWeek = normalizeWeek(clicked?.week);
  const anchorRow = tierIndex(clicked?.tier) + normalizeRowOffset(clicked?.rowOffset);
  let insertion = timeline.findIndex(unit =>
    normalizeWeek(unit.week) > anchorWeek
    || (normalizeWeek(unit.week) === anchorWeek
      && tierIndex(unit.tier) + normalizeRowOffset(unit.rowOffset) > anchorRow)
  );
  if (insertion < 0) insertion = timeline.length;
  return {
    previous: insertion > 0 ? timeline[insertion - 1] : null,
    next: insertion < timeline.length ? timeline[insertion] : null
  };
}

function navigateUnitProfile(direction) {
  if (!unitProfileOverlay) return;
  const targetId = direction < 0
    ? unitProfileOverlay.dataset.previousMsId
    : unitProfileOverlay.dataset.nextMsId;
  if (!targetId) return;

  const originalReturnFocus = profileReturnFocus;
  openUnitProfile(targetId);
  profileReturnFocus = originalReturnFocus;

  const selector = direction < 0 ? ".unit-profile-nav-prev" : ".unit-profile-nav-next";
  requestAnimationFrame(() => {
    const button = unitProfileOverlay?.querySelector(selector);
    if (button && !button.disabled) button.focus({ preventScroll: true });
  });
}

function profilePanelHeaderHtml(unit, label, emptyMessage) {
  if (!unit) {
    return `<div class="unit-profile-empty">${profileArtHtml(null, label)}<div><span class="unit-profile-eyebrow">${escapeHtml(label)}</span><h2>${escapeHtml(emptyMessage)}</h2><p>This roadmap entry does not currently have a paired ${label.toLowerCase()} in the same release slot.</p></div></div>`;
  }
  return `<div class="unit-profile-hero">${profileArtHtml(unit, label)}<div class="unit-profile-identity"><span class="unit-profile-eyebrow">${escapeHtml(label)}</span><h2>${escapeHtml(unit.name)}</h2>${profileContextHtml(unit)}${profileTagsHtml(unit)}</div></div>`;
}

function openUnitProfile(unitId, activeSegmentId = null) {
  const clicked = state.units.find(unit => unit.id === unitId);
  if (!clicked || (!isMs(clicked) && !isPilot(clicked))) return;
  hideTooltip(true);
  hideAppTooltip();
  hideContextMenu();
  closeUnitProfile(true);

  const ms = isMs(clicked) ? clicked : pairedMsForPilot(clicked);
  const pilot = isPilot(clicked) ? clicked : pairedPilotForMs(clicked);
  const activeId = ms ? (activeSegmentId || selectedSegment(ms)?.id || null) : null;
  const { previous, next } = profileNavigationTargets(clicked, ms);
  profileReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = document.createElement("div");
  overlay.className = "unit-profile-overlay";
  overlay.dataset.previousMsId = previous?.id || "";
  overlay.dataset.nextMsId = next?.id || "";
  overlay.innerHTML = `
    <button class="unit-profile-nav unit-profile-nav-prev" type="button" aria-label="${escapeHtml(previous ? `Previous MS: ${previous.name}` : "No previous MS")}" ${previous ? "" : "disabled"}><span aria-hidden="true">‹</span></button>
    <article class="unit-profile-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(ms?.name || pilot?.name || "Unit profile")}">
      <button class="unit-profile-close" type="button" aria-label="Close profile">×</button>
      <div class="unit-profile-grid unit-profile-grid-lshape${ms && (ms.segments || []).length >= 5 ? " meta-very-dense" : ms && (ms.segments || []).length >= 3 ? " meta-dense" : ""}">
        <section class="unit-profile-panel unit-profile-ms-panel">
          ${profilePanelHeaderHtml(ms, "MOBILE SUIT", "No paired MS")}
          ${ms ? profileInvestmentHtml(ms) : ""}
          ${ms ? profileMetaHtml(ms, activeId) : ""}
        </section>
        <section class="unit-profile-panel unit-profile-pilot-panel">
          <div class="unit-profile-pilot-primary">
            ${profilePanelHeaderHtml(pilot, "PILOT", "No paired pilot")}
            ${pilot ? profileScrollableNotesHtml("Pilot Notes", [pilot.notesPvp, pilot.notesPve].filter(Boolean).join("\n\n"), "No pilot notes added.", "unit-profile-pilot-notes", false) : ""}
          </div>
        </section>
        <section class="unit-profile-ms-notes-band" aria-label="Mobile Suit notes">
          <div class="unit-profile-ms-note-cell unit-profile-ms-pvp-cell">
            ${ms ? profileScrollableNotesHtml("PVP Notes", ms.notesPvp, "No PVP notes added.", "unit-profile-pvp-notes", true) : `<div class="unit-profile-note-empty standalone">No paired MS PVP notes.</div>`}
          </div>
          <div class="unit-profile-ms-note-cell unit-profile-ms-pve-cell">
            ${ms ? profileScrollableNotesHtml("PVE Notes", ms.notesPve, "No PVE notes added.", "unit-profile-pve-notes", true) : `<div class="unit-profile-note-empty standalone">No paired MS PVE notes.</div>`}
          </div>
        </section>
      </div>
    </article>
    <button class="unit-profile-nav unit-profile-nav-next" type="button" aria-label="${escapeHtml(next ? `Next MS: ${next.name}` : "No next MS")}" ${next ? "" : "disabled"}><span aria-hidden="true">›</span></button>`;

  overlay.addEventListener("click", event => { if (event.target === overlay) closeUnitProfile(); });
  overlay.querySelector(".unit-profile-close")?.addEventListener("click", () => closeUnitProfile());
  overlay.querySelector(".unit-profile-nav-prev")?.addEventListener("click", event => {
    event.stopPropagation();
    navigateUnitProfile(-1);
  });
  overlay.querySelector(".unit-profile-nav-next")?.addEventListener("click", event => {
    event.stopPropagation();
    navigateUnitProfile(1);
  });
  overlay.querySelectorAll(".unit-profile-image").forEach(img => {
    img.addEventListener("error", () => {
      img.style.display = "none";
      const fallback = img.nextElementSibling;
      if (fallback) fallback.classList.remove("image-fallback");
    }, { once: true });
  });
  document.body.appendChild(overlay);
  document.body.classList.add("unit-profile-open");
  unitProfileOverlay = overlay;
  bindProfileTagTooltips(overlay);
  bindProfileMetaTooltips(overlay);
  bindProfileAltemaTooltips(overlay);
  // Let the profile shell paint before installing geometry/overflow observers.
  // Those observers are important for adaptive sizing, but they do not need to
  // block the click-to-profile response on large Firefox roadmaps.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (unitProfileOverlay !== overlay || !overlay.isConnected) return;
    bindUnitProfileAdaptiveRows(overlay);
    bindProfileNoteReaders(overlay);
  }));
  overlay.querySelector(".unit-profile-close")?.focus({ preventScroll: true });
}

function closeUnitProfile(immediate = false) {
  closeUnitNoteReader(true);
  unitProfileOverflowObserver?.disconnect();
  unitProfileOverflowObserver = null;
  if (profileOpenTimer) {
    clearTimeout(profileOpenTimer);
    profileOpenTimer = null;
  }
  if (!unitProfileOverlay) return;
  const overlay = unitProfileOverlay;
  if (overlay.classList.contains("closing") && !immediate) return;
  const returnFocus = profileReturnFocus;
  unitProfileOverlay = null;
  profileReturnFocus = null;
  hideAppTooltip();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    overlay.remove();
    if (!document.querySelector(".unit-profile-overlay")) document.body.classList.remove("unit-profile-open");
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };

  if (immediate || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    finish();
    return;
  }

  overlay.classList.add("closing");
  const onAnimationEnd = (event) => {
    if (event.target !== overlay) return;
    overlay.removeEventListener("animationend", onAnimationEnd);
    finish();
  };
  overlay.addEventListener("animationend", onAnimationEnd);
  setTimeout(finish, 260);
}

let unitTooltipWarmupScheduled = false;
function scheduleUnitTooltipWarmup() {
  if (unitTooltipWarmupScheduled) return;
  unitTooltipWarmupScheduled = true;
  const run = () => {
    unitTooltipWarmupScheduled = false;
    if (tooltipEl || document.hidden) return;
    const warm = document.createElement("div");
    warm.className = "tooltip unit-tooltip-card";
    warm.setAttribute("aria-hidden", "true");
    warm.style.visibility = "hidden";
    warm.style.left = "-10000px";
    warm.style.top = "0";
    warm.innerHTML = `<div class="tooltip-card-header"><h3 class="tooltip-card-title">Preview</h3><div class="tooltip-card-context"><span class="tooltip-tier-badge">Tier</span><span class="tooltip-release">W1</span></div><div class="tooltip-tags"><span class="tooltip-tag">PVP</span><span class="tooltip-tag buff">Buff</span></div></div><div class="tooltip-card-body"><section class="tooltip-card-section tooltip-meta-section"><div class="tooltip-section-title">PVP Meta</div><div class="tooltip-meta-list"><div class="tooltip-meta-row"><i class="tooltip-meta-dot"></i><span class="tooltip-meta-status">Strong</span><span class="tooltip-meta-range">W1–W4</span></div></div></section><section class="tooltip-card-section tooltip-notes-section"><div class="tooltip-section-title">Notes</div><div class="tooltip-note-body">Preview</div></section></div>`;
    document.body.appendChild(warm);
    // One idle geometry read pays the first-use style/layout setup cost outside
    // the user's hover interaction. The element is immediately discarded.
    warm.getBoundingClientRect();
    warm.remove();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 900 });
  else setTimeout(run, 180);
}

function showTooltip(event, unit, segment = null, options = {}) {
  const shouldPin = !!options.pin;
  if (tooltipPinned && !shouldPin) return;
  hideAppTooltip();
  hideTooltip(true);
  const pairedMs = isPilot(unit) ? pairedMsForPilot(unit) : null;
  const metaUnit = hasMetaBars(unit) ? unit : pairedMs;
  const title = pairedMs ? `${unit.name} (${pairedMs.name})` : unit.name;
  const activeId = metaUnit ? (segment?.id || selectedSegment(metaUnit)?.id || null) : null;
  const rowLabel = normalizeRowOffset(unit.rowOffset) ? rowOffsetLabel(unit.rowOffset, unit.tier) : tierById(unit.tier).label;
  const tierColor = tierById(unit.tier).color || "#8d96a6";
  const tagHtml = unit.tags.length
    ? `<div class="tooltip-tags">${unit.tags.map(tag => `<span class="tooltip-tag ${tagClass(tag)}">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const investmentHtml = tooltipInvestmentHtml(unit);
  const metaHtml = metaUnit ? tooltipMetaHtml(metaUnit, activeId, isPilot(unit)) : "";
  const notesHtml = tooltipNotesHtml(unit);

  tooltipEl = document.createElement("div");
  tooltipEl.className = `tooltip unit-tooltip-card${shouldPin ? " pinned" : ""}`;
  tooltipEl.setAttribute("role", "tooltip");
  tooltipEl.innerHTML = `
    <div class="tooltip-card-header">
      <h3 class="tooltip-card-title">${escapeHtml(title)}</h3>
      <div class="tooltip-card-context">
        <span class="tooltip-tier-badge" style="--tooltip-tier-color:${escapeHtml(tierColor)}">${escapeHtml(rowLabel)}</span>
        <span class="tooltip-release">${escapeHtml(formatWeek(unit.week))}</span>
      </div>
      ${tagHtml}
    </div>
    <div class="tooltip-card-body">
      ${investmentHtml}
      ${metaHtml}
      ${notesHtml}
    </div>`;
  document.body.appendChild(tooltipEl);
  tooltipAnchorEl = options.anchor instanceof Element ? options.anchor : (event?.currentTarget instanceof Element ? event.currentTarget : null);
  moveTooltip(event, true);
  tooltipPinned = shouldPin;
}

function multilineHtml(text) {
  return escapeHtml(String(text || "").trim()).replace(/\r?\n/g, "<br>");
}

function tooltipSection(title, body, extraClass = "") {
  if (!body) return "";
  return `<section class="tooltip-card-section${extraClass ? ` ${extraClass}` : ""}"><div class="tooltip-section-title">${escapeHtml(title)}</div>${body}</section>`;
}

function tooltipInvestmentHtml(unit) {
  if (!isMs(unit)) return "";
  const minimum = normalizePotentialLevel(unit.minPotential);
  const ideal = normalizePotentialLevel(unit.idealPotential);
  if (minimum == null && ideal == null) return "";
  const stats = [];
  if (minimum != null) stats.push(`<div class="tooltip-investment-stat"><span class="tooltip-investment-label">Minimum</span><strong class="tooltip-investment-value">P${minimum}</strong></div>`);
  if (ideal != null) stats.push(`<div class="tooltip-investment-stat"><span class="tooltip-investment-label">Ideal</span><strong class="tooltip-investment-value">P${ideal}</strong></div>`);
  return tooltipSection("Investment", `<div class="tooltip-investment-summary">${stats.join("")}</div>`, "tooltip-investment");
}

function tooltipNotesHtml(unit) {
  if (isPilot(unit)) {
    const notes = [unit.notesPvp, unit.notesPve].filter(Boolean).join("\n\n");
    return notes ? tooltipSection("Notes", `<div class="tooltip-note-body">${multilineHtml(notes)}</div>`, "tooltip-notes-section") : "";
  }
  const blocks = [];
  if (unit.notesPvp) blocks.push(`<div class="tooltip-note-block"><span class="tooltip-note-mode">PVP</span><div class="tooltip-note-body">${multilineHtml(unit.notesPvp)}</div></div>`);
  if (unit.notesPve) blocks.push(`<div class="tooltip-note-block"><span class="tooltip-note-mode">PVE</span><div class="tooltip-note-body">${multilineHtml(unit.notesPve)}</div></div>`);
  return blocks.length ? tooltipSection("Notes", `<div class="tooltip-note-list">${blocks.join("")}</div>`, "tooltip-notes-section") : "";
}

function tooltipMetaHtml(unit, activeSegmentId = null, inheritedFromMs = false) {
  const segments = (unit.segments || []).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  if (!segments.length) return "";
  const rows = segments.map(seg => {
    const status = metaStatus(seg.statusId);
    const active = activeSegmentId === seg.id ? " active" : "";
    return `<div class="tooltip-meta-row${active}"><i class="tooltip-meta-dot" style="background:${escapeHtml(status.color)}"></i><span class="tooltip-meta-status">${escapeHtml(status.label)}</span><span class="tooltip-meta-range">${escapeHtml(formatWeekRange(seg.start, seg.end))}</span></div>`;
  }).join("");
  return tooltipSection(inheritedFromMs ? "MS PVP Meta" : "PVP Meta", `<div class="tooltip-meta-list">${rows}</div>`, "tooltip-meta-section");
}

function moveTooltip(event, force = false) {
  if (!tooltipEl || (tooltipPinned && !force)) return;
  positionFloatingTooltip(tooltipEl, event, 360, tooltipAnchorEl);
}
function hideTooltip(force = false) {
  const shouldForce = force === true;
  if (tooltipPinned && !shouldForce) return;
  tooltipEl?.remove();
  tooltipEl = null;
  tooltipPinned = false;
  tooltipAnchorEl = null;
}
function escapeHtml(text) { return String(text || "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch])); }

init();
