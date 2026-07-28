import "./styles.css";
import {
  Capacitor,
  CapacitorHttp,
  registerPlugin,
  SystemBars,
  SystemBarsStyle,
} from "@capacitor/core";
import metroDataset from "./data/metro-areas.json";
import stateDataset from "./data/states.json";
import { buildAreaCountyRows, buildAreaYearMatrix } from "./excel.js";
import {
  BEA_ENDPOINT,
  DEFAULT_PARAMETERS,
  aggregateByAreas,
  buildBeaUrl,
  buildNipaRequestParameters,
  buildRequestParameters,
  chunkValues,
  collectAreaFips,
  filterRecordsForTable,
  mapCountryGdpRecords,
  mapStateRecords,
  parseBeaPayload,
  sanitizeFilename,
} from "./bea.js";

const IS_ANDROID =
  Capacitor.getPlatform() === "android"
  || document.documentElement.classList.contains("is-android");
const SaveLocation = registerPlugin("SaveLocation");
document.documentElement.classList.toggle("is-android", IS_ANDROID);

const API_BATCH_SIZE = 75;
const API_CONCURRENCY = 3;
const BEA_PROXY_ENDPOINT = "/api/bea";
const SEARCH_RESULT_LIMIT = 50;
const PREVIEW_ROW_LIMIT = IS_ANDROID ? 5 : 500;
const ANDROID_MOTION_DURATION = 850;
const ANDROID_MOTION_DURATION_CLOSE = 550;
const ANDROID_MOTION_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const DEFAULT_GITHUB_URL = "https://github.com/BillydavisUSA/U.S.-BEA-GDP-Tools";
const GITHUB_URL = (() => {
  const candidate = String(import.meta.env.VITE_GITHUB_URL ?? DEFAULT_GITHUB_URL).trim();
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && ["github.com", "www.github.com"].includes(url.hostname)
      ? url.href
      : "";
  } catch {
    return "";
  }
})();
const TABLE_CONFIG = Object.freeze({
  CAGDP1: Object.freeze({
    label: "GDP",
    defaultLineCode: "3",
    filename: "BEA_Gross_Domestic_Product",
    firstYear: 2001,
    lastYear: 2024,
    lineCodes: Object.freeze([
      Object.freeze({ value: "1", label: "Real GDP" }),
      Object.freeze({ value: "3", label: "Current-dollar GDP" }),
    ]),
  }),
  CAINC1: Object.freeze({
    label: "Population",
    defaultLineCode: "2",
    filename: "BEA_Population",
    firstYear: 2001,
    lastYear: 2024,
    lineCodes: Object.freeze([
      Object.freeze({ value: "2", label: "Population" }),
    ]),
  }),
  SAGDP1: Object.freeze({
    label: "GDP",
    defaultLineCode: "3",
    filename: "BEA_State_GDP",
    firstYear: 1997,
    lastYear: 2025,
    lineCodes: Object.freeze([
      Object.freeze({ value: "1", label: "Real GDP" }),
      Object.freeze({ value: "3", label: "Current-dollar GDP" }),
    ]),
  }),
  SAINC1: Object.freeze({
    label: "Population",
    defaultLineCode: "2",
    filename: "BEA_State_Population",
    firstYear: 1929,
    lastYear: 2025,
    lineCodes: Object.freeze([
      Object.freeze({ value: "2", label: "Population" }),
    ]),
  }),
  NIPA_GDP: Object.freeze({
    label: "GDP",
    defaultLineCode: "current",
    filename: "BEA_United_States_GDP",
    firstYear: 1929,
    lastYear: 2025,
    lineCodes: Object.freeze([
      Object.freeze({ value: "current", label: "Current-dollar GDP" }),
      Object.freeze({ value: "real", label: "Real GDP" }),
    ]),
  }),
});
const GEOGRAPHY_TABLES = Object.freeze({
  county: Object.freeze(["CAGDP1", "CAINC1"]),
  state: Object.freeze(["SAGDP1", "SAINC1"]),
  country: Object.freeze(["NIPA_GDP"]),
});
const COUNTRY_AREA = Object.freeze({
  id: "country-us",
  type: "country",
  code: "US",
  name: "United States",
  fips: Object.freeze([]),
});
const VERSION_INFORMATION = Object.freeze({
  windows: Object.freeze({
    description:
      "The first stable Windows x64 release of Metro Studio, covering national, state, MSA, and CSA data workflows.",
    platform: "Windows",
    architecture: "x64",
    releaseTitle: "Initial Windows x64 release",
    changes: Object.freeze([
      "Explore national data, 51 state geographies, 393 MSAs, and 184 CSAs.",
      "Query current-dollar GDP, real GDP in chained dollars, and population across official BEA periods.",
      "Aggregate eligible county records using OMB Bulletin 23-01 metro delineations while preserving county DataValue and NoteRef details.",
      "Load annual or quarterly national GDP, calculate optional quarterly cumulative values, and export multi-sheet Excel workbooks.",
      "Send BEA requests through an isolated Electron process and save Excel files locally, with light, dark, and reduced-motion support.",
    ]),
  }),
  android: Object.freeze({
    description:
      "The first stable Android x86_64 release of Metro Studio, optimized for Android 12 and later.",
    platform: "Android",
    architecture: "x86_64",
    releaseTitle: "Initial Android x86_64 release",
    changes: Object.freeze([
      "Explore national data, 51 state geographies, 393 MSAs, and 184 CSAs from a mobile-first interface.",
      "Query current-dollar GDP, real GDP in chained dollars, and population across official BEA periods.",
      "Aggregate eligible county records using OMB Bulletin 23-01 metro delineations while preserving county DataValue and NoteRef details.",
      "Load annual or quarterly national GDP, calculate optional quarterly cumulative values, and export multi-sheet Excel workbooks.",
      "Use native BEA networking, a persistent save location, and the Android share sheet, with animated controls plus light, dark, and reduced-motion support.",
    ]),
  }),
});
const COUNTRY_TABLES = Object.freeze({
  A: Object.freeze({
    current: Object.freeze({ tableName: "T10105", firstYear: 1929, lastYear: 2025 }),
    real: Object.freeze({ tableName: "T10106", firstYear: 1929, lastYear: 2025 }),
  }),
  Q: Object.freeze({
    current: Object.freeze({ tableName: "T80105", firstYear: 1947, lastYear: 2026 }),
    real: Object.freeze({ tableName: "T80106", firstYear: 2002, lastYear: 2026 }),
  }),
});
const AREA_LABELS = Object.freeze({
  msa: "MSA",
  csa: "CSA",
  state: "State",
  country: "Country",
});

const elements = {
  form: document.querySelector("#request-form"),
  geographyLevel: document.querySelector("#geography-level"),
  lineCode: document.querySelector("#line-code"),
  tableName: document.querySelector("#table-name"),
  year: document.querySelector("#year"),
  frequency: document.querySelector("#frequency"),
  quarterlyMode: document.querySelector("#quarterly-mode"),
  countryMeasureControls: [...document.querySelectorAll(".country-measure-control")],
  quarterlyModeField: document.querySelector("#quarterly-mode-field"),
  frequencyField: document.querySelector("#frequency")?.closest(".field"),
  scopeMotionSlot: document.querySelector("#scope-motion-slot"),
  countryMeasureSlot: document.querySelector("#country-measure-slot"),
  quarterlyMotionSlot: document.querySelector("#quarterly-motion-slot"),
  filename: document.querySelector("#filename"),
  filenameError: document.querySelector("#filename-error"),
  areaError: document.querySelector("#area-error"),
  scopeCountBadge: document.querySelector("#scope-count-badge"),
  countyScopeControls: [...document.querySelectorAll(".county-scope-control")],
  selectableScopeControls: [...document.querySelectorAll(".selectable-scope-control")],
  countryScopeSummary: document.querySelector("#country-scope-summary"),
  geographySearchLabel: document.querySelector("#geography-search-label"),
  areaFilterControl: document.querySelector(".area-filter"),
  areaFilterButtons: [...document.querySelectorAll(".area-filter-button")],
  metroSearch: document.querySelector("#metro-search"),
  clearSearch: document.querySelector("#clear-search"),
  metroResults: document.querySelector("#metro-results"),
  selectAllAreas: document.querySelector("#select-all-areas"),
  selectAllLabel: document.querySelector("#select-all-label"),
  selectAllCount: document.querySelector("#select-all-count"),
  selectedArea: document.querySelector("#selected-area"),
  selectedAreaType: document.querySelector("#selected-area-type"),
  selectedAreaName: document.querySelector("#selected-area-name"),
  selectedAreaDetail: document.querySelector("#selected-area-detail"),
  clearSelection: document.querySelector("#clear-selection"),
  fetchButton: document.querySelector("#fetch-button"),
  exportButton: document.querySelector("#export-button"),
  retryButton: document.querySelector("#retry-button"),
  emptyState: document.querySelector("#empty-state"),
  loadingState: document.querySelector("#loading-state"),
  errorState: document.querySelector("#error-state"),
  successState: document.querySelector("#success-state"),
  androidResultScope: document.querySelector("#android-result-scope"),
  errorMessage: document.querySelector("#error-message"),
  loadingTitle: document.querySelector("#loading-title"),
  loadingMessage: document.querySelector("#loading-message"),
  sourceLabel: document.querySelector("#source-label"),
  areaCount: document.querySelector("#area-count"),
  recordCount: document.querySelector("#record-count"),
  yearCount: document.querySelector("#year-count"),
  missingCount: document.querySelector("#missing-count"),
  resultNoteText: document.querySelector("#result-note-text"),
  tableTitle: document.querySelector("#table-title"),
  tableCaption: document.querySelector("#table-caption"),
  metricColumnHeading: document.querySelector("#metric-column-heading"),
  areaColumnHeading: document.querySelector("#area-column-heading"),
  typeColumnHeading: document.querySelector("#type-column-heading"),
  tableRange: document.querySelector("#table-range"),
  resultBody: document.querySelector("#result-body"),
  progressTrack: document.querySelector("#progress-track"),
  progressFill: document.querySelector("#progress-fill"),
  progressRing: document.querySelector(".progress-ring"),
  progressStatus: document.querySelector("#progress-status"),
  progressValue: document.querySelector("#progress-value"),
  toolbarProgress: document.querySelector(".preview-progress"),
  previewStatusBadge: document.querySelector("#preview-status-badge"),
  platformVersion: document.querySelector("#platform-version"),
  versionDescription: document.querySelector("#version-description"),
  versionPlatform: document.querySelector("#version-platform"),
  versionArchitecture: document.querySelector("#version-architecture"),
  versionReleaseTitle: document.querySelector("#version-release-title"),
  versionChangeList: document.querySelector("#version-change-list"),
  appMain: document.querySelector("#main-content"),
  mobileSettingsButton: document.querySelector("#mobile-settings-button"),
  settingsThemeSlot: document.querySelector("#settings-theme-slot"),
  saveLocationButton: document.querySelector("#save-location-button"),
  saveLocationLabel: document.querySelector("#save-location-label"),
  resetSaveLocation: document.querySelector("#reset-save-location"),
  views: [...document.querySelectorAll(".app-view[data-view]")],
  viewTargets: [...document.querySelectorAll("[data-view-target]")],
  placeholderButtons: [...document.querySelectorAll("[data-placeholder]")],
  themeButtons: [...document.querySelectorAll("[data-theme-option]")],
  previewTabs: [...document.querySelectorAll("[data-preview-tab]")],
  previewPanels: [...document.querySelectorAll("[data-preview-panel]")],
  querySummaryButton: document.querySelector("#query-summary-button"),
  previewOptionsButton: document.querySelector("#preview-options-button"),
  querySummarySheet: document.querySelector("#query-summary-sheet"),
  summaryScope: document.querySelector("#summary-scope"),
  summaryMeasure: document.querySelector("#summary-measure"),
  summaryYears: document.querySelector("#summary-years"),
  summaryOutput: document.querySelector("#summary-output"),
  metadataView: document.querySelector("#metadata-view"),
  toast: document.querySelector("#toast"),
};

