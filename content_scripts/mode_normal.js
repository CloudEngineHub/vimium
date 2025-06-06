class NormalMode extends KeyHandlerMode {
  init(options) {
    if (options == null) {
      options = {};
    }

    const defaults = {
      name: "normal",
      indicator: false, // There is normally no mode indicator in normal mode.
      commandHandler: this.commandHandler.bind(this),
    };

    super.init(Object.assign(defaults, options));

    chrome.storage.session.get(
      "normalModeKeyStateMapping",
      (items) => this.setKeyMapping(items.normalModeKeyStateMapping),
    );

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && changes.normalModeKeyStateMapping?.newValue) {
        this.setKeyMapping(changes.normalModeKeyStateMapping.newValue);
      }
    });
  }

  commandHandler({ command: registryEntry, count }) {
    if (registryEntry.options.count) {
      count = (count ?? 1) * registryEntry.options.count;
    }

    // closeTabsOnLeft and closeTabsOnRight interpret a null count as "close all tabs in
    // {direction}", so don't default the count to 1 for those commands. See #4296.
    const allowNullCount = ["closeTabsOnLeft", "closeTabsOnRight"].includes(registryEntry.command);
    if (!allowNullCount && count == null) {
      count = 1;
    }

    if (registryEntry.noRepeat && count) {
      count = 1;
    }

    if ((registryEntry.repeatLimit != null) && (registryEntry.repeatLimit < count)) {
      const result = confirm(
        `You have asked Vimium to perform ${count} repetitions of the ` +
          `command "${registryEntry.command}". Are you sure you want to continue?`,
      );
      if (!result) return;
    }

    if (registryEntry.topFrame) {
      // We never return to a UI-component frame (e.g. the help dialog), it might have lost the
      // focus.
      const sourceFrameId = globalThis.isVimiumUIComponent ? 0 : frameId;
      chrome.runtime.sendMessage({
        handler: "sendMessageToFrames",
        message: { handler: "runInTopFrame", sourceFrameId, registryEntry },
      });
    } else if (registryEntry.background) {
      chrome.runtime.sendMessage({ handler: "runBackgroundCommand", registryEntry, count });
    } else {
      const commandFn = NormalModeCommands[registryEntry.command];
      commandFn(count, { registryEntry });
    }
  }
}

const enterNormalMode = function (count) {
  const mode = new NormalMode();
  mode.init({
    indicator: "Normal mode (pass keys disabled)",
    exitOnEscape: true,
    singleton: "enterNormalMode",
    count,
  });
  return mode;
};

function findSelectedHelper(backwards) {
  const selection = window.getSelection().toString();
  if (!selection) return;
  FindMode.updateQuery(selection);
  FindMode.saveQuery();
  FindMode.findNext(backwards);
}

