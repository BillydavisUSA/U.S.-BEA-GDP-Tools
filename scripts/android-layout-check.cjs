const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const artifacts = path.join(root, "artifacts");
const motionDuration = 850;
const closeMotionDuration = 550;
const motionMidpoint = 260;
const motionSettleDelay = 930;

async function capture(window, filename) {
  window.webContents.invalidate();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await window.webContents.capturePage();
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, filename), image.toPNG());
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 393,
    height: 852,
    show: false,
    frame: false,
    backgroundColor: "#1c1c1e",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  window.webContents.setUserAgent(
    "Mozilla/5.0 (Linux; Android 17; Metro Studio layout audit) AppleWebKit/537.36 Chrome/138.0 Mobile Safari/537.36",
  );
  await window.loadFile(path.join(root, "dist", "index.html"));
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await window.webContents.executeJavaScript(`(() => {
    document.documentElement.dataset.theme = "dark";
    const slot = document.querySelector("#settings-theme-slot");
    const theme = document.querySelector(".theme-control");
    if (slot && theme) slot.append(theme);
  })()`);

  const home = await window.webContents.executeJavaScript(`(() => ({
    motionPreference: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "reduce"
      : "no-preference",
    noHorizontalOverflow:
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    sidebarHidden: getComputedStyle(document.querySelector(".sidebar")).display === "none",
    queryTitleHidden: getComputedStyle(document.querySelector(".query-header")).display === "none",
    brandHidden: getComputedStyle(document.querySelector(".toolbar-brand")).display === "none",
    settingsVisible:
      getComputedStyle(document.querySelector("#mobile-settings-button")).display !== "none",
    settingsButtonCircular: (() => {
      const button = document.querySelector("#mobile-settings-button");
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return Math.abs(rect.width - 48) < 0.5
        && Math.abs(rect.height - 48) < 0.5
        && Math.abs(rect.width - rect.height) < 0.5
        && style.borderTopLeftRadius === "50%";
    })(),
    verticallyScrollable: (() => {
      const main = document.querySelector("#main-content");
      const original = main.scrollTop;
      main.scrollTop = 200;
      const canScroll = main.scrollHeight > main.clientHeight && main.scrollTop > 0;
      main.scrollTop = original;
      return canScroll;
    })(),
    scrollbarsHiddenWithoutGutter: (() => {
      const main = document.querySelector("#main-content");
      const style = getComputedStyle(main);
      const webkitScrollbar = getComputedStyle(main, "::-webkit-scrollbar");
      return style.scrollbarWidth === "none"
        && style.scrollbarGutter === "auto"
        && webkitScrollbar.display === "none"
        && webkitScrollbar.width === "0px";
    })(),
    androidSelectsInstalled: (() => {
      const selects = [...document.querySelectorAll(".pop-up-button > select")];
      const triggers = [...document.querySelectorAll(".android-select-trigger")];
      return selects.length > 0
        && selects.length === triggers.length
        && selects.every((select) => getComputedStyle(select).display === "none");
    })(),
    noDownwardGlow: (() => {
      const isInsetOnly = (element) => {
        const shadow = getComputedStyle(element).boxShadow;
        return shadow === "none" || shadow.endsWith("inset");
      };
      return [
        ...document.querySelectorAll(".query-step-section"),
        ...document.querySelectorAll(".search-field"),
        ...document.querySelectorAll(".area-filter"),
        ...document.querySelectorAll(".selection-button"),
        ...document.querySelectorAll(".pop-up-button"),
        ...document.querySelectorAll(".checkbox-control"),
        document.querySelector(".floating-query-action .button"),
        document.querySelector("#mobile-settings-button")
      ].filter(Boolean).every(isInsetOnly);
    })(),
    queryCardGeometry: [...document.querySelectorAll(".query-step-section")].map(
      (card) => ({
        radius: getComputedStyle(card).borderTopLeftRadius,
        shape: getComputedStyle(card).cornerShape
      })
    ),
    queryCardsRounded4xl: [...document.querySelectorAll(".query-step-section")].every(
      (card) =>
        getComputedStyle(card).borderTopLeftRadius === "32px"
        && getComputedStyle(card).cornerShape !== "squircle"
    ),
    queryControlsRoundedFull: [
      ".search-field",
      ".area-filter",
      ".area-filter .segment-button",
      ".selection-button",
      ".android-select-trigger",
      ".filename-field",
      ".checkbox-control"
    ].every((selector) =>
      [...document.querySelectorAll(selector)].every(
        (control) => getComputedStyle(control).borderTopLeftRadius === "999px"
      )
    )
  }))()`);
  await capture(window, "android-layout-home.png");

  const searchResults = await window.webContents.executeJavaScript(`(async () => {
    const input = document.querySelector("#metro-search");
    input.value = "new";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, ${motionSettleDelay}));
    const stack = document.querySelector(".search-selection-stack");
    const search = document.querySelector(".search-field");
    const results = document.querySelector("#metro-results");
    const measure = document.querySelector(".measure-step");
    const searchRect = search.getBoundingClientRect();
    const resultsRect = results.getBoundingClientRect();
    const measureRect = measure.getBoundingClientRect();
    const style = getComputedStyle(results);
    const webkitScrollbar = getComputedStyle(results, "::-webkit-scrollbar");
    return {
      visible: !results.hidden,
      attachedBelowSearch: resultsRect.top >= searchRect.bottom - 1,
      pushesMeasureDown: resultsRect.bottom <= measureRect.top,
      sharedRounded4xlCard:
        getComputedStyle(stack).borderTopLeftRadius === "32px"
        && getComputedStyle(stack).borderTopWidth === "1px"
        && style.borderBottomLeftRadius === "32px",
      optionsRoundedFull: [...results.querySelectorAll(".metro-option")].every(
        (option) => getComputedStyle(option).borderTopLeftRadius === "999px"
      ),
      scrollbarHiddenWithoutGutter:
        style.scrollbarWidth === "none"
        && style.scrollbarGutter === "auto"
        && webkitScrollbar.display === "none"
        && webkitScrollbar.width === "0px"
    };
  })()`);
  await capture(window, "android-layout-search-results.png");
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector("#metro-search");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay));

  const selectMotionStart = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector("#table-name");
    const wrapper = select.closest(".pop-up-button");
    const trigger = wrapper.querySelector(".android-select-trigger");
    const menu = wrapper.querySelector(".android-select-menu");
    wrapper.scrollIntoView({ block: "start", behavior: "auto" });
    const outputTopBefore = document.querySelector(".output-step").getBoundingClientRect().top;
    trigger.click();
    const menuAnimation = menu.getAnimations()[0];
    const keyframes = menuAnimation?.effect.getKeyframes() ?? [];
    return {
      outputTopBefore,
      menuAnimationStarted: Boolean(menuAnimation),
      menuDuration: menuAnimation?.effect.getTiming().duration ?? 0,
      menuEasing: menuAnimation?.effect.getTiming().easing ?? "",
      initialMenuHeight: menu.getBoundingClientRect().height,
      usesPhysicalHeightReveal:
        keyframes.length === 2
        && keyframes.every(
          (frame) =>
            typeof frame.height === "string"
            && !Object.hasOwn(frame, "opacity")
            && !Object.hasOwn(frame, "transform")
            && !Object.hasOwn(frame, "clipPath")
        )
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionMidpoint));
  const selectMotionMid = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelector("#table-name").closest(".pop-up-button");
    const menu = wrapper.querySelector(".android-select-menu");
    const menuStyle = getComputedStyle(menu);
    return {
      outputTop: document.querySelector(".output-step").getBoundingClientRect().top,
      menuHeight: menu.getBoundingClientRect().height,
      menuStillAnimating: menu.getAnimations().some(
        (animation) => animation.playState === "running"
      ),
      noOpacityOrTransformReveal:
        menuStyle.opacity === "1"
        && menuStyle.transform === "none"
        && menuStyle.clipPath === "none"
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay - motionMidpoint));
  let selectMenu = await window.webContents.executeJavaScript(`(() => {
    const select = document.querySelector("#table-name");
    const wrapper = select.closest(".pop-up-button");
    const trigger = wrapper.querySelector(".android-select-trigger");
    const menu = wrapper.querySelector(".android-select-menu");
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const outputTopFinal = document.querySelector(".output-step").getBoundingClientRect().top;
    const firstOption = menu.querySelector(".android-select-option");
    const optionRect = firstOption.getBoundingClientRect();
    const wrapperStyle = getComputedStyle(wrapper);
    const triggerStyle = getComputedStyle(trigger);
    const section = wrapper.closest(".query-step-section");
    const sectionRect = section.getBoundingClientRect();
    const hit = document.elementFromPoint(
      optionRect.left + optionRect.width / 2,
      optionRect.top + optionRect.height / 2
    );
    const bottomEdgeHit = document.elementFromPoint(
      menuRect.left + menuRect.width / 2,
      menuRect.bottom - 1
    );
    let unclippedAncestors = true;
    let ancestor = menu.parentElement;
    while (ancestor) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (
        ["hidden", "clip"].includes(ancestorStyle.overflow)
        || ["hidden", "clip"].includes(ancestorStyle.overflowX)
        || ["hidden", "clip"].includes(ancestorStyle.overflowY)
      ) {
        unclippedAncestors = false;
        break;
      }
      if (ancestor === section) break;
      ancestor = ancestor.parentElement;
    }
    return {
      replacesNativeDialog:
        getComputedStyle(select).display === "none"
        && trigger.getAttribute("aria-expanded") === "true"
        && !menu.hidden,
      anchoredBelowControl: menuRect.top >= triggerRect.bottom,
      menuContained: menuRect.left >= 0 && menuRect.right <= innerWidth,
      menuParticipatesInLayout: getComputedStyle(menu).position === "relative",
      pushesFollowingCardDown: outputTopFinal > ${selectMotionStart.outputTopBefore} + menuRect.height * 0.8,
      expansionIsProgressive:
        ${selectMotionMid.outputTop} > ${selectMotionStart.outputTopBefore}
        && ${selectMotionMid.outputTop} < outputTopFinal,
      menuHeightGrowsFromZero:
        ${selectMotionStart.initialMenuHeight} <= 1
        && ${selectMotionMid.menuHeight} > 1
        && ${selectMotionMid.menuHeight} < menuRect.height,
      physicalHeightRevealOnly:
        ${selectMotionStart.usesPhysicalHeightReveal}
        && ${selectMotionMid.noOpacityOrTransformReveal},
      coordinatedDuration:
        ${selectMotionStart.menuDuration} === ${motionDuration},
      openingUsesEaseOut:
        ${JSON.stringify(selectMotionStart.menuEasing)}
        === "cubic-bezier(0.16, 1, 0.3, 1)",
      animationsRunTogether:
        ${selectMotionStart.menuAnimationStarted}
        && ${selectMotionMid.menuStillAnimating},
      optionsNotOccluded: menu.contains(hit),
      bottomEdgeNotClipped:
        (bottomEdgeHit === menu || menu.contains(bottomEdgeHit))
        && menuRect.bottom <= sectionRect.bottom
        && unclippedAncestors,
      wrapperDoesNotBecomeSurface:
        wrapperStyle.backgroundColor === "rgba(0, 0, 0, 0)"
        && wrapperStyle.borderTopWidth === "0px"
        && wrapperStyle.boxShadow === "none"
        && wrapperStyle.backdropFilter === "none"
        && wrapperStyle.transform === "none",
      triggerOwnsSingleGlassSurface:
        triggerStyle.borderTopWidth === "1px"
        && triggerStyle.borderTopLeftRadius === "999px"
        && triggerStyle.backgroundColor !== "rgba(0, 0, 0, 0)",
      noDownwardGlow: (() => {
        const shadow = getComputedStyle(menu).boxShadow;
        return shadow === "none" || shadow.endsWith("inset");
      })()
    };
  })()`);
  await capture(window, "android-layout-select-menu.png");
  const closeMotion = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelector("#table-name").closest(".pop-up-button");
    const menu = wrapper.querySelector(".android-select-menu");
    const trigger = wrapper.querySelector(".android-select-trigger");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const menuAnimation = menu.getAnimations()[0];
    const keyframes = menuAnimation?.effect.getKeyframes() ?? [];
    return {
      ariaCollapsedImmediately: trigger.getAttribute("aria-expanded") === "false",
      menuRemainsDuringExit: !menu.hidden,
      menuDuration: menuAnimation?.effect.getTiming().duration ?? 0,
      menuEasing: menuAnimation?.effect.getTiming().easing ?? "",
      closesByPhysicalHeight:
        keyframes.length === 2
        && keyframes.every(
          (frame) =>
            typeof frame.height === "string"
            && !Object.hasOwn(frame, "opacity")
            && !Object.hasOwn(frame, "transform")
            && !Object.hasOwn(frame, "clipPath")
        )
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay));
  const closeFinished = await window.webContents.executeJavaScript(`(() => {
    const wrapper = document.querySelector("#table-name").closest(".pop-up-button");
    const menu = wrapper.querySelector(".android-select-menu");
    const trigger = wrapper.querySelector(".android-select-trigger");
    return menu.hidden
      && !wrapper.classList.contains("is-open")
      && Math.abs(wrapper.getBoundingClientRect().height - trigger.getBoundingClientRect().height) < 1;
  })()`);
  selectMenu = {
    ...selectMenu,
    motionDiagnostics: {
      start: selectMotionStart,
      mid: selectMotionMid,
      close: closeMotion,
      closeFinished,
    },
    closeIsAnimated:
      closeMotion.ariaCollapsedImmediately
      && closeMotion.menuRemainsDuringExit
      && closeMotion.menuDuration === closeMotionDuration
      && closeMotion.menuEasing === "cubic-bezier(0.16, 1, 0.3, 1)"
      && closeMotion.closesByPhysicalHeight
      && closeFinished,
  };

  const allSelection = await window.webContents.executeJavaScript(`(() => {
    document.querySelector("#select-all-areas").click();
    const stack = document.querySelector(".search-selection-stack");
    const search = document.querySelector(".search-field");
    const selected = document.querySelector("#selected-area");
    return {
      visible: !selected.hidden,
      animationStarted: selected.getAnimations().some(
        (animation) => animation.playState === "running"
      ),
      layeredSelectionCard:
        getComputedStyle(stack).rowGap === "0px"
        && getComputedStyle(stack).borderTopLeftRadius === "32px"
        && getComputedStyle(stack).borderTopWidth === "1px"
        && getComputedStyle(search).borderBottomLeftRadius === "999px"
        && getComputedStyle(selected).borderTopLeftRadius === "0px"
        && getComputedStyle(selected).borderBottomLeftRadius === "32px"
        && getComputedStyle(selected).backgroundColor === "rgba(0, 0, 0, 0)"
        && getComputedStyle(selected).boxShadow === "none"
    };
  })()`);

  const areaFilterStart = await window.webContents.executeJavaScript(`(() => {
    const filter = document.querySelector(".area-filter");
    const indicatorStyle = getComputedStyle(filter, "::before");
    const initialTransform = indicatorStyle.transform === "none"
      ? new DOMMatrix()
      : new DOMMatrix(indicatorStyle.transform);
    document.querySelector('[data-area-type="msa"]').click();
    const content = document.querySelector("#select-all-areas > span:nth-child(2)");
    const selected = document.querySelector("#selected-area");
    return {
      initialX: initialTransform.m41,
      selectedIndex: filter.dataset.selectedIndex,
      indicatorDuration: indicatorStyle.transitionDuration,
      contentDuration: content.getAnimations()[0]?.effect.getTiming().duration ?? 0,
      selectedDuration: selected.getAnimations()[0]?.effect.getTiming().duration ?? 0
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionMidpoint));
  const areaFilterMidX = await window.webContents.executeJavaScript(`(() => {
    const transform = getComputedStyle(document.querySelector(".area-filter"), "::before").transform;
    return transform === "none" ? 0 : new DOMMatrix(transform).m41;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay - motionMidpoint));
  const areaFilterFinalX = await window.webContents.executeJavaScript(`(() => {
    const transform = getComputedStyle(document.querySelector(".area-filter"), "::before").transform;
    return transform === "none" ? 0 : new DOMMatrix(transform).m41;
  })()`);
  const areaFilterMotion = {
    indicatorMovesProgressively:
      areaFilterMidX > areaFilterStart.initialX
      && areaFilterMidX < areaFilterFinalX,
    movesInSelectionDirection: areaFilterFinalX > areaFilterStart.initialX,
    selectionStateUpdated: areaFilterStart.selectedIndex === "1",
    coordinatedDuration:
      areaFilterStart.indicatorDuration === "0.85s"
      && areaFilterStart.contentDuration === motionDuration
      && areaFilterStart.selectedDuration === motionDuration,
  };

  const drawerCloseStart = await window.webContents.executeJavaScript(`(() => {
    const selected = document.querySelector("#selected-area");
    const measure = document.querySelector(".measure-step");
    const fullHeight = selected.getBoundingClientRect().height;
    const measureTop = measure.getBoundingClientRect().top;
    document.querySelector("#clear-selection").click();
    const animation = selected.getAnimations()[0];
    const keyframes = animation?.effect.getKeyframes() ?? [];
    return {
      fullHeight,
      measureTop,
      scopeHeight: document.querySelector("#scope-step").getBoundingClientRect().height,
      animationStarted: animation?.playState === "running",
      duration: animation?.effect.getTiming().duration ?? 0,
      easing: animation?.effect.getTiming().easing ?? "",
      contentPreserved: document.querySelector("#selected-area-name").textContent.trim().length > 0,
      physicalDrawerOnly:
        keyframes.length === 2
        && keyframes.every(
          (frame) =>
            typeof frame.height === "string"
            && typeof frame.minHeight === "string"
            && !Object.hasOwn(frame, "opacity")
            && !Object.hasOwn(frame, "transform")
            && !Object.hasOwn(frame, "clipPath")
        )
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionMidpoint));
  const drawerCloseMid = await window.webContents.executeJavaScript(`(() => {
    const selected = document.querySelector("#selected-area");
    return {
      height: selected.getBoundingClientRect().height,
      measureTop: document.querySelector(".measure-step").getBoundingClientRect().top,
      scopeHeight: document.querySelector("#scope-step").getBoundingClientRect().height,
      stillAnimating: selected.getAnimations().some(
        (animation) => animation.playState === "running"
      ),
      contentStillVisible:
        document.querySelector("#selected-area-name").textContent.trim().length > 0
        && getComputedStyle(selected).opacity === "1"
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay - motionMidpoint));
  const drawerCloseEnd = await window.webContents.executeJavaScript(`(() => {
    const selected = document.querySelector("#selected-area");
    const stack = document.querySelector(".search-selection-stack");
    return {
      hidden: selected.hidden,
      height: selected.getBoundingClientRect().height,
      measureTop: document.querySelector(".measure-step").getBoundingClientRect().top,
      scopeHeight: document.querySelector("#scope-step").getBoundingClientRect().height,
      frameRemoved:
        getComputedStyle(stack).borderTopWidth === "0px"
        && getComputedStyle(document.querySelector(".search-field")).borderBottomLeftRadius === "999px"
    };
  })()`);
  const selectedDrawerMotion = {
    startsImmediately:
      drawerCloseStart.animationStarted
      && drawerCloseStart.contentPreserved,
    usesShortEaseOutClose:
      drawerCloseStart.duration === closeMotionDuration
      && drawerCloseStart.easing === "cubic-bezier(0.16, 1, 0.3, 1)",
    retractsAsPhysicalDrawer:
      drawerCloseStart.physicalDrawerOnly
      && drawerCloseMid.stillAnimating
      && drawerCloseMid.contentStillVisible
      && drawerCloseMid.height < drawerCloseStart.fullHeight
      && drawerCloseMid.height > 0,
    surroundingLayoutRetractsContinuously:
      drawerCloseMid.scopeHeight < drawerCloseStart.scopeHeight
      && drawerCloseMid.scopeHeight > drawerCloseEnd.scopeHeight,
    finishesWithoutBlankFrame:
      drawerCloseEnd.hidden
      && drawerCloseEnd.height === 0
      && drawerCloseEnd.frameRemoved,
  };

  const singleSelection = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector("#metro-search");
    input.value = "New York";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector(".metro-option").click();
    const selected = document.querySelector("#selected-area");
    const animation = selected.getAnimations()[0];
    const keyframes = animation?.effect.getKeyframes() ?? [];
    return {
      visible: !selected.hidden,
      animationStarted: animation?.playState === "running",
      opensFromZero: selected.getBoundingClientRect().height <= 1,
      opensAsPhysicalDrawer:
        animation?.effect.getTiming().duration === ${motionDuration}
        && animation?.effect.getTiming().easing === "cubic-bezier(0.16, 1, 0.3, 1)"
        && keyframes.length === 2
        && keyframes.every(
          (frame) =>
            typeof frame.height === "string"
            && typeof frame.minHeight === "string"
            && !Object.hasOwn(frame, "opacity")
            && !Object.hasOwn(frame, "transform")
            && !Object.hasOwn(frame, "clipPath")
        )
    };
  })()`);
  await capture(window, "android-layout-selection.png");

  const conditionalMotionStart = await window.webContents.executeJavaScript(`(() => {
    const scope = document.querySelector("#scope-step");
    const measure = document.querySelector("#measure-step");
    const scopeSlot = document.querySelector("#scope-motion-slot");
    const measureSlot = document.querySelector("#country-measure-slot");
    const geography = document.querySelector("#geography-level");
    const initialScopeHeight = scope.getBoundingClientRect().height;
    const initialMeasureHeight = measure.getBoundingClientRect().height;
    const initialScopeSlotHeight = scopeSlot.getBoundingClientRect().height;
    geography.value = "country";
    geography.dispatchEvent(new Event("change", { bubbles: true }));
    const scopeAnimation = scopeSlot.getAnimations()[0];
    const measureAnimation = measureSlot.getAnimations()[0];
    const scopeFrames = scopeAnimation?.effect.getKeyframes() ?? [];
    const measureFrames = measureAnimation?.effect.getKeyframes() ?? [];
    const dynamicDescendants = [
      ...scopeSlot.querySelectorAll("*"),
      ...measureSlot.querySelectorAll("*")
    ];
    return {
      initialScopeHeight,
      initialMeasureHeight,
      initialScopeSlotHeight,
      scopeDuration: scopeAnimation?.effect.getTiming().duration ?? 0,
      measureDuration: measureAnimation?.effect.getTiming().duration ?? 0,
      scopeUsesPhysicalTrack:
        scopeFrames.length === 2
        && scopeFrames.every(
          (frame) =>
            typeof frame.height === "string"
            && typeof frame.marginTop === "string"
            && !Object.hasOwn(frame, "opacity")
            && !Object.hasOwn(frame, "transform")
            && !Object.hasOwn(frame, "clipPath")
        ),
      measureUsesPhysicalTrack:
        measureFrames.length === 2
        && measureFrames.every(
          (frame) =>
            typeof frame.height === "string"
            && typeof frame.marginTop === "string"
            && !Object.hasOwn(frame, "opacity")
            && !Object.hasOwn(frame, "transform")
            && !Object.hasOwn(frame, "clipPath")
        ),
      descendantsDoNotAnimateLayout:
        dynamicDescendants.every((element) =>
          element.getAnimations().every((animation) => {
            if (animation.playState !== "running") return true;
            return animation.effect.getKeyframes().every((frame) =>
              !Object.hasOwn(frame, "height")
              && !Object.hasOwn(frame, "minHeight")
              && !Object.hasOwn(frame, "marginTop")
              && !Object.hasOwn(frame, "marginBottom")
              && !Object.hasOwn(frame, "paddingTop")
              && !Object.hasOwn(frame, "paddingBottom")
            );
          })
        )
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionMidpoint));
  const conditionalMotionMid = await window.webContents.executeJavaScript(`(() => ({
    scopeHeight: document.querySelector("#scope-step").getBoundingClientRect().height,
    measureHeight: document.querySelector("#measure-step").getBoundingClientRect().height,
    scopeSlotHeight: document.querySelector("#scope-motion-slot").getBoundingClientRect().height,
    scopeStillAnimating: document.querySelector("#scope-motion-slot").getAnimations().some(
      (animation) => animation.playState === "running"
    ),
    measureStillAnimating: document.querySelector("#country-measure-slot").getAnimations().some(
      (animation) => animation.playState === "running"
    )
  }))()`);
  await capture(window, "android-layout-conditional-motion-mid.png");
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay - motionMidpoint));
  const conditionalMotionEnd = await window.webContents.executeJavaScript(`(() => ({
    finalScopeHeight: document.querySelector("#scope-step").getBoundingClientRect().height,
    finalMeasureHeight: document.querySelector("#measure-step").getBoundingClientRect().height,
    finalScopeSlotHeight: document.querySelector("#scope-motion-slot").getBoundingClientRect().height,
    countryVisible: !document.querySelector("#country-scope-summary").hidden,
    countyHidden: document.querySelector(".county-scope-control").hidden,
    frequencyVisible: !document.querySelector("#frequency").closest(".field").hidden,
    scopeTrackClean: document.querySelector("#scope-motion-slot").getAnimations().length === 0,
    measureTrackClean: document.querySelector("#country-measure-slot").getAnimations().length === 0
  }))()`);

  const quarterlyOpenStart = await window.webContents.executeJavaScript(`(() => {
    const frequency = document.querySelector("#frequency");
    const slot = document.querySelector("#quarterly-motion-slot");
    frequency.value = "Q";
    frequency.dispatchEvent(new Event("change", { bubbles: true }));
    const animation = slot.getAnimations()[0];
    const frames = animation?.effect.getKeyframes() ?? [];
    return {
      duration: animation?.effect.getTiming().duration ?? 0,
      startsAtZero: slot.getBoundingClientRect().height <= 1,
      usesPhysicalTrack:
        frames.length === 2
        && frames.every(
          (frame) =>
            typeof frame.height === "string"
            && !Object.hasOwn(frame, "opacity")
            && !Object.hasOwn(frame, "transform")
        )
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay));
  const quarterlyCloseStart = await window.webContents.executeJavaScript(`(() => {
    const frequency = document.querySelector("#frequency");
    const slot = document.querySelector("#quarterly-motion-slot");
    const field = document.querySelector("#quarterly-mode-field");
    frequency.value = "A";
    frequency.dispatchEvent(new Event("change", { bubbles: true }));
    const animation = slot.getAnimations()[0];
    return {
      duration: animation?.effect.getTiming().duration ?? 0,
      contentRetainedDuringClose: !field.hidden,
      startsExpanded: slot.getBoundingClientRect().height > 1
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, motionSettleDelay));
  const rapidSwitch = await window.webContents.executeJavaScript(`(async () => {
    const geography = document.querySelector("#geography-level");
    geography.value = "state";
    geography.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    geography.value = "county";
    geography.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    geography.value = "state";
    geography.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, ${motionSettleDelay}));
    const slot = document.querySelector("#scope-motion-slot");
    return {
      finalLevel: geography.value,
      countyControlHidden: document.querySelector(".county-scope-control").hidden,
      searchVisible: !document.querySelector(".metro-search-block").hidden,
      countrySummaryHidden: document.querySelector("#country-scope-summary").hidden,
      noStaleTrackAnimation: slot.getAnimations().length === 0,
      noInlineTrackGeometry:
        !slot.style.height
        && !slot.style.marginTop
        && !slot.style.overflow
    };
  })()`);
  const conditionalContentMotion = {
    cardResizesProgressively:
      conditionalMotionMid.scopeStillAnimating
      && conditionalMotionMid.measureStillAnimating
      && Math.abs(
        conditionalMotionMid.scopeHeight - conditionalMotionStart.initialScopeHeight
      ) > 1
      && Math.abs(
        conditionalMotionMid.scopeHeight - conditionalMotionEnd.finalScopeHeight
      ) > 1
      && Math.abs(
        conditionalMotionMid.measureHeight - conditionalMotionStart.initialMeasureHeight
      ) > 1
      && Math.abs(
        conditionalMotionMid.measureHeight - conditionalMotionEnd.finalMeasureHeight
      ) > 1,
    visibilityStateSettles:
      conditionalMotionEnd.countryVisible
      && conditionalMotionEnd.countyHidden
      && conditionalMotionEnd.frequencyVisible
      && conditionalMotionEnd.scopeTrackClean
      && conditionalMotionEnd.measureTrackClean,
    onePhysicalTrackPerSection:
      conditionalMotionStart.scopeUsesPhysicalTrack
      && conditionalMotionStart.measureUsesPhysicalTrack
      && conditionalMotionStart.descendantsDoNotAnimateLayout,
    usesDirectionalDurations:
      conditionalMotionStart.scopeDuration === closeMotionDuration
      && conditionalMotionStart.measureDuration === motionDuration
      && quarterlyOpenStart.duration === motionDuration
      && quarterlyCloseStart.duration === closeMotionDuration,
    quarterlyDrawerKeepsContentDuringClose:
      quarterlyOpenStart.startsAtZero
      && quarterlyOpenStart.usesPhysicalTrack
      && quarterlyCloseStart.startsExpanded
      && quarterlyCloseStart.contentRetainedDuringClose,
    rapidChangesAreInterruptible:
      rapidSwitch.finalLevel === "state"
      && rapidSwitch.countyControlHidden
      && rapidSwitch.searchVisible
      && rapidSwitch.countrySummaryHidden
      && rapidSwitch.noStaleTrackAnimation
      && rapidSwitch.noInlineTrackGeometry,
    diagnostics: {
      start: conditionalMotionStart,
      mid: conditionalMotionMid,
      end: conditionalMotionEnd,
    },
  };

  await window.webContents.executeJavaScript(
    `document.querySelector("#mobile-settings-button").click()`,
  );
  const settings = await window.webContents.executeJavaScript(`(() => ({
    activeView: document.querySelector(".app-view.is-active")?.dataset.view,
    noHorizontalOverflow:
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    appearanceVisible:
      document.querySelector("#settings-theme-slot .theme-control") !== null,
    saveLocationVisible:
      document.querySelector("#save-location-button")?.getBoundingClientRect().height >= 48,
    settingsGroupGeometry: [...document.querySelectorAll(".settings-group")].map(
      (group) => ({
        radius: getComputedStyle(group).borderTopLeftRadius,
        shape: getComputedStyle(group).cornerShape
      })
    ),
    settingsGroupsRounded4xl: [...document.querySelectorAll(".settings-group")].every(
      (group) =>
        getComputedStyle(group).borderTopLeftRadius === "32px"
        && getComputedStyle(group).cornerShape !== "squircle"
    ),
    settingsOptionsRoundedFull: [...document.querySelectorAll(".settings-row")].every(
      (row) => getComputedStyle(row).borderTopLeftRadius === "999px"
    ),
    noDownwardGlow: (() => {
      const isInsetOnly = (element) => {
        const shadow = getComputedStyle(element).boxShadow;
        return shadow === "none" || shadow.endsWith("inset");
      };
      return [
        ...document.querySelectorAll(".settings-group"),
        ...document.querySelectorAll(".settings-row"),
        ...document.querySelectorAll(".theme-control"),
        ...document.querySelectorAll(".theme-control .is-selected"),
        document.querySelector("#mobile-settings-button")
      ].filter(Boolean).every(isInsetOnly);
    })()
  }))()`);
  await capture(window, "android-layout-settings.png");

  await window.webContents.executeJavaScript(
    `document.querySelector('.mobile-settings-page [data-view-target="data-sources"]').click()`,
  );
  const sources = await window.webContents.executeJavaScript(`(() => {
    const lineage = document.querySelector(".source-lineage");
    const articles = [...lineage.querySelectorAll("article")];
    return {
      activeView: document.querySelector(".app-view.is-active")?.dataset.view,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      numbersHidden: articles.every(
        (article) => getComputedStyle(article.querySelector(":scope > span")).display === "none"
      ),
      frameHidden:
        parseFloat(getComputedStyle(lineage).borderTopWidth) === 0 &&
        articles.every((article) => parseFloat(getComputedStyle(article).borderRightWidth) === 0),
      columnsContained: articles.every(
        (article) => article.scrollWidth <= article.clientWidth + 1
      )
    };
  })()`);
  await capture(window, "android-layout-data-sources.png");

  const distHtml = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
  const androidMain = fs.readFileSync(
    path.join(
      root,
      "android",
      "app",
      "src",
      "main",
      "java",
      "org",
      "metrostudio",
      "app",
      "MainActivity.java",
    ),
    "utf8",
  );
  const mainSource = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  const startup = {
    androidClassPresentOnLoad: await window.webContents.executeJavaScript(
      `document.documentElement.classList.contains("is-android")`,
    ),
    androidFirstPaintGuardInBundle:
      distHtml.includes('classList.add("is-android")')
      && distHtml.includes("\\bAndroid\\b"),
    pinchZoomDisabled:
      distHtml.includes("maximum-scale=1.0")
      && distHtml.includes("user-scalable=no")
      && androidMain.includes("setSupportZoom(false)")
      && androidMain.includes("setBuiltInZoomControls(false)")
      && androidMain.includes("setDisplayZoomControls(false)"),
  };
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-view-target="home"]')?.click()`,
  );
  const preview = await window.webContents.executeJavaScript(`(() => ({
    headerRemoved: getComputedStyle(document.querySelector(".preview-header-card")).display === "none",
    switcherRemoved: getComputedStyle(document.querySelector(".preview-tabs")).display === "none",
    optionsRemoved: getComputedStyle(document.querySelector("#preview-options-button")).display === "none",
    resultsTitleVisible:
      getComputedStyle(document.querySelector(".android-results-title")).display !== "none"
      && document.querySelector(".android-results-title").textContent.trim() === "Results",
    tableRemoved:
      getComputedStyle(document.querySelector("#table-panel")).display === "none",
    metadataRemoved:
      getComputedStyle(document.querySelector("#metadata-panel")).display === "none",
    resultDetailsRemoved:
      getComputedStyle(document.querySelector(".result-summary-strip")).display === "none"
      && getComputedStyle(document.querySelector(".result-note")).display === "none",
    emptyDecorationsRemoved:
      document.querySelector(".empty-state-icon") === null
      && document.querySelector(".empty-state-map") === null
      && document.querySelector("#empty-state .status-badge") === null,
    resultScopeReady: (() => {
      const overview = document.querySelector(".android-result-overview");
      return getComputedStyle(overview).display === "grid"
        && overview.querySelector("h3")?.id === "android-result-scope"
        && overview.querySelector("p")?.textContent.trim()
          === "Export the Excel workbook to view the complete results.";
    })(),
    resultCardRounded4xl:
      getComputedStyle(document.querySelector(".preview-body")).borderTopLeftRadius === "32px",
    exportRoundedAndExtended: (() => {
      const button = document.querySelector("#export-button");
      return getComputedStyle(button).borderTopLeftRadius === "999px"
        && button.getBoundingClientRect().width >= 168;
    })()
  }))()`);
  await window.webContents.executeJavaScript(
    `document.querySelector(".preview-inspector").scrollIntoView({ block: "start" })`,
  );
  await capture(window, "android-layout-preview.png");
  const successResult = await window.webContents.executeJavaScript(`(() => {
    document.body.dataset.status = "success";
    document.querySelector("#empty-state").hidden = true;
    document.querySelector("#success-state").hidden = false;
    document.querySelector("#android-result-scope").textContent =
      "New York-Newark-Jersey City, NY-NJ";
    const overview = document.querySelector(".android-result-overview");
    return {
      scopeVisible:
        getComputedStyle(overview).display === "grid"
        && overview.getBoundingClientRect().height > 0,
      sampleNameVisible:
        overview.querySelector("h3").textContent.trim()
          === "New York-Newark-Jersey City, NY-NJ",
      exportPromptVisible:
        overview.querySelector("p").textContent.trim()
          === "Export the Excel workbook to view the complete results.",
      tableStillRemoved:
        getComputedStyle(document.querySelector("#table-panel")).display === "none",
      metadataStillRemoved:
        getComputedStyle(document.querySelector("#metadata-panel")).display === "none",
    };
  })()`);
  await capture(window, "android-layout-result-success.png");
  const previewPolicy = {
    countyDetailsAlwaysIncluded:
      !distHtml.includes("include-county-sheet")
      && !mainSource.includes("includeCountySheet")
      && mainSource.includes('book_append_sheet(workbook, countySheet, "Metro Area County Data")'),
    resultScopeLabelsPresent:
      mainSource.includes("All Metropolitan Statistical Areas")
      && mainSource.includes("All Combined Statistical Areas")
      && mainSource.includes("All Metropolitan and Combined Statistical Areas"),
  };
  await window.webContents.executeJavaScript(
    `document.querySelector('[data-view-target="license"]').click()`,
  );
  const infoFrames = await window.webContents.executeJavaScript(`(() => ({
    rounded3xl: [...document.querySelectorAll(".info-page-content")].every((frame) => {
      const style = getComputedStyle(frame);
      return style.borderTopLeftRadius === "24px" && style.cornerShape === "round";
    })
  }))()`);
  const report = {
    startup,
    home,
    searchResults,
    selectMenu,
    areaFilterMotion,
    selectedDrawerMotion,
    conditionalContentMotion,
    allSelection,
    singleSelection,
    settings,
    sources,
    preview,
    successResult,
    previewPolicy,
    infoFrames,
  };
  fs.writeFileSync(
    path.join(artifacts, "android-layout-audit.json"),
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (
    Object.values(startup).includes(false)
    || Object.values(home).includes(false)
    || Object.values(searchResults).includes(false)
    || Object.values(selectMenu).includes(false)
    || Object.values(areaFilterMotion).includes(false)
    || Object.values(selectedDrawerMotion).includes(false)
    || Object.values(conditionalContentMotion).includes(false)
    || Object.values(allSelection).includes(false)
    || Object.values(singleSelection).includes(false)
    || Object.values(settings).includes(false)
    || Object.values(sources).includes(false)
    || Object.values(preview).includes(false)
    || Object.values(successResult).includes(false)
    || Object.values(previewPolicy).includes(false)
    || Object.values(infoFrames).includes(false)
    || settings.activeView !== "settings"
    || sources.activeView !== "data-sources"
  ) {
    process.exitCode = 1;
  }
  window.destroy();
  app.quit();
});