const state = {
  status: "idle",
  areaFilter: "all",
  selectionMode: "",
  selectedAreas: [],
  resultAreas: [],
  resultGeographyLevel: "county",
  source: "",
  records: [],
  aggregated: [],
  parameters: null,
  queryContext: null,
  meta: null,
  unsupportedFips: [],
  controller: null,
  currentView: "home",
  previewTab: "table",
  theme: "light",
  saveLocation: {
    configured: false,
    label: "Ask every time",
  },
};

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

const VIEW_TITLES = Object.freeze({
  home: "Home",
  settings: "Settings",
  "data-sources": "Data Sources",
  license: "License",
  version: "Version",
  privacy: "Privacy",
});
const THEME_STORAGE_KEY = "metro-gdp-studio-theme";
const VALID_THEMES = new Set(["light", "dark"]);
const androidSelectControls = new Map();
const androidVisibilityAnimations = new WeakMap();
const androidDrawerAnimations = new WeakMap();
const androidMotionSlotAnimations = new WeakMap();

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function finishAndroidSelectMotion(control, expanded, token) {
  if (control.motionToken !== token) return;
  control.menuAnimation?.cancel();
  control.menuAnimation = null;
  control.menu.style.removeProperty("overflow");
  if (!expanded) {
    control.menu.hidden = true;
    control.wrapper.classList.remove("is-open");
  }
  control.wrapper.classList.remove("is-closing");
  control.menu.style.removeProperty("height");
  control.menu.style.removeProperty("margin-top");
  control.menu.style.removeProperty("padding-top");
  control.menu.style.removeProperty("padding-bottom");
  control.menu.style.removeProperty("border-top-width");
  control.menu.style.removeProperty("border-bottom-width");
}

function setAndroidSelectExpanded(control, expanded, immediate = false) {
  const {
    menu,
    trigger,
    wrapper,
  } = control;
  if (!expanded && menu.hidden) {
    trigger.setAttribute("aria-expanded", "false");
    wrapper.classList.remove("is-open");
    wrapper.classList.remove("is-closing");
    return;
  }

  const wasHidden = menu.hidden;
  const currentStyle = wasHidden ? null : getComputedStyle(menu);
  const currentFrame = wasHidden
    ? {
        height: 0,
        marginTop: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderTopWidth: 0,
        borderBottomWidth: 0,
      }
    : {
        height: menu.getBoundingClientRect().height,
        marginTop: Number.parseFloat(currentStyle.marginTop) || 0,
        paddingTop: Number.parseFloat(currentStyle.paddingTop) || 0,
        paddingBottom: Number.parseFloat(currentStyle.paddingBottom) || 0,
        borderTopWidth: Number.parseFloat(currentStyle.borderTopWidth) || 0,
        borderBottomWidth: Number.parseFloat(currentStyle.borderBottomWidth) || 0,
      };

  control.menuAnimation?.cancel();
  const token = Symbol("android-select-motion");
  control.motionToken = token;

  menu.hidden = false;
  wrapper.classList.toggle("is-open", expanded);
  wrapper.classList.toggle("is-closing", !expanded);
  trigger.setAttribute("aria-expanded", String(expanded));

  if (immediate || prefersReducedMotion()) {
    menu.hidden = !expanded;
    wrapper.classList.toggle("is-open", expanded);
    wrapper.classList.remove("is-closing");
    menu.style.removeProperty("overflow");
    return;
  }

  menu.style.removeProperty("overflow");
  const naturalStyle = getComputedStyle(menu);
  const expandedFrame = {
    height: menu.getBoundingClientRect().height,
    marginTop: Number.parseFloat(naturalStyle.marginTop) || 0,
    paddingTop: Number.parseFloat(naturalStyle.paddingTop) || 0,
    paddingBottom: Number.parseFloat(naturalStyle.paddingBottom) || 0,
    borderTopWidth: Number.parseFloat(naturalStyle.borderTopWidth) || 0,
    borderBottomWidth: Number.parseFloat(naturalStyle.borderBottomWidth) || 0,
  };
  control.expandedHeight = expandedFrame.height;
  menu.style.overflow = "hidden";

  const collapsedFrame = {
    height: 0,
    marginTop: 0,
    paddingTop: 0,
    paddingBottom: 0,
    borderTopWidth: 0,
    borderBottomWidth: 0,
  };
  const targetFrame = expanded ? expandedFrame : collapsedFrame;
  const toKeyframe = (frame) => ({
    height: `${frame.height}px`,
    marginTop: `${frame.marginTop}px`,
    paddingTop: `${frame.paddingTop}px`,
    paddingBottom: `${frame.paddingBottom}px`,
    borderTopWidth: `${frame.borderTopWidth}px`,
    borderBottomWidth: `${frame.borderBottomWidth}px`,
  });

  control.menuAnimation = menu.animate(
    [toKeyframe(currentFrame), toKeyframe(targetFrame)],
    {
      duration: expanded ? ANDROID_MOTION_DURATION : ANDROID_MOTION_DURATION_CLOSE,
      easing: ANDROID_MOTION_EASING,
      fill: "both",
    },
  );

  control.menuAnimation.finished
    .then(() => finishAndroidSelectMotion(control, expanded, token))
    .catch(() => {});
}

function closeAndroidSelectControls(exceptSelect = null, immediate = false) {
  androidSelectControls.forEach((control, select) => {
    if (select === exceptSelect) return;
    setAndroidSelectExpanded(control, false, immediate);
  });
}