const NormalModeCommands = {
  // Scrolling.
  scrollToBottom() {
    Marks.setPreviousPosition();
    Scroller.scrollTo("y", "max");
  },
  scrollToTop(count) {
    Marks.setPreviousPosition();
    Scroller.scrollTo("y", (count - 1) * Settings.get("scrollStepSize"));
  },
  scrollToLeft() {
    Scroller.scrollTo("x", 0);
  },
  scrollToRight() {
    Scroller.scrollTo("x", "max");
  },
  scrollUp(count) {
    Scroller.scrollBy("y", -1 * Settings.get("scrollStepSize") * count);
  },
  scrollDown(count) {
    Scroller.scrollBy("y", Settings.get("scrollStepSize") * count);
  },
  scrollPageUp(count) {
    Scroller.scrollBy("y", "viewSize", (-1 / 2) * count);
  },
  scrollPageDown(count) {
    Scroller.scrollBy("y", "viewSize", (1 / 2) * count);
  },
  scrollFullPageUp(count) {
    Scroller.scrollBy("y", "viewSize", -1 * count);
  },
  scrollFullPageDown(count) {
    Scroller.scrollBy("y", "viewSize", 1 * count);
  },
  scrollLeft(count) {
    Scroller.scrollBy("x", -1 * Settings.get("scrollStepSize") * count);
  },
  scrollRight(count) {
    Scroller.scrollBy("x", Settings.get("scrollStepSize") * count);
  },

  // Tab navigation: back, forward.
  goBack(count) {
    history.go(-count);
  },
  goForward(count) {
    history.go(count);
  },

  // Url manipulation.
  goUp(count) {
    let url = globalThis.location.href;
    if (url.endsWith("/")) {
      url = url.substring(0, url.length - 1);
    }

    let urlsplit = url.split("/");
    // make sure we haven't hit the base domain yet
    if (urlsplit.length > 3) {
      urlsplit = urlsplit.slice(0, Math.max(3, urlsplit.length - count));
      globalThis.location.href = urlsplit.join("/");
    }
  },

  goToRoot() {
    globalThis.location.href = globalThis.location.origin;
  },

  toggleViewSource() {
    chrome.runtime.sendMessage({ handler: "getCurrentTabUrl" }, function (url) {
      if (url.substr(0, 12) === "view-source:") {
        url = url.substr(12, url.length - 12);
      } else {
        url = "view-source:" + url;
      }
      chrome.runtime.sendMessage({ handler: "openUrlInNewTab", url });
    });
  },

  copyCurrentUrl() {
    chrome.runtime.sendMessage({ handler: "getCurrentTabUrl" }, function (url) {
      HUD.copyToClipboard(url);
      // This length is determined empirically based on a 350px width of the HUD. An alternate
      // solution is to have the HUD ellipsize based on its width.
      const maxLength = 40;
      if (url.length > maxLength) {
        url = url.slice(0, maxLength - 2) + "...";
      }
      HUD.show(`Yanked ${url}`, 2000);
    });
  },

  openCopiedUrlInNewTab(count, request) {
    HUD.pasteFromClipboard((url) =>
      chrome.runtime.sendMessage({
        handler: "openUrlInNewTab",
        position: request.registryEntry.options.position,
        url,
        count,
      })
    );
  },

  openCopiedUrlInCurrentTab() {
    HUD.pasteFromClipboard((url) =>
      chrome.runtime.sendMessage({ handler: "openUrlInCurrentTab", url })
    );
  },

  // Mode changes.
  enterInsertMode() {
    // If a focusable element receives the focus, then we exit and leave the permanently-installed
    // insert-mode instance to take over.
    return new InsertMode({ global: true, exitOnFocus: true });
  },

  enterVisualMode() {
    const mode = new VisualMode();
    mode.init({ userLaunchedMode: true });
    return mode;
  },

  enterVisualLineMode() {
    const mode = new VisualLineMode();
    mode.init({ userLaunchedMode: true });
    return mode;
  },

  enterFindMode() {
    Marks.setPreviousPosition();
    return new FindMode();
  },

  // Find.
  performFind(count) {
    for (let i = 0, end = count; i < end; i++) {
      FindMode.findNext(false);
    }
  },

  performBackwardsFind(count) {
    for (let i = 0, end = count; i < end; i++) {
      FindMode.findNext(true);
    }
  },

  findSelected() {
    findSelectedHelper(false);
  },

  findSelectedBackwards() {
    findSelectedHelper(true);
  },

  // Misc.
  mainFrame() {
    return focusThisFrame({ highlight: true, forceFocusThisFrame: true });
  },
  showHelp(sourceFrameId) {
    return HelpDialog.toggle({ sourceFrameId });
  },

  passNextKey(count, options) {
    // TODO(philc): OK to remove return statement?
    if (options.registryEntry.options.normal) {
      return enterNormalMode(count);
    } else {
      return new PassNextKeyMode(count);
    }
  },

  goPrevious() {
    const previousPatterns = Settings.get("previousPatterns") || "";
    const previousStrings = previousPatterns.split(",").filter((s) => s.trim().length);
    const target = findElementWithRelValue("prev") || findLink(previousStrings);
    if (target) followLink(target);
  },

  goNext() {
    const nextPatterns = Settings.get("nextPatterns") || "";
    const nextStrings = nextPatterns.split(",").filter((s) => s.trim().length);
    const target = findElementWithRelValue("next") || findLink(nextStrings);
    if (target) followLink(target);
  },

  focusInput(count) {
    // Focus the first input element on the page, and create overlays to highlight all the input
    // elements, with the currently-focused element highlighted specially. Tabbing will shift focus
    // to the next input element. Pressing any other key will remove the overlays and the special
    // tab behavior.
    let element, selectedInputIndex;
    const resultSet = DomUtils.evaluateXPath(
      textInputXPath,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    );
    const visibleInputs = [];

    for (let i = 0, end = resultSet.snapshotLength; i < end; i++) {
      element = resultSet.snapshotItem(i);
      if (!DomUtils.getVisibleClientRect(element, true)) {
        continue;
      }
      visibleInputs.push({ element, index: i, rect: Rect.copy(element.getBoundingClientRect()) });
    }

    visibleInputs.sort(
      function ({ element: element1, index: i1 }, { element: element2, index: i2 }) {
        // Put elements with a lower positive tabIndex first, keeping elements in DOM order.
        if (element1.tabIndex > 0) {
          if (element2.tabIndex > 0) {
            const tabDifference = element1.tabIndex - element2.tabIndex;
            if (tabDifference !== 0) {
              return tabDifference;
            } else {
              return i1 - i2;
            }
          } else {
            return -1;
          }
        } else if (element2.tabIndex > 0) {
          return 1;
        } else {
          return i1 - i2;
        }
      },
    );

    if (visibleInputs.length === 0) {
      HUD.show("There are no inputs to focus.", 1000);
      return;
    }

    // This is a hack to improve usability on the Vimium options page. We prime the recently-focused
    // input to be the key-mappings input. Arguably, this is the input that the user is most likely
    // to use.
    const recentlyFocusedElement = lastFocusedInput();

    if (count === 1) {
      // As the starting index, we pick that of the most recently focused input element (or 0).
      const elements = visibleInputs.map((visibleInput) => visibleInput.element);
      selectedInputIndex = Math.max(0, elements.indexOf(recentlyFocusedElement));
    } else {
      selectedInputIndex = Math.min(count, visibleInputs.length) - 1;
    }

    const hints = visibleInputs.map((tuple) => {
      const hint = DomUtils.createElement("div");
      hint.className = "vimium-reset internal-vimium-input-hint vimiumInputHint";

      // minus 1 for the border
      hint.style.left = (tuple.rect.left - 1) + globalThis.scrollX + "px";
      hint.style.top = (tuple.rect.top - 1) + globalThis.scrollY + "px";
      hint.style.width = tuple.rect.width + "px";
      hint.style.height = tuple.rect.height + "px";

      return hint;
    });

    return new FocusSelector(hints, visibleInputs, selectedInputIndex);
  },

  "LinkHints.activateMode": LinkHints.activateMode.bind(LinkHints),
  "LinkHints.activateModeToOpenInNewTab": LinkHints.activateModeToOpenInNewTab.bind(LinkHints),
  "LinkHints.activateModeToOpenInNewForegroundTab": LinkHints.activateModeToOpenInNewForegroundTab
    .bind(LinkHints),
  "LinkHints.activateModeWithQueue": LinkHints.activateModeWithQueue.bind(LinkHints),
  "LinkHints.activateModeToOpenIncognito": LinkHints.activateModeToOpenIncognito.bind(LinkHints),
  "LinkHints.activateModeToDownloadLink": LinkHints.activateModeToDownloadLink.bind(LinkHints),
  "LinkHints.activateModeToCopyLinkUrl": LinkHints.activateModeToCopyLinkUrl.bind(LinkHints),

  "Vomnibar.activate": Vomnibar.activate.bind(Vomnibar),
  "Vomnibar.activateInNewTab": Vomnibar.activateInNewTab.bind(Vomnibar),
  "Vomnibar.activateTabSelection": Vomnibar.activateTabSelection.bind(Vomnibar),
  "Vomnibar.activateBookmarks": Vomnibar.activateBookmarks.bind(Vomnibar),
  "Vomnibar.activateBookmarksInNewTab": Vomnibar.activateBookmarksInNewTab.bind(Vomnibar),
  "Vomnibar.activateEditUrl": Vomnibar.activateEditUrl.bind(Vomnibar),
  "Vomnibar.activateEditUrlInNewTab": Vomnibar.activateEditUrlInNewTab.bind(Vomnibar),

  "Marks.activateCreateMode": Marks.activateCreateMode.bind(Marks),
  "Marks.activateGotoMode": Marks.activateGotoMode.bind(Marks),
};

// The types in <input type="..."> that we consider for focusInput command. Right now this is
// recalculated in each content script. Alternatively we could calculate it once in the background
// page and use a request to fetch it each time.
// Should we include the HTML5 date pickers here?

// The corresponding XPath for such elements.
const textInputXPath = (function () {
  const textInputTypes = ["text", "search", "email", "url", "number", "password", "date", "tel"];
  const inputElements = [
    "input[" +
    "(" + textInputTypes.map((type) => '@type="' + type + '"').join(" or ") + "or not(@type))" +
    " and not(@disabled or @readonly)]",
    "textarea",
    "*[@contenteditable='' or translate(@contenteditable, 'TRUE', 'true')='true']",
  ];
  if (typeof DomUtils !== "undefined" && DomUtils !== null) {
    return DomUtils.makeXPath(inputElements);
  }
})();

// used by the findAndFollow* functions.
const followLink = function (linkElement) {
  if (linkElement.nodeName.toLowerCase() === "link") {
    globalThis.location.href = linkElement.href;
  } else {
    // if we can click on it, don't simply set location.href: some next/prev links are meant to
    // trigger AJAX calls, like the 'more' button on GitHub's newsfeed.
    linkElement.scrollIntoView();
    DomUtils.simulateClick(linkElement);
  }
};