function refreshAndroidSelectControl(select) {
  const control = androidSelectControls.get(select);
  if (!control) return;

  const { label, menu, trigger, wrapper } = control;
  const selectedOption = select.selectedOptions[0] ?? select.options[0];
  const nextLabel = selectedOption?.textContent ?? "";
  const previousLabel = label.textContent;
  const previousIndex = control.selectedIndex ?? select.selectedIndex;
  label.textContent = nextLabel;
  control.selectedIndex = select.selectedIndex;
  if (
    previousLabel
    && previousLabel !== nextLabel
    && !prefersReducedMotion()
  ) {
    const direction = Math.sign(select.selectedIndex - previousIndex) || 1;
    label.getAnimations().forEach((animation) => animation.cancel());
    label.animate(
      [
        { opacity: 0.28, transform: `translateX(${direction * 18}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      {
        duration: ANDROID_MOTION_DURATION,
        easing: ANDROID_MOTION_EASING,
      },
    );
  }
  const isReadOnly = wrapper.classList.contains("is-readonly");
  trigger.disabled = select.disabled || isReadOnly;
  trigger.setAttribute("aria-disabled", String(trigger.disabled));
  menu.replaceChildren();

  [...select.options].forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "android-select-option";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(option.value === select.value));
    item.disabled = option.disabled;

    const copy = document.createElement("span");
    copy.textContent = option.textContent;
    const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    check.setAttribute("viewBox", "0 0 24 24");
    check.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m5 12 4 4L19 6");
    check.append(path);
    item.append(copy, check);

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      if (option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      refreshAndroidSelectControl(select);
      closeAndroidSelectControls();
      trigger.focus();
    });
    menu.append(item);
  });
}

function refreshAndroidSelectControls() {
  androidSelectControls.forEach((_, select) => refreshAndroidSelectControl(select));
}

function openAndroidSelectControl(select) {
  const control = androidSelectControls.get(select);
  if (!control || control.trigger.disabled) return;
  closeAndroidSelectControls(select);
  refreshAndroidSelectControl(select);
  setAndroidSelectExpanded(control, true);
  requestAnimationFrame(() => {
    const rect = control.menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 16 || rect.top < 16) {
      control.menu.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

function initializeAndroidSelectControls() {
  if (!IS_ANDROID) return;

  document.querySelectorAll(".pop-up-button > select").forEach((select, index) => {
    const wrapper = select.closest(".pop-up-button");
    if (!wrapper || androidSelectControls.has(select)) return;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "android-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", select.closest(".field")?.querySelector(".field-label")?.textContent ?? "Choose option");

    const label = document.createElement("span");
    trigger.append(label);

    const menu = document.createElement("div");
    menu.id = `${select.id || `android-select-${index}`}-menu`;
    menu.className = "android-select-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    trigger.setAttribute("aria-controls", menu.id);

    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    wrapper.classList.add("has-android-select");
    wrapper.insertBefore(trigger, select.nextSibling);
    wrapper.append(menu);

    androidSelectControls.set(select, {
      label,
      menu,
      trigger,
      wrapper,
      selectedIndex: select.selectedIndex,
      motionToken: null,
      menuAnimation: null,
      expandedHeight: 0,
    });

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      if (trigger.getAttribute("aria-expanded") !== "true") openAndroidSelectControl(select);
      else closeAndroidSelectControls();
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAndroidSelectControls();
        return;
      }
      if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      openAndroidSelectControl(select);
      requestAnimationFrame(() => {
        const options = [...menu.querySelectorAll(".android-select-option:not(:disabled)")];
        const selectedIndex = options.findIndex((option) => option.getAttribute("aria-selected") === "true");
        const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
        options[targetIndex]?.focus();
      });
    });
    select.addEventListener("change", () => refreshAndroidSelectControl(select));
    new MutationObserver(() => refreshAndroidSelectControl(select)).observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    refreshAndroidSelectControl(select);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".pop-up-button")) closeAndroidSelectControls();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAndroidSelectControls();
  });
}

function setAnimatedVisibility(element, visible, animate = true) {
  if (!element) return;
  const running = androidVisibilityAnimations.get(element);
  const currentHeight = element.hidden ? 0 : element.getBoundingClientRect().height;
  const currentStyle = element.hidden ? null : getComputedStyle(element);
  const currentOpacity = currentStyle ? Number(currentStyle.opacity) : 0;
  const currentTransform = currentStyle?.transform && currentStyle.transform !== "none"
    ? currentStyle.transform
    : visible ? "translateY(-14px)" : "none";
  running?.cancel();
  androidVisibilityAnimations.delete(element);

  if (!IS_ANDROID || !animate || prefersReducedMotion()) {
    element.hidden = !visible;
    element.style.removeProperty("overflow");
    element.style.removeProperty("transform-origin");
    return;
  }
  if (visible) element.hidden = false;
  else if (element.hidden) return;

  const targetHeight = visible ? element.getBoundingClientRect().height : 0;
  const parentStyle = element.parentElement ? getComputedStyle(element.parentElement) : null;
  const parentGap = Number.parseFloat(parentStyle?.rowGap || parentStyle?.gap || "0") || 0;
  element.style.overflow = "clip";
  element.style.transformOrigin = "50% 0%";
  const animation = element.animate(
    visible
      ? [
          {
            height: `${currentHeight}px`,
            opacity: currentOpacity,
            transform: currentTransform,
            clipPath: "inset(0 0 100% 0 round 24px)",
            marginBottom: `${-parentGap}px`,
          },
          {
            height: `${targetHeight}px`,
            opacity: 1,
            transform: "translateY(0)",
            clipPath: "inset(0 0 0% 0 round 24px)",
            marginBottom: "0px",
          },
        ]
      : [
          {
            height: `${currentHeight}px`,
            opacity: currentOpacity,
            transform: currentTransform,
            clipPath: "inset(0 0 0% 0 round 24px)",
            marginBottom: "0px",
          },
          {
            height: "0px",
            opacity: 0,
            transform: "translateY(-14px)",
            clipPath: "inset(0 0 100% 0 round 24px)",
            marginBottom: `${-parentGap}px`,
          },
        ],
    {
      duration: visible ? ANDROID_MOTION_DURATION : ANDROID_MOTION_DURATION_CLOSE,
      easing: ANDROID_MOTION_EASING,
      fill: "both",
    },
  );
  androidVisibilityAnimations.set(element, animation);
  animation.finished.then(() => {
    if (androidVisibilityAnimations.get(element) !== animation) return;
    if (!visible) element.hidden = true;
    animation.cancel();
    androidVisibilityAnimations.delete(element);
    element.style.removeProperty("overflow");
    element.style.removeProperty("transform-origin");
  }).catch(() => {});
}

function finishAndroidDrawerMotion(element, visible, animation) {
  const running = androidDrawerAnimations.get(element);
  if (running?.animation !== animation) return;
  animation.cancel();
  androidDrawerAnimations.delete(element);
  if (!visible) element.hidden = true;
  element.style.removeProperty("overflow");
  element.style.removeProperty("height");
  element.style.removeProperty("min-height");
  element.style.removeProperty("padding-top");
  element.style.removeProperty("padding-bottom");
  element.style.removeProperty("border-top-width");
  element.style.removeProperty("border-bottom-width");
}

function setAndroidDrawerVisibility(element, visible, animate = true) {
  if (!element) return;
  const running = androidDrawerAnimations.get(element);
  if (running?.visible === visible && animate) return;

  const wasHidden = element.hidden;
  const currentStyle = wasHidden ? null : getComputedStyle(element);
  const currentFrame = wasHidden
    ? {
        height: 0,
        minHeight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderTopWidth: 0,
        borderBottomWidth: 0,
      }
    : {
        height: element.getBoundingClientRect().height,
        minHeight: Number.parseFloat(currentStyle.minHeight) || 0,
        paddingTop: Number.parseFloat(currentStyle.paddingTop) || 0,
        paddingBottom: Number.parseFloat(currentStyle.paddingBottom) || 0,
        borderTopWidth: Number.parseFloat(currentStyle.borderTopWidth) || 0,
        borderBottomWidth: Number.parseFloat(currentStyle.borderBottomWidth) || 0,
      };

  running?.animation.cancel();
  androidDrawerAnimations.delete(element);

  if (!IS_ANDROID || !animate || prefersReducedMotion()) {
    element.hidden = !visible;
    element.style.removeProperty("overflow");
    return;
  }
  if (!visible && wasHidden) return;

  element.hidden = false;
  element.style.removeProperty("overflow");
  const naturalStyle = getComputedStyle(element);
  const expandedFrame = {
    height: element.getBoundingClientRect().height,
    minHeight: Number.parseFloat(naturalStyle.minHeight) || 0,
    paddingTop: Number.parseFloat(naturalStyle.paddingTop) || 0,
    paddingBottom: Number.parseFloat(naturalStyle.paddingBottom) || 0,
    borderTopWidth: Number.parseFloat(naturalStyle.borderTopWidth) || 0,
    borderBottomWidth: Number.parseFloat(naturalStyle.borderBottomWidth) || 0,
  };
  const collapsedFrame = {
    height: 0,
    minHeight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    borderTopWidth: 0,
    borderBottomWidth: 0,
  };
  const targetFrame = visible ? expandedFrame : collapsedFrame;
  const toKeyframe = (frame) => ({
    height: `${frame.height}px`,
    minHeight: `${frame.minHeight}px`,
    paddingTop: `${frame.paddingTop}px`,
    paddingBottom: `${frame.paddingBottom}px`,
    borderTopWidth: `${frame.borderTopWidth}px`,
    borderBottomWidth: `${frame.borderBottomWidth}px`,
  });

  element.style.overflow = "hidden";
  const animation = element.animate(
    [toKeyframe(currentFrame), toKeyframe(targetFrame)],
    {
      duration: visible ? ANDROID_MOTION_DURATION : ANDROID_MOTION_DURATION_CLOSE,
      easing: ANDROID_MOTION_EASING,
      fill: "both",
    },
  );
  androidDrawerAnimations.set(element, { animation, visible });
  animation.finished
    .then(() => finishAndroidDrawerMotion(element, visible, animation))
    .catch(() => {});
}

function clearMotionSlotStyles(slot) {
  slot.style.removeProperty("height");
  slot.style.removeProperty("margin-top");
  slot.style.removeProperty("overflow");
  slot.style.removeProperty("will-change");
}

function resetMotionSlot(slot, open) {
  if (!slot) return;
  androidMotionSlotAnimations.get(slot)?.cancel();
  androidMotionSlotAnimations.delete(slot);
  slot.dataset.open = String(open);
  clearMotionSlotStyles(slot);
}

function transitionMotionSlot(
  slot,
  open,
  mutate,
  animate = true,
  finalize = () => {},
) {
  if (!slot) {
    mutate();
    finalize();
    return;
  }

  const running = androidMotionSlotAnimations.get(slot);
  const startHeight = slot.getBoundingClientRect().height;
  const startMargin = Number.parseFloat(getComputedStyle(slot).marginTop) || 0;
  running?.cancel();
  androidMotionSlotAnimations.delete(slot);
  clearMotionSlotStyles(slot);

  slot.dataset.open = String(open);
  mutate();

  const targetHeight = open ? slot.getBoundingClientRect().height : 0;
  const targetMargin = open
    ? Number.parseFloat(getComputedStyle(slot).marginTop) || 0
    : 0;
  const duration = targetHeight >= startHeight
    ? ANDROID_MOTION_DURATION
    : ANDROID_MOTION_DURATION_CLOSE;

  if (
    !IS_ANDROID
    || !animate
    || prefersReducedMotion()
    || (
      Math.abs(targetHeight - startHeight) < 0.5
      && Math.abs(targetMargin - startMargin) < 0.5
    )
  ) {
    finalize();
    clearMotionSlotStyles(slot);
    return;
  }

  slot.style.overflow = "hidden";
  slot.style.willChange = "height, margin-top";
  const animation = slot.animate(
    [
      {
        height: `${startHeight}px`,
        marginTop: `${startMargin}px`,
      },
      {
        height: `${targetHeight}px`,
        marginTop: `${targetMargin}px`,
      },
    ],
    {
      duration,
      easing: ANDROID_MOTION_EASING,
      fill: "both",
    },
  );
  androidMotionSlotAnimations.set(slot, animation);
  animation.finished
    .then(() => {
      if (androidMotionSlotAnimations.get(slot) !== animation) return;
      finalize();
      animation.cancel();
      androidMotionSlotAnimations.delete(slot);
      clearMotionSlotStyles(slot);
    })
    .catch(() => {});
}

function animateDirectionalContent(element, direction) {
  if (!IS_ANDROID || !element || !direction || prefersReducedMotion()) return;
  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate(
    [
      { opacity: 0.32, transform: `translateX(${direction * 20}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ],
    {
      duration: ANDROID_MOTION_DURATION,
      easing: ANDROID_MOTION_EASING,
    },
  );
}

function updateThemeColor() {
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue("--window-background")
    .trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
}

function renderSaveLocation() {
  const label = state.saveLocation.configured
    ? state.saveLocation.label
    : "Ask every time";
  elements.saveLocationLabel.textContent = label;
  elements.resetSaveLocation.hidden = !state.saveLocation.configured;
}

async function initializeSaveLocation() {
  if (!IS_ANDROID) return;
  try {
    const result = await SaveLocation.getLocation();
    state.saveLocation = {
      configured: Boolean(result.configured),
      label: result.label || "Selected folder",
    };
  } catch {
    state.saveLocation = { configured: false, label: "Ask every time" };
  }
  renderSaveLocation();
}

async function chooseSaveLocation() {
  if (!IS_ANDROID) return;
  elements.saveLocationButton.disabled = true;
  try {
    const result = await SaveLocation.chooseDirectory();
    if (!result.canceled && result.configured) {
      state.saveLocation = {
        configured: true,
        label: result.label || "Selected folder",
      };
      renderSaveLocation();
      showToast(`Excel files will be saved to ${state.saveLocation.label}.`);
    }
  } catch (error) {
    showToast(error.message || "Unable to select that folder.");
  } finally {
    elements.saveLocationButton.disabled = false;
  }
}

async function resetSaveLocation() {
  if (!IS_ANDROID) return;
  try {
    await SaveLocation.clearLocation();
    state.saveLocation = { configured: false, label: "Ask every time" };
    renderSaveLocation();
    showToast("Excel files will use the save or share sheet.");
  } catch (error) {
    showToast(error.message || "Unable to reset the save location.");
  }
}

function applyTheme(theme, persist = false) {
  const nextTheme = VALID_THEMES.has(theme) ? theme : "light";
  state.theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  elements.themeButtons.forEach((button) => {
    const isSelected = button.dataset.themeOption === nextTheme;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Theme persistence is optional; the application still works without storage access.
    }
  }

  window.desktopAPI?.setTheme?.(nextTheme).catch?.(() => {});
  if (IS_ANDROID) {
    SystemBars.setStyle({
      style: nextTheme === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
  }
  requestAnimationFrame(updateThemeColor);
}

function initializeTheme() {
  let savedTheme = "light";
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    savedTheme = storedTheme
      || (IS_ANDROID && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch {
    savedTheme = "light";
  }
  applyTheme(savedTheme, !VALID_THEMES.has(savedTheme));
}

function updateQuerySummary() {
  const isState = elements.geographyLevel.value === "state";
  const isCountry = elements.geographyLevel.value === "country";
  const selection = isCountry
    ? "United States"
    : state.selectedAreas.length === 0
    ? isState ? "No state selected" : "No metro area selected"
    : state.selectedAreas.length === 1
      ? state.selectedAreas[0].name
      : `${state.selectedAreas.length} ${isState ? "states" : "metro areas"}`;
  elements.summaryScope.textContent = selection;
  elements.summaryMeasure.textContent = getMetricLabel();
  elements.summaryYears.textContent = elements.year.selectedOptions[0]?.textContent || elements.year.value;
  elements.summaryOutput.textContent = `${sanitizeFilename(elements.filename.value)}.xlsx`;
}

function openQuerySummary() {
  updateQuerySummary();
  if (typeof elements.querySummarySheet.showModal === "function") {
    elements.querySummarySheet.showModal();
  }
}

function setPreviewTab(tabName, shouldFocus = false) {
  const nextTab = ["table", "metadata"].includes(tabName) ? tabName : "table";
  state.previewTab = nextTab;
  elements.previewTabs.forEach((tab) => {
    const isSelected = tab.dataset.previewTab === nextTab;
    tab.classList.toggle("is-selected", isSelected);
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
    if (isSelected && shouldFocus) tab.focus();
  });
  elements.previewPanels.forEach((panel) => {
    const isSelected = panel.dataset.previewPanel === nextTab;
    panel.hidden = !isSelected;
    panel.classList.toggle("is-active", isSelected);
    if (isSelected && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      panel.classList.add("is-entering");
      requestAnimationFrame(() => panel.classList.remove("is-entering"));
    }
  });
}

function renderMetadata() {
  const parameters = state.parameters ?? {};
  const isStateResult = state.resultGeographyLevel === "state";
  const isCountryResult = state.resultGeographyLevel === "country";
  const rows = isCountryResult
    ? [
        ["Source", state.source || "—"],
        ["Geographic scope", "United States"],
        ["Dataset", parameters.DATASETNAME || "NIPA"],
        ["Table", `${parameters.TABLENAME || "—"} · GDP`],
        ["Measure", getMetricLabel("", parameters.TABLENAME)],
        ["Frequency", parameters.FREQUENCY === "Q" ? "Quarterly" : "Annual"],
        ["Calculation", state.queryContext?.cumulativeQuarterly ? "Quarterly cumulative" : "As reported"],
        ["Year", parameters.YEAR || "ALL"],
        ["Unit", getUnitLabel(state.meta?.unit, parameters.TABLENAME)],
        ["Raw records", numberFormatter.format(state.records.length)],
        ["Statistic", state.meta?.statistic || "Gross domestic product"],
      ]
    : isStateResult
    ? [
        ["Source", state.source || "—"],
        ["Geographic scope", state.resultAreas.length === 1
          ? state.resultAreas[0].name
          : `${state.resultAreas.length} states`],
        ["State records", numberFormatter.format(state.resultAreas.length)],
        ["Dataset", parameters.DATASETNAME || "REGIONAL"],
        ["Table", `${parameters.TABLENAME || "—"} · ${getTableLabel(parameters.TABLENAME)}`],
        ["Measure", `${parameters.LINECODE || "—"} · ${getMetricLabel(parameters.LINECODE, parameters.TABLENAME)}`],
        ["GeoFIPS", parameters.GEOFIPS || "STATE"],
        ["Year", parameters.YEAR || "ALL"],
        ["Unit", getUnitLabel(state.meta?.unit, parameters.TABLENAME)],
        ["Raw records", numberFormatter.format(state.records.length)],
        ["Statistic", state.meta?.statistic || "—"],
      ]
    : [
        ["Source", state.source || "—"],
        ["Geographic scope", state.resultAreas.length === 1
          ? state.resultAreas[0].name
          : `${state.resultAreas.length} MSAs / CSAs`],
        ["County GeoFips", numberFormatter.format(collectAreaFips(state.resultAreas).length)],
        ["Dataset", parameters.DATASETNAME || "REGIONAL"],
        ["Table", `${parameters.TABLENAME || "—"} · ${getTableLabel(parameters.TABLENAME)}`],
        ["Measure", `${parameters.LINECODE || "—"} · ${getMetricLabel(parameters.LINECODE, parameters.TABLENAME)}`],
        ["Year", parameters.YEAR || "ALL"],
        ["Unit", getUnitLabel(state.meta?.unit, parameters.TABLENAME)],
        ["Raw records", numberFormatter.format(state.records.length)],
        ["Statistic", state.meta?.statistic || "—"],
        ["Boundary definition", metroDataset.source || "Latest OMB Bulletin"],
      ];

  elements.metadataView.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = String(value);
    row.append(term, description);
    return row;
  }));
}

function navigateToView(viewName, shouldFocus = true, shouldAnimate = true) {
  const nextView = elements.views.find((view) => view.dataset.view === viewName);
  if (!nextView || state.currentView === viewName) return;

  elements.views.forEach((view) => {
    const isNext = view === nextView;
    view.hidden = !isNext;
    view.classList.toggle("is-active", isNext);
  });
  elements.viewTargets.forEach((button) => {
    const isCurrent = button.dataset.viewTarget === viewName;
    button.classList.toggle("is-active", isCurrent);
    if (button.classList.contains("nav-item")) {
      if (isCurrent) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });

  state.currentView = viewName;
  document.title = `${VIEW_TITLES[viewName] ?? "Metro Studio"} · Metro Studio`;
  if (IS_ANDROID) {
    elements.appMain.scrollTo({ top: 0, behavior: "auto" });
    const isHome = viewName === "home";
    elements.mobileSettingsButton.classList.toggle("is-back", !isHome);
    elements.mobileSettingsButton.setAttribute(
      "aria-label",
      isHome ? "Open settings" : viewName === "settings" ? "Back to query" : "Back to settings",
    );
    elements.mobileSettingsButton.title = isHome
      ? "Settings"
      : viewName === "settings" ? "Back to query" : "Back to settings";
  } else {
    nextView.scrollTo?.({ top: 0, behavior: "auto" });
  }

  if (shouldAnimate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    nextView.getAnimations().forEach((animation) => animation.cancel());
    nextView.animate(
      [
        { opacity: 0, transform: "scale(0.992)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      {
        duration: 180,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    );
  }

  if (shouldFocus) {
    requestAnimationFrame(() => {
      nextView.querySelector("h1")?.setAttribute("tabindex", "-1");
      nextView.querySelector("h1")?.focus({ preventScroll: true });
    });
  }
}

function getAreaLabel(type) {
  return AREA_LABELS[type] ?? "Metro area";
}

function getTableConfig(tableName = elements.tableName.value) {
  const normalized = String(tableName).toUpperCase();
  if (/^T(?:101|801)0[56]$/u.test(normalized)) return TABLE_CONFIG.NIPA_GDP;
  return TABLE_CONFIG[normalized] ?? TABLE_CONFIG.CAGDP1;
}

function getTableLabel(tableName = elements.tableName.value) {
  return getTableConfig(tableName).label;
}

function getMetricLabel(
  lineCode = elements.lineCode.value,
  tableName = elements.tableName.value,
) {
  const normalizedTable = String(tableName).toUpperCase();
  if (["T10105", "T80105"].includes(normalizedTable)) return "Current-dollar GDP";
  if (["T10106", "T80106"].includes(normalizedTable)) return "Real GDP";
  const config = getTableConfig(tableName);
  return config.lineCodes.find((item) => item.value === String(lineCode))?.label ?? config.label;
}

function getUnitLabel(unit, tableName = elements.tableName.value) {
  if (["CAINC1", "SAINC1"].includes(String(tableName).toUpperCase())) return "persons";
  if (/^T(?:101|801)0[56]$/u.test(String(tableName).toUpperCase())) {
    return unit || "millions of dollars";
  }
  return unit === "Thousands of dollars" ? "thousands of dollars" : unit || "thousands of dollars";
}

function getCountryTableSelection() {
  const frequency = elements.frequency.value === "Q" ? "Q" : "A";
  const measure = elements.lineCode.value === "real" ? "real" : "current";
  return {
    frequency,
    measure,
    ...COUNTRY_TABLES[frequency][measure],
  };
}

function getActiveYearRange() {
  if (elements.geographyLevel.value === "country") return getCountryTableSelection();
  const config = getTableConfig();
  return { firstYear: config.firstYear, lastYear: config.lastYear };
}

function syncCountryMeasureControls(animate = false, quarterlyOnly = false) {
  const isCountry = elements.geographyLevel.value === "country";
  const showQuarterly = isCountry && elements.frequency.value === "Q";

  if (quarterlyOnly && isCountry) {
    if (showQuarterly) {
      transitionMotionSlot(
        elements.quarterlyMotionSlot,
        true,
        () => {
          elements.quarterlyModeField.hidden = false;
        },
        animate,
      );
    } else {
      transitionMotionSlot(
        elements.quarterlyMotionSlot,
        false,
        () => {},
        animate,
        () => {
          elements.quarterlyModeField.hidden = true;
        },
      );
    }
    return;
  }

  if (isCountry) {
    transitionMotionSlot(
      elements.countryMeasureSlot,
      true,
      () => {
        elements.frequencyField.hidden = false;
        elements.quarterlyModeField.hidden = !showQuarterly;
        resetMotionSlot(elements.quarterlyMotionSlot, showQuarterly);
      },
      animate,
    );
    return;
  }

  transitionMotionSlot(
    elements.countryMeasureSlot,
    false,
    () => {},
    animate,
    () => {
      elements.frequencyField.hidden = true;
      elements.quarterlyModeField.hidden = true;
      resetMotionSlot(elements.quarterlyMotionSlot, false);
    },
  );
}

function syncTableControls(preferredLineCode = "", updateFilename = false) {
  const config = getTableConfig();
  const preferredYear = elements.year.value || "ALL";
  const options = config.lineCodes.map(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  });
  elements.lineCode.replaceChildren(...options);
  elements.lineCode.value = config.lineCodes.some((item) => item.value === String(preferredLineCode))
    ? String(preferredLineCode)
    : config.defaultLineCode;

  const { firstYear, lastYear } = getActiveYearRange();
  const yearOptions = [
    ["ALL", `All years (${firstYear}–${lastYear})`],
    ["LAST5", "Latest 5 years"],
    ["LAST10", "Latest 10 years"],
  ];
  for (let year = lastYear; year >= firstYear; year -= 1) {
    yearOptions.push([String(year), String(year)]);
  }
  elements.year.replaceChildren(...yearOptions.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  elements.year.value = yearOptions.some(([value]) => value === preferredYear)
    ? preferredYear
    : "ALL";

  if (updateFilename) {
    const defaultFilenames = new Set(Object.values(TABLE_CONFIG).map((item) => item.filename));
    if (defaultFilenames.has(elements.filename.value.trim())) {
      elements.filename.value = config.filename;
      updateFilenameLabels();
    }
  }
  refreshAndroidSelectControls();
}

function syncGeographyLevelControls(
  updateFilename = false,
  clearSelection = false,
  animate = false,
) {
  const level = ["county", "state", "country"].includes(elements.geographyLevel.value)
    ? elements.geographyLevel.value
    : "county";
  const isState = level === "state";
  const isCountry = level === "country";
  const currentTable = String(elements.tableName.value).toUpperCase();
  const currentKind = currentTable.endsWith("INC1") ? "population" : "gdp";
  const currentLineCode = elements.lineCode.value;
  const allowedTables = GEOGRAPHY_TABLES[level];

  elements.scopeCountBadge.textContent = isCountry
    ? "1 country"
    : isState ? `${stateDataset.areas.length} states` : `${metroDataset.areas.length} areas`;
  document.body.dataset.geographyLevel = level;

  transitionMotionSlot(
    elements.scopeMotionSlot,
    true,
    () => {
      elements.countyScopeControls.forEach((control) => {
        setAnimatedVisibility(control, level === "county", false);
      });
      elements.selectableScopeControls.forEach((control) => {
        setAnimatedVisibility(control, !isCountry, false);
      });
      setAnimatedVisibility(elements.countryScopeSummary, isCountry, false);
      elements.geographySearchLabel.textContent = isState ? "Search states" : "Search metro areas";
      elements.metroSearch.placeholder = isState
        ? "e.g. New York or 36"
        : "e.g. New York or 35620";

      if (clearSelection) {
        setSelectedAreas(
          isCountry ? [COUNTRY_AREA] : [],
          isCountry ? "fixed" : "",
          0,
          false,
        );
        elements.metroSearch.value = "";
        setAnimatedVisibility(elements.metroResults, false, false);
        elements.clearSearch.hidden = true;
      } else if (isCountry) {
        setSelectedAreas([COUNTRY_AREA], "fixed", 0, false);
      }
      renderAllAreaButton();
      renderSearchResults();
    },
    animate,
  );

  elements.tableName.replaceChildren(...allowedTables.map((tableName) => {
    const option = document.createElement("option");
    option.value = tableName;
    option.textContent = getTableConfig(tableName).label;
    return option;
  }));
  elements.tableName.value = isCountry
    ? allowedTables[0]
    : allowedTables.find((tableName) => (
        currentKind === "population"
          ? tableName.endsWith("INC1")
          : tableName.endsWith("GDP1")
      )) ?? allowedTables[0];

  elements.year.value = "ALL";
  elements.year.disabled = false;
  syncTableControls(currentLineCode, updateFilename);
  syncCountryMeasureControls(animate);
  elements.areaError.textContent = "";
  resetResultForSelectionChange();
  updateQuerySummary();
  refreshAndroidSelectControls();
}

function getFilteredAreas() {
  if (elements.geographyLevel.value === "country") return [COUNTRY_AREA];
  if (elements.geographyLevel.value === "state") return stateDataset.areas;
  return state.areaFilter === "all"
    ? metroDataset.areas
    : metroDataset.areas.filter((area) => area.type === state.areaFilter);
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .trim();
}

function readForm(geoFips = "") {
  if (elements.geographyLevel.value === "country") {
    const table = getCountryTableSelection();
    return {
      datasetName: "NIPA",
      tableName: table.tableName,
      frequency: table.frequency,
      year: elements.year.value,
      firstYear: table.firstYear,
      lastYear: table.lastYear,
    };
  }
  return {
    datasetName: "REGIONAL",
    geoFips,
    lineCode: elements.lineCode.value,
    tableName: elements.tableName.value,
    year: elements.year.value,
  };
}

function updateFilenameLabels() {
  const filename = sanitizeFilename(elements.filename.value);
  if (elements.summaryOutput) elements.summaryOutput.textContent = `${filename}.xlsx`;
}

function setProgress(value) {
  const progress = Math.min(100, Math.max(0, Number(value) || 0));
  elements.progressFill.style.transform = `scaleX(${progress / 100})`;
  elements.progressTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
  elements.progressValue.textContent = `${Math.round(progress)}%`;
  elements.progressRing?.style.setProperty("--progress", String(progress));
}

function setState(nextState, message = "") {
  state.status = nextState;
  const isLoading = nextState === "loading";
  elements.emptyState.hidden = nextState !== "idle";
  elements.loadingState.hidden = !isLoading;
  elements.errorState.hidden = nextState !== "error";
  elements.successState.hidden = nextState !== "success";
  elements.exportButton.disabled = nextState !== "success";
  elements.fetchButton.disabled = isLoading;
  elements.geographyLevel.disabled = isLoading;
  elements.tableName.disabled = isLoading;
  elements.lineCode.disabled = isLoading;
  elements.year.disabled = isLoading;
  elements.frequency.disabled = isLoading;
  elements.quarterlyMode.disabled = isLoading;
  elements.metroSearch.disabled = isLoading;
  elements.selectAllAreas.disabled = isLoading;
  elements.areaFilterButtons.forEach((button) => {
    button.disabled = isLoading;
  });

  const buttonText = elements.fetchButton.querySelector(":scope > span:last-child");
  buttonText.textContent = isLoading ? "Running…" : "Run Query";
  elements.fetchButton.classList.toggle("is-loading", isLoading);
  if (message) elements.errorMessage.textContent = message;

  const statusLabels = {
    idle: "Ready",
    loading: "Processing",
    success: "Complete",
    error: "Needs attention",
  };
  elements.progressStatus.textContent = statusLabels[nextState] ?? "Ready";
  document.body.dataset.status = nextState;
  elements.toolbarProgress.classList.toggle("is-error", nextState === "error");
  elements.toolbarProgress.classList.toggle("is-complete", nextState === "success");
  elements.previewStatusBadge.className = "status-badge";
  elements.previewStatusBadge.classList.add(
    nextState === "success"
      ? "success"
      : nextState === "error"
        ? "danger"
        : nextState === "loading" ? "accent" : "neutral",
  );
  elements.previewStatusBadge.textContent = statusLabels[nextState] ?? "Ready";

  if (nextState === "idle" || nextState === "error") setProgress(0);
  if (isLoading) setProgress(18);
  if (nextState === "success") setProgress(100);
}

function renderAllAreaButton(direction = 0) {
  const areas = getFilteredAreas();
  const isState = elements.geographyLevel.value === "state";
  const labels = {
    all: "Select all metro areas",
    msa: "Select all metropolitan statistical areas",
    csa: "Select all combined statistical areas",
  };
  elements.selectAllLabel.textContent = isState ? "Select all states" : labels[state.areaFilter];
  elements.selectAllCount.textContent = `${areas.length} ${isState ? "states" : "areas"}`;
  animateDirectionalContent(
    elements.selectAllAreas.querySelector(":scope > span:nth-child(2)"),
    direction,
  );
}

function animateSelectedAreaReveal(direction = 0) {
  const content = elements.selectedArea.querySelector(":scope > div");
  if (!content) return;
  content.getAnimations().forEach((animation) => animation.cancel());
  const reducedMotion = prefersReducedMotion();
  content.animate(
    reducedMotion
      ? [
          { opacity: 0 },
          { opacity: 1 },
        ]
      : [
          {
            opacity: 0,
            transform: direction
              ? `translateX(${direction * 20}px) scaleY(0.94)`
              : "translateY(-16px) scaleY(0.82)",
          },
          { opacity: 1, transform: "translateX(0) translateY(2px) scaleY(1.015)", offset: 0.74 },
          { opacity: 1, transform: "translateX(0) translateY(0) scaleY(1)" },
        ],
    {
      duration: reducedMotion ? 120 : ANDROID_MOTION_DURATION,
      easing: ANDROID_MOTION_EASING,
    },
  );
}

function renderSelectedArea(shouldAnimate = false, direction = 0) {
  if (state.selectedAreas.length === 0) {
    elements.selectedArea
      .querySelector(":scope > div")
      ?.getAnimations()
      .forEach((animation) => animation.cancel());
    setAndroidDrawerVisibility(elements.selectedArea, false, shouldAnimate);
    return;
  }

  const wasHidden = elements.selectedArea.hidden;
  if (wasHidden || androidDrawerAnimations.has(elements.selectedArea)) {
    setAndroidDrawerVisibility(elements.selectedArea, true, shouldAnimate);
  } else {
    elements.selectedArea.hidden = false;
  }
  const uniqueFips = collectAreaFips(state.selectedAreas);
  if (state.selectionMode === "all") {
    if (elements.geographyLevel.value === "state") {
      elements.selectedAreaType.textContent = "State Level";
      elements.selectedAreaType.classList.remove("is-csa");
      elements.selectedAreaName.textContent = "All states";
      elements.selectedAreaDetail.textContent = `${state.selectedAreas.length} states · direct BEA records`;
      if (shouldAnimate && !wasHidden) animateSelectedAreaReveal(direction);
      return;
    }
    const titles = {
      all: ["MSA + CSA", "All metro areas"],
      msa: ["Metropolitan Statistical Area", "All metropolitan statistical areas"],
      csa: ["Combined Statistical Area", "All combined statistical areas"],
    };
    const [type, name] = titles[state.areaFilter];
    elements.selectedAreaType.textContent = type;
    elements.selectedAreaType.classList.toggle("is-csa", state.areaFilter === "csa");
    elements.selectedAreaName.textContent = name;
    elements.selectedAreaDetail.textContent = `${state.selectedAreas.length} metro areas · ${uniqueFips.length} unique county GeoFips`;
    if (shouldAnimate && !wasHidden) animateSelectedAreaReveal(direction);
    return;
  }

  const area = state.selectedAreas[0];
  elements.selectedAreaType.textContent = getAreaLabel(area.type);
  elements.selectedAreaType.classList.toggle("is-csa", area.type === "csa");
  elements.selectedAreaName.textContent = area.name;
  elements.selectedAreaDetail.textContent = area.type === "state"
    ? `State FIPS ${area.code} · direct BEA records`
    : `${area.type.toUpperCase()} ${area.code} · ${uniqueFips.length} county GeoFips`;
  if (shouldAnimate && !wasHidden) animateSelectedAreaReveal(direction);
}

function resetResultForSelectionChange() {
  if (state.status === "success" || state.status === "error") {
    state.records = [];
    state.aggregated = [];
    state.resultAreas = [];
    state.resultGeographyLevel = elements.geographyLevel.value;
    state.queryContext = null;
    setState("idle");
  }
}

function setSelectedAreas(areas, mode, direction = 0, animate = true) {
  const previous = state.selectedAreas.map((area) => area.id).join("|");
  const previousMode = state.selectionMode;
  const next = areas.map((area) => area.id).join("|");
  state.selectedAreas = areas;
  state.selectionMode = mode;
  elements.areaError.textContent = "";
  renderSelectedArea(
    animate && (previous !== next || previousMode !== mode),
    direction,
  );
  updateQuerySummary();
  if (previous !== next) resetResultForSelectionChange();
}

function createAreaOption(area) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "metro-option";
  button.setAttribute("role", "option");
  if (state.selectionMode === "single" && state.selectedAreas[0]?.id === area.id) {
    button.classList.add("is-selected");
    button.setAttribute("aria-selected", "true");
  }

  const main = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = area.name;
  const detail = document.createElement("small");
  detail.textContent = area.type === "state"
    ? `State FIPS ${area.code}`
    : `${area.type.toUpperCase()} ${area.code} · ${area.fips.length} county geographies`;
  main.append(name, detail);

  const type = document.createElement("span");
  type.className = `area-type-badge${area.type === "csa" ? " is-csa" : ""}`;
  type.textContent = getAreaLabel(area.type);
  button.append(main, type);

  button.addEventListener("click", () => {
    setSelectedAreas([area], "single");
    elements.metroSearch.value = area.name;
    elements.clearSearch.hidden = false;
    setAnimatedVisibility(elements.metroResults, false, true);
  });
  return button;
}

function renderSearchResults() {
  const query = normalizeSearchText(elements.metroSearch.value);
  elements.clearSearch.hidden = query.length === 0;

  if (!query) {
    setAnimatedVisibility(elements.metroResults, false, true);
    return;
  }

  elements.metroResults.replaceChildren();
  const matches = getFilteredAreas().filter((area) => {
    const searchable = normalizeSearchText(`${area.name} ${area.code}`);
    return searchable.includes(query);
  });

  const summary = document.createElement("div");
  summary.className = "metro-result-summary";
  summary.textContent = matches.length > SEARCH_RESULT_LIMIT
    ? `${matches.length} results found; showing the first ${SEARCH_RESULT_LIMIT}`
    : `${matches.length} results found`;
  elements.metroResults.append(summary);

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "metro-result-summary";
    empty.textContent = elements.geographyLevel.value === "state"
      ? "No matching states. Try another English name or state FIPS code."
      : "No matching metro areas. Try another English name or code.";
    elements.metroResults.append(empty);
  } else {
    matches.slice(0, SEARCH_RESULT_LIMIT).forEach((area) => {
      elements.metroResults.append(createAreaOption(area));
    });
  }

  const wasHidden = elements.metroResults.hidden;
  setAnimatedVisibility(elements.metroResults, true, wasHidden);
}

function updateAreaFilter(type) {
  const areaTypes = ["all", "msa", "csa"];
  const previousIndex = Math.max(0, areaTypes.indexOf(state.areaFilter));
  const nextIndex = Math.max(0, areaTypes.indexOf(type));
  const direction = Math.sign(nextIndex - previousIndex);
  state.areaFilter = type;
  elements.areaFilterControl.dataset.selectedIndex = String(nextIndex);
  elements.areaFilterButtons.forEach((button) => {
    const isSelected = button.dataset.areaType === type;
    button.classList.toggle("is-selected", isSelected);
    button.classList.remove("is-active");
    button.setAttribute("aria-pressed", String(isSelected));
  });
  renderAllAreaButton(direction);

  if (state.selectionMode === "all") {
    setSelectedAreas(getFilteredAreas(), "all", direction);
  } else if (
    state.selectionMode === "single" &&
    type !== "all" &&
    state.selectedAreas[0]?.type !== type
  ) {
    setSelectedAreas([], "");
  }
  renderSearchResults();
}

function validateForm() {
  let valid = true;
  const isState = elements.geographyLevel.value === "state";
  const isCountry = elements.geographyLevel.value === "country";
  if (!isCountry && state.selectedAreas.length === 0) {
    elements.areaError.textContent = isState
      ? "Search for and select a state, or choose Select all states."
      : "Search for and select a metro area, or select every area in the current category.";
    valid = false;
  } else {
    elements.areaError.textContent = "";
  }

  const rawFilename = elements.filename.value.trim();
  elements.filenameError.textContent = rawFilename ? "" : "Enter a filename.";
  elements.filename.closest(".filename-field").classList.toggle("is-invalid", !rawFilename);
  if (!rawFilename) valid = false;

  if (!valid) {
    const invalidTarget = !isCountry && state.selectedAreas.length === 0
      ? elements.metroSearch
      : elements.filename;
    invalidTarget.closest(".query-step-section")?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    invalidTarget.focus({ preventScroll: false });
  }
  return valid;
}

function renderTable() {
  elements.resultBody.replaceChildren();
  const previewRows = state.aggregated.slice(0, PREVIEW_ROW_LIMIT);
  const isStateResult = state.resultGeographyLevel === "state";
  const isCountryResult = state.resultGeographyLevel === "country";

  previewRows.forEach((row) => {
    const tr = document.createElement("tr");

    const areaCell = document.createElement("th");
    areaCell.scope = "row";
    areaCell.className = "area-name-cell";
    areaCell.textContent = row.areaName;
    areaCell.title = row.areaName;

    const typeCell = document.createElement("td");
    const type = document.createElement("span");
    type.className = `table-type${row.areaType === "csa" ? " is-csa" : ""}`;
    type.textContent = getAreaLabel(row.areaType);
    typeCell.append(type);

    const yearCell = document.createElement("td");
    yearCell.textContent = row.year;

    const valueCell = document.createElement("td");
    valueCell.className = "value-cell";
    if (row.status === "ok") {
      valueCell.textContent = numberFormatter.format(row.total);
    } else {
      valueCell.textContent = "No data";
      valueCell.classList.add("missing-value");
    }

    const statusCell = document.createElement("td");
    const status = document.createElement("span");
    status.className = `row-status ${row.status === "ok" ? "is-complete" : "is-missing"}`;
    status.textContent = row.status === "ok"
      ? isCountryResult
        ? row.calculated ? "Calculated" : "Reported"
        : isStateResult ? "Reported" : "Aggregated"
      : row.missingReason === "no-record"
        ? "No BEA data"
        : row.missingReason === "zero" ? "All values are 0" : "Invalid data";
    statusCell.append(status);

    tr.append(areaCell, typeCell, yearCell, valueCell, statusCell);
    elements.resultBody.append(tr);
  });

  if (state.aggregated.length > PREVIEW_ROW_LIMIT) {
    const tr = document.createElement("tr");
    tr.className = "preview-limit-row";
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = `Only the first ${PREVIEW_ROW_LIMIT} rows are shown. Export to Excel to view all ${numberFormatter.format(state.aggregated.length)} rows.`;
    tr.append(td);
    elements.resultBody.append(tr);
  }
}

function showResult(parsed, source, parameters, areas, queryContext = null) {
  const records = filterRecordsForTable(parsed.records, parameters.TABLENAME);
  const isCountryResult = String(parameters.DATASETNAME).toUpperCase() === "NIPA";
  const isStateResult = String(parameters.GEOFIPS).toUpperCase() === "STATE"
    || String(parameters.TABLENAME).toUpperCase().startsWith("SA");
  const periods = [...new Set(
    records.map((record) => String(record.TimePeriod ?? "").trim()).filter(Boolean),
  )];
  const aggregated = isCountryResult
    ? mapCountryGdpRecords(records, {
        cumulativeQuarterly: Boolean(queryContext?.cumulativeQuarterly),
      })
    : isStateResult
      ? mapStateRecords(records, collectAreaFips(areas))
      : aggregateByAreas(records, areas, periods);
  if (aggregated.length === 0) {
    const rangeHint = String(parameters.TABLENAME).toUpperCase() === "CAINC1"
      ? " (population data is limited to 2001 onward)"
      : "";
    throw new Error(
      isCountryResult
        ? "No NIPA GDP records matched LineNumber 1 and Gross domestic product."
        : isStateResult
        ? "No state-level GeoFips, TimePeriod, and DataValue records were returned."
        : `No GeoFips and TimePeriod records matched the selected metro areas${rangeHint}.`,
    );
  }

  const resultAreas = isCountryResult
    ? [COUNTRY_AREA]
    : isStateResult
    ? [...new Map(aggregated.map((row) => [
        row.areaId,
        {
          id: row.areaId,
          type: "state",
          code: row.areaCode,
          name: row.areaName,
          fips: [`${row.areaCode}000`],
        },
      ])).values()]
    : areas;

  state.source = source;
  state.records = records;
  state.aggregated = aggregated;
  state.resultAreas = resultAreas;
  state.resultGeographyLevel = isCountryResult ? "country" : isStateResult ? "state" : "county";
  state.parameters = parameters;
  state.queryContext = queryContext;
  state.meta = parsed.meta;

  const missing = aggregated.filter((row) => row.status === "missing").length;
  const years = [...new Set(aggregated.map((row) => row.year))]
    .sort((a, b) => String(a).localeCompare(String(b), "en-US", { numeric: true }));
  const calendarYearCount = new Set(years.map((period) => String(period).slice(0, 4))).size;
  const firstYear = years[0] ?? "—";
  const lastYear = years.at(-1) ?? "—";
  const unit = getUnitLabel(parsed.meta.unit, parameters.TABLENAME);
  const metricLabel = getMetricLabel(parameters.LINECODE, parameters.TABLENAME);

  elements.sourceLabel.textContent = source;
  elements.areaCount.textContent = numberFormatter.format(resultAreas.length);
  elements.recordCount.textContent = numberFormatter.format(records.length);
  elements.yearCount.textContent = numberFormatter.format(calendarYearCount);
  elements.missingCount.textContent = numberFormatter.format(missing);
  elements.tableRange.textContent = `${firstYear === lastYear ? firstYear : `${firstYear} — ${lastYear}`} · ${numberFormatter.format(aggregated.length)} rows`;
  elements.tableTitle.textContent = isCountryResult
    ? "United States"
    : isStateResult
    ? resultAreas.length === 1 ? resultAreas[0].name : "All states"
    : resultAreas.length === 1 ? resultAreas[0].name : "All metro areas";
  elements.tableCaption.textContent = `${metricLabel} · Unit: ${unit}`;
  elements.metricColumnHeading.textContent = metricLabel;
  elements.areaColumnHeading.textContent = isCountryResult
    ? "Country name"
    : isStateResult ? "State name" : "Metro area name";
  elements.typeColumnHeading.textContent = isCountryResult || isStateResult ? "Level" : "Type";

  if (isCountryResult) {
    elements.androidResultScope.textContent = "United States";
    elements.resultNoteText.textContent = queryContext?.cumulativeQuarterly
      ? "Quarterly cumulative GDP is calculated in the application as Q1, Q1+Q2, and Q1+Q2+Q3. Q4 is intentionally omitted."
      : `NIPA ${parameters.FREQUENCY === "Q" ? "quarterly" : "annual"} GDP is shown as reported by BEA from LineNumber 1.`;
  } else if (isStateResult) {
    elements.androidResultScope.textContent = resultAreas.length === 1
      ? resultAreas[0].name
      : "All states";
    elements.resultNoteText.textContent = missing
      ? `State-level DataValue records are shown as reported by BEA; ${missing} state-by-year records have no usable value.`
      : "State-level DataValue records are shown as reported by BEA. No MSA or CSA aggregation is applied.";
  } else if (resultAreas.length === 1) {
    elements.androidResultScope.textContent = resultAreas[0].name;
    const skippedCount = aggregated.reduce((sum, row) => sum + row.zeroCount, 0);
    elements.resultNoteText.textContent = missing
      ? `County records were aggregated by year, excluding DataValue records equal to 0. ${missing} years have no usable data.`
      : skippedCount
        ? `County records were aggregated by year; ${skippedCount} records with DataValue equal to 0 were excluded.`
        : "All county GeoFips in this metro area were summed by TimePeriod.";
  } else {
    const resultTypes = new Set(resultAreas.map((area) => area.type));
    elements.androidResultScope.textContent = resultTypes.size > 1
      ? "All Metropolitan and Combined Statistical Areas"
      : resultTypes.has("csa")
        ? "All Combined Statistical Areas"
        : "All Metropolitan Statistical Areas";
    const unsupportedAreas = resultAreas.filter(
      (area) => area.fips.every((fips) => fips.startsWith("72")),
    ).length;
    elements.resultNoteText.textContent = `${resultAreas.length} metro areas were aggregated separately, excluding county records with DataValue equal to 0. ${missing} metro-area-by-year results have no usable data${unsupportedAreas ? `; ${unsupportedAreas} Puerto Rico metro areas are outside BEA ${parameters.TABLENAME} coverage` : ""}.`;
  }

  renderTable();
  renderMetadata();
  updateFilenameLabels();
  setPreviewTab(state.previewTab);
  updateQuerySummary();
  setState("success");
}

async function fetchBatch(parameters, codes, signal) {
  const batchParameters = Array.isArray(codes) && codes.length > 0
    ? { ...parameters, GEOFIPS: codes.join(",") }
    : parameters;
  const requestUrl = buildBeaUrl(
    batchParameters,
    IS_ANDROID ? BEA_ENDPOINT : BEA_PROXY_ENDPOINT,
  );
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let payload;
      if (window.desktopAPI?.fetchBea) {
        if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
        const search = new URL(requestUrl, "https://metro-gdp.local").search;
        const result = await window.desktopAPI.fetchBea(search);
        if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
        if (!result?.ok) {
          throw new Error(
            result?.error || `BEA API request failed (HTTP ${result?.status || "unknown"}).`,
          );
        }
        payload = result.payload;
      } else if (IS_ANDROID) {
        if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
        const response = await CapacitorHttp.get({
          url: requestUrl,
          headers: { Accept: "application/json" },
          connectTimeout: 30000,
          readTimeout: 60000,
        });
        if (signal.aborted) throw new DOMException("Request aborted", "AbortError");
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`BEA API request failed (HTTP ${response.status}).`);
        }
        payload = response.data;
      } else {
        const response = await fetch(requestUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal,
        });
        if (!response.ok) throw new Error(`BEA API request failed (HTTP ${response.status}).`);
        payload = await response.json();
      }
      return parseBeaPayload(payload);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt * 700));
      }
    }
  }

  throw lastError;
}

async function fetchData() {
  if (!validateForm()) return;

  const isStateRequest = elements.geographyLevel.value === "state";
  const isCountryRequest = elements.geographyLevel.value === "country";
  const allFips = collectAreaFips(state.selectedAreas);
  const fips = isCountryRequest
    ? []
    : isStateRequest
    ? state.selectionMode === "all" ? ["STATE"] : allFips
    : allFips.filter((code) => !code.startsWith("72"));
  state.unsupportedFips = isStateRequest || isCountryRequest
    ? []
    : allFips.filter((code) => code.startsWith("72"));
  if (!isCountryRequest && fips.length === 0) {
    setState(
      "error",
      isStateRequest
        ? "Select a state before running the query."
        : "The selected metro areas do not contain any supported five-digit GeoFips codes.",
    );
    return;
  }

  const form = readForm(fips.join(","));
  const parameters = isCountryRequest
    ? buildNipaRequestParameters(form)
    : buildRequestParameters(form);
  const queryContext = isCountryRequest
    ? {
        cumulativeQuarterly:
          form.frequency === "Q" && elements.quarterlyMode.value === "cumulative",
        quarterlyMode: elements.quarterlyMode.value,
      }
    : null;
  const batches = isCountryRequest ? [null] : isStateRequest ? [fips] : chunkValues(fips, API_BATCH_SIZE);
  if (state.controller) state.controller.abort();
  const controller = new AbortController();
  state.controller = controller;
  setState("loading");
  elements.loadingTitle.textContent = isCountryRequest
    ? "Loading country-level NIPA data"
    : isStateRequest ? "Loading state-level BEA data" : "Loading BEA data in batches";
  const requestedYearLabel = elements.year.selectedOptions[0]?.textContent || elements.year.value;
  elements.loadingMessage.textContent = isCountryRequest
    ? `United States ${parameters.FREQUENCY === "Q" ? "quarterly" : "annual"} GDP for ${requestedYearLabel.toLocaleLowerCase("en-US")} will be loaded.`
    : isStateRequest
    ? state.selectionMode === "all"
      ? `All state records for ${requestedYearLabel.toLocaleLowerCase("en-US")} will be loaded.`
      : `${state.selectedAreas[0].name}: ${requestedYearLabel.toLocaleLowerCase("en-US")} will be loaded.`
    : `${fips.length} supported GeoFips codes will be loaded in ${batches.length} batches.`;

  try {
    const parsedBatches = new Array(batches.length);
    let nextBatch = 0;
    let completed = 0;

    async function worker() {
      while (nextBatch < batches.length) {
        const index = nextBatch;
        nextBatch += 1;
        try {
          parsedBatches[index] = await fetchBatch(parameters, batches[index], controller.signal);
        } catch (error) {
          throw new Error(`Batch ${index + 1} of ${batches.length} failed: ${error.message}`);
        }
        completed += 1;
        setProgress(18 + (completed / batches.length) * 72);
        elements.loadingMessage.textContent = isCountryRequest
          ? "NIPA GDP records received. Preparing the results."
          : isStateRequest
            ? "State-level records received. Preparing the results."
            : `Completed ${completed} of ${batches.length} batches for ${fips.length} GeoFips codes.`;
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(API_CONCURRENCY, batches.length) }, () => worker()),
    );

    const parsed = {
      records: parsedBatches.flatMap((batch) => batch.records),
      request: parameters,
      meta: parsedBatches[0]?.meta ?? {},
    };
    setProgress(94);
    showResult(parsed, "BEA API", parameters, state.selectedAreas, queryContext);
    if (isCountryRequest) {
      showToast(
        queryContext.cumulativeQuarterly
          ? "Loaded NIPA GDP and calculated cumulative quarterly values."
          : "Loaded country-level NIPA GDP for the United States.",
      );
    } else if (isStateRequest) {
      showToast(
        state.resultAreas.length === 1
          ? `Loaded state-level data for ${state.resultAreas[0].name}.`
          : `Loaded ${state.resultAreas.length} state-level geographies.`,
      );
    } else {
      const areaLabel = state.selectedAreas.length === 1 ? "metro area" : "metro areas";
      showToast(`Aggregation completed for ${state.selectedAreas.length} ${areaLabel}.`);
    }
  } catch (error) {
    controller.abort();
    const message = error.name === "AbortError"
      ? "The request was canceled or timed out. Try again."
      : `${error.message || "Unable to load data."} Check the network connection and query parameters, then try again.`;
    setState("error", message);
  } finally {
    if (state.controller === controller) state.controller = null;
  }
}