// Find links which have text matching any one of `linkStrings`. If there are multiple candidates,
// they are prioritized for shortness, by their position in `linkStrings`, how far down the page
// they are located, and finally by whether the match is exact. Practically speaking, this means we
// favor 'next page' over 'the next big thing', and 'more' over 'nextcompany', even if 'next' occurs
// before 'more' in `linkStrings`.
function findLink(linkStrings) {
  const linksXPath = DomUtils.makeXPath([
    "a",
    "*[@onclick or @role='link' or contains(@class, 'button')]",
  ]);
  const links = DomUtils.evaluateXPath(linksXPath, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
  let candidateLinks = [];

  // At the end of this loop, candidateLinks will contain all visible links that match our patterns
  // links lower in the page are more likely to be the ones we want, so we loop through the snapshot
  // backwards.
  for (let i = links.snapshotLength - 1; i >= 0; i--) {
    const link = links.snapshotItem(i);

    // NOTE(philc): We used to enforce the bounding client rect on the link had nonzero width and
    // height. However, that's not a valid requirement. If an anchor tag has a single floated span
    // as a child, the anchor is still clickable even though it appears to have zero height. This is
    // the case with Google Search's "next" links as of 2025-06. See #4650.

    const computedStyle = globalThis.getComputedStyle(link, null);
    const isHidden = computedStyle.getPropertyValue("visibility") != "visible" ||
      computedStyle.getPropertyValue("display") == "none";
    if (isHidden) continue;

    let linkMatches = false;
    for (const linkString of linkStrings) {
      // SVG elements can have a null innerText.
      const matches = link.innerText?.toLowerCase().includes(linkString) ||
        link.value?.includes?.(linkString) ||
        link.getAttribute("title")?.toLowerCase().includes(linkString) ||
        link.getAttribute("aria-label")?.toLowerCase().includes(linkString);
      if (matches) {
        linkMatches = true;
        break;
      }
    }

    if (!linkMatches) continue;

    candidateLinks.push(link);
  }

  if (candidateLinks.length == 0) return;

  for (const link of candidateLinks) {
    link.wordCount = link.innerText.trim().split(/\s+/).length;
  }

  // We can use this trick to ensure that Array.sort is stable. We need this property to retain the
  // reverse in-page order of the links.

  candidateLinks.forEach((a, i) => a.originalIndex = i);

  // favor shorter links, and ignore those that are more than one word longer than the shortest link
  candidateLinks = candidateLinks
    .sort(function (a, b) {
      if (a.wordCount === b.wordCount) {
        return a.originalIndex - b.originalIndex;
      } else {
        return a.wordCount - b.wordCount;
      }
    })
    .filter((a) => a.wordCount <= (candidateLinks[0].wordCount + 1));

  for (const linkString of linkStrings) {
    const exactWordRegex = /\b/.test(linkString[0]) || /\b/.test(linkString[linkString.length - 1])
      ? new RegExp("\\b" + linkString + "\\b", "i")
      : new RegExp(linkString, "i");
    for (const candidateLink of candidateLinks) {
      if (
        candidateLink.innerText.match(exactWordRegex) ||
        candidateLink.value?.match(exactWordRegex) ||
        candidateLink.getAttribute("title")?.match(exactWordRegex) ||
        candidateLink.getAttribute("aria-label")?.match(exactWordRegex)
      ) {
        return candidateLink;
      }
    }
  }
}

function findElementWithRelValue(value) {
  const relTags = ["link", "a", "area"];
  for (const tag of relTags) {
    const els = document.getElementsByTagName(tag);
    for (const el of Array.from(els)) {
      if (el.hasAttribute("rel") && (el.rel.toLowerCase() === value)) {
        return el;
      }
    }
  }
}

class FocusSelector extends Mode {
  constructor(hints, visibleInputs, selectedInputIndex) {
    super(...arguments);
    super.init({
      name: "focus-selector",
      exitOnClick: true,
      keydown: (event) => {
        if (event.key === "Tab") {
          hints[selectedInputIndex].classList.remove("internal-vimium-selected-input-hint");
          selectedInputIndex += hints.length + (event.shiftKey ? -1 : 1);
          selectedInputIndex %= hints.length;
          hints[selectedInputIndex].classList.add("internal-vimium-selected-input-hint");
          DomUtils.simulateSelect(visibleInputs[selectedInputIndex].element);
          return this.suppressEvent;
        } else if (event.key !== "Shift") {
          this.exit();
          // Give the new mode the opportunity to handle the event.
          return this.restartBubbling;
        }
      },
    });

    const div = DomUtils.createElement("div");
    div.id = "vimiumInputMarkerContainer";
    div.className = "vimium-reset";
    for (const el of hints) {
      div.appendChild(el);
    }
    this.hintContainerEl = div;
    document.documentElement.appendChild(div);

    DomUtils.simulateSelect(visibleInputs[selectedInputIndex].element);
    if (visibleInputs.length === 1) {
      this.exit();
      return;
    } else {
      hints[selectedInputIndex].classList.add("internal-vimium-selected-input-hint");
    }
  }

  exit() {
    super.exit();
    DomUtils.removeElement(this.hintContainerEl);
    if (document.activeElement && DomUtils.isEditable(document.activeElement)) {
      return new InsertMode({
        singleton: "post-find-mode/focus-input",
        targetElement: document.activeElement,
        indicator: false,
      });
    }
  }
}

globalThis.NormalMode = NormalMode;
globalThis.NormalModeCommands = NormalModeCommands;