function buildParameterRows() {
  const p = state.parameters ?? {};
  const tableName = p.TABLENAME || DEFAULT_PARAMETERS.TABLENAME;
  const lineCode = p.LINECODE || DEFAULT_PARAMETERS.LINECODE;
  const isStateResult = state.resultGeographyLevel === "state";
  const isCountryResult = state.resultGeographyLevel === "country";
  if (isCountryResult) {
    return [
      ["Parameter", "Description", "Value"],
      ["METHOD", "Request method", p.METHOD || "GETDATA"],
      ["DATASETNAME", "Dataset", p.DATASETNAME || "NIPA"],
      ["AREA_SCOPE", "Country scope", "United States"],
      ["TABLENAME", `Measure (${getMetricLabel("", tableName)})`, tableName],
      ["FREQUENCY", "BEA frequency", p.FREQUENCY || "A"],
      ["CALCULATION", "Application calculation", state.queryContext?.cumulativeQuarterly
        ? "Q1; Q1+Q2; Q1+Q2+Q3 (Q4 omitted)"
        : "As reported by BEA"],
      ["TARGET_LINE", "NIPA record filter", "LineNumber 1 · Gross domestic product"],
      ["YEAR", "Years", p.YEAR || "ALL"],
      ["UNIT", "DataValue unit", getUnitLabel(state.meta?.unit, tableName)],
      ["RESULTFORMAT", "Response format", p.RESULTFORMAT || "JSON"],
      ["SOURCE", "Data source", state.source],
      ["STATISTIC", "BEA statistic description", state.meta?.statistic || ""],
    ];
  }
  const fips = isStateResult
    ? [p.GEOFIPS || "STATE"]
    : collectAreaFips(state.resultAreas);
  const areaScope = isStateResult
    ? state.resultAreas.length === 1 ? state.resultAreas[0].name : "All states"
    : state.resultAreas.length === 1
      ? `${getAreaLabel(state.resultAreas[0].type)} · ${state.resultAreas[0].name}`
      : `${state.resultAreas.length} MSAs/CSAs`;

  return [
    ["Parameter", "Description", "Value"],
    ["METHOD", "Request method", p.METHOD || "GETDATA"],
    ["DATASETNAME", "Dataset", p.DATASETNAME || "REGIONAL"],
    ["AREA_SCOPE", isStateResult ? "State scope" : "Metro-area scope", areaScope],
    ["AREA_COUNT", isStateResult ? "State geography count" : "Metro-area count", state.resultAreas.length],
    ["GEOFIPS", isStateResult ? "Selected state scope" : `Complete five-digit GeoFips (${fips.length})`, fips.join(",")],
    ["UNAVAILABLE_GEOFIPS", `GeoFips unsupported by BEA ${tableName}`, state.unsupportedFips.join(",")],
    ["LINECODE", `Measure (${getMetricLabel(lineCode, tableName)})`, lineCode],
    ["TABLENAME", `Data type (${getTableLabel(tableName)})`, tableName],
    ["YEAR", "Years", p.YEAR || "ALL"],
    ["RESULTFORMAT", "Response format", p.RESULTFORMAT || "JSON"],
    ["USERID", "BEA API Key", p.USERID || ""],
    ["SOURCE", "Data source", state.source],
    ["AREA_SOURCE", isStateResult ? "BEA state geographies" : "Metro-area definitions", isStateResult ? "BEA Regional API" : metroDataset.source],
    ["STATISTIC", "BEA statistic description", state.meta?.statistic || ""],
  ];
}

async function exportExcel() {
  if (state.status !== "success" || state.aggregated.length === 0) return;

  const buttons = [elements.exportButton];
  buttons.forEach((button) => {
    button.disabled = true;
    button.classList.add("is-busy");
  });

  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const isStateResult = state.resultGeographyLevel === "state";
    const isCountryResult = state.resultGeographyLevel === "country";
    const exportGroups = isCountryResult
      ? [{ type: "country", label: "Country" }]
      : isStateResult
      ? [{ type: "state", label: "State" }]
      : [
          { type: "msa", label: "Metropolitan Statistical Area" },
          { type: "csa", label: "Combined Statistical Area" },
        ];

    exportGroups.forEach(({ type, label }) => {
      const groupRows = state.aggregated.filter((row) => row.areaType === type);
      if (groupRows.length === 0) return;

      const tableName = state.parameters?.TABLENAME || DEFAULT_PARAMETERS.TABLENAME;
      const metricLabel = getMetricLabel(state.parameters?.LINECODE, tableName);
      const unit = getUnitLabel(state.meta?.unit, tableName);
      const matrix = buildAreaYearMatrix(
        groupRows,
        label,
        `${metricLabel}${unit ? ` (${unit})` : ""}`,
        isCountryResult || isStateResult ? "Geographic level" : "Metro area type",
      );
      const dataSheet = XLSX.utils.aoa_to_sheet(matrix.rows);
      dataSheet["!cols"] = [
        { wch: 48 },
        ...matrix.years.map(() => ({ wch: 15 })),
      ];
      const lastColumn = XLSX.utils.encode_col(matrix.years.length);
      dataSheet["!autofilter"] = {
        ref: `A3:${lastColumn}${matrix.rows.length}`,
      };
      XLSX.utils.book_append_sheet(workbook, dataSheet, label);
    });

    const countyRows = isCountryResult || isStateResult
      ? []
      : buildAreaCountyRows(
          state.records,
          state.resultAreas,
          state.aggregated.map((row) => row.year),
        );
    if (countyRows.length > 0) {
      const countySheet = XLSX.utils.aoa_to_sheet(countyRows);
      countySheet["!cols"] = [
        { wch: 12 },
        { wch: 46 },
        { wch: 12 },
        { wch: 15 },
        { wch: 32 },
        { wch: 10 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
      ];
      countySheet["!autofilter"] = { ref: `A1:I${countyRows.length}` };
      XLSX.utils.book_append_sheet(workbook, countySheet, "Metro Area County Data");
    }

    const parameterSheet = XLSX.utils.aoa_to_sheet(buildParameterRows());
    parameterSheet["!cols"] = [{ wch: 18 }, { wch: 30 }, { wch: 100 }];

    XLSX.utils.book_append_sheet(workbook, parameterSheet, "Request Parameters");
    const tableName = state.parameters?.TABLENAME || DEFAULT_PARAMETERS.TABLENAME;
    const tableLabel = getTableLabel(tableName);
    workbook.Props = {
      Title: isCountryResult
        ? `BEA United States ${tableLabel}`
        : isStateResult ? `BEA State ${tableLabel}` : `BEA Metro Area ${tableLabel}`,
      Subject: isCountryResult
        ? `BEA NIPA ${tableLabel} for the United States`
        : isStateResult
        ? `BEA Regional ${tableLabel} reported by state and year`
        : `BEA Regional ${tableLabel} aggregated by MSA/CSA and year`,
      Author: "Metro Studio",
      CreatedDate: new Date(),
    };

    const filename = `${sanitizeFilename(elements.filename.value)}.xlsx`;
    if (IS_ANDROID) {
      const data = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "base64",
        compression: true,
      });
      if (state.saveLocation.configured) {
        const result = await SaveLocation.saveFile({
          filename,
          data,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        showToast(`${result.filename || filename} was saved to ${state.saveLocation.label}.`);
      } else {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import("@capacitor/filesystem"),
          import("@capacitor/share"),
        ]);
        const result = await Filesystem.writeFile({
          path: filename,
          data,
          directory: Directory.Cache,
          recursive: true,
        });
        await Share.share({
          title: filename,
          text: "Metro Studio Excel export",
          url: result.uri,
          dialogTitle: "Save or share workbook",
        });
        showToast(`${filename} is ready to save or share.`);
      }
    } else {
      XLSX.writeFile(workbook, filename, { compression: true });
      showToast(`${filename} was created.`);
    }
  } catch (error) {
    setState("error", `Unable to create the Excel file: ${error.message || "Try again later."}`);
  } finally {
    buttons.forEach((button) => {
      button.disabled = state.status !== "success";
      button.classList.remove("is-busy");
    });
  }
}

let toastTimer;
function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.querySelector("span").textContent = message;
  elements.toast.hidden = false;
  requestAnimationFrame(() => elements.toast.classList.add("is-visible"));
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
    window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 180);
  }, 3200);
}

function renderVersionInformation() {
  const information = IS_ANDROID
    ? VERSION_INFORMATION.android
    : VERSION_INFORMATION.windows;
  elements.versionDescription.textContent = information.description;
  elements.versionPlatform.textContent = information.platform;
  elements.versionArchitecture.textContent = information.architecture;
  elements.versionReleaseTitle.textContent = information.releaseTitle;
  elements.versionChangeList.replaceChildren(
    ...information.changes.map((change) => {
      const item = document.createElement("li");
      item.textContent = change;
      return item;
    }),
  );
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  fetchData();
});

elements.areaFilterButtons.forEach((button) => {
  button.addEventListener("click", () => updateAreaFilter(button.dataset.areaType));
});
elements.metroSearch.addEventListener("input", renderSearchResults);
elements.metroSearch.addEventListener("focus", renderSearchResults);
elements.metroSearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setAnimatedVisibility(elements.metroResults, false, true);
});
elements.clearSearch.addEventListener("click", () => {
  elements.metroSearch.value = "";
  setAnimatedVisibility(elements.metroResults, false, true);
  elements.clearSearch.hidden = true;
  elements.metroSearch.focus();
});
elements.selectAllAreas.addEventListener("click", () => {
  setSelectedAreas(getFilteredAreas(), "all");
  setAnimatedVisibility(elements.metroResults, false, true);
});
elements.clearSelection.addEventListener("click", () => setSelectedAreas([], ""));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".metro-search-block")) {
    setAnimatedVisibility(elements.metroResults, false, true);
  }
});

elements.geographyLevel.addEventListener("change", () => {
  syncGeographyLevelControls(true, true, true);
});
elements.tableName.addEventListener("change", () => {
  syncTableControls("", true);
  resetResultForSelectionChange();
  updateQuerySummary();
});
elements.lineCode.addEventListener("change", () => {
  if (elements.geographyLevel.value === "country") {
    syncTableControls(elements.lineCode.value, false);
  }
  resetResultForSelectionChange();
  updateQuerySummary();
});
elements.frequency.addEventListener("change", () => {
  syncCountryMeasureControls(true, true);
  syncTableControls(elements.lineCode.value, false);
  resetResultForSelectionChange();
  updateQuerySummary();
});
elements.quarterlyMode.addEventListener("change", () => {
  resetResultForSelectionChange();
  updateQuerySummary();
});
elements.year.addEventListener("change", () => {
  resetResultForSelectionChange();
  updateQuerySummary();
});

elements.filename.addEventListener("input", () => {
  elements.filenameError.textContent = "";
  elements.filename.closest(".filename-field").classList.remove("is-invalid");
  updateFilenameLabels();
});
elements.retryButton.addEventListener("click", fetchData);
elements.exportButton.addEventListener("click", exportExcel);
elements.saveLocationButton.addEventListener("click", chooseSaveLocation);
elements.resetSaveLocation.addEventListener("click", resetSaveLocation);
elements.mobileSettingsButton.addEventListener("click", () => {
  if (state.currentView === "home") {
    navigateToView("settings");
  } else if (state.currentView === "settings") {
    navigateToView("home");
  } else {
    navigateToView("settings");
  }
});

elements.themeButtons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeOption, true));
});

elements.previewTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => setPreviewTab(tab.dataset.previewTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + direction + elements.previewTabs.length) % elements.previewTabs.length;
    setPreviewTab(elements.previewTabs[nextIndex].dataset.previewTab, true);
  });
});

elements.querySummaryButton.addEventListener("click", openQuerySummary);
elements.previewOptionsButton.addEventListener("click", openQuerySummary);
elements.querySummarySheet.addEventListener("click", (event) => {
  if (event.target === elements.querySummarySheet) elements.querySummarySheet.close("cancel");
});

elements.viewTargets.forEach((button) => {
  button.addEventListener("click", () => navigateToView(button.dataset.viewTarget));
});
elements.placeholderButtons.forEach((button) => {
  if (button.dataset.placeholder === "github" && GITHUB_URL) {
    const accessory = button.querySelector(".coming-soon");
    if (accessory) accessory.textContent = "Open";
    button.setAttribute("aria-label", "Open GitHub in the system browser");
  }
  button.addEventListener("click", () => {
    if (button.dataset.placeholder === "github") {
      if (GITHUB_URL) window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
      else showToast("The GitHub link will be added after the repository is published.");
    }
  });
});

document.addEventListener("keydown", (event) => {
  const commandKey = event.ctrlKey || event.metaKey;
  if (commandKey && !event.altKey && event.key.toLocaleLowerCase() === "f") {
    if (state.currentView !== "home") navigateToView("home", false, false);
    event.preventDefault();
    elements.metroSearch.focus();
    return;
  }
  if (!event.ctrlKey || event.altKey || event.metaKey) return;
  const viewByKey = { "1": "home", "2": "data-sources" };
  const view = viewByKey[event.key];
  if (!view) return;
  event.preventDefault();
  navigateToView(view, true, false);
});

if (window.desktopAPI?.isDesktop) {
  document.documentElement.classList.add("is-desktop");
} else if (IS_ANDROID) {
  elements.platformVersion.textContent = "V1.0.0 · Android x86_64";
  elements.settingsThemeSlot.append(document.querySelector(".theme-control"));
  let scrollFrame = 0;
  elements.appMain.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      document.documentElement.classList.toggle(
        "mobile-header-collapsed",
        elements.appMain.scrollTop > 32,
      );
      scrollFrame = 0;
    });
  }, { passive: true });
}

renderVersionInformation();
initializeTheme();
initializeSaveLocation();
initializeAndroidSelectControls();
syncGeographyLevelControls(false, false);
renderAllAreaButton();
renderSelectedArea();
updateFilenameLabels();
updateQuerySummary();
setPreviewTab("table");
setState("idle");
