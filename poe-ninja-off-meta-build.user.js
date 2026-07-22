// ==UserScript==
// @name         poe.ninja Off-meta Build Randomizer
// @namespace    poe-ninja-off-meta-build
// @version      1.0.0
// @description  Pick a random off-meta Main Skill from poe.ninja's build page.
// @author       spooee
// @icon         https://poe.ninja/shared-assets/ninja-logo.png
// @match        https://poe.ninja/poe1/builds/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const leagueRoute = location.pathname.match(/^\/poe1\/builds\/([^/]+)/);
  const LIST_PATH = leagueRoute ? `/poe1/builds/${leagueRoute[1]}` : null;
  const STORAGE_KEY = "poe-ninja-off-meta-build-settings-v1";
  const PENDING_KEY = "poe-ninja-off-meta-build-pending-v1";
  const ROOT_ID = "pn-ubr-root";
  const STYLE_ID = "pn-ubr-style";
  // only show up on league build lists
  const IS_BUILD_LIST_PAGE = Boolean(
    LIST_PATH && location.pathname.replace(/\/$/, "") === LIST_PATH,
  );
  // base classes aren't ascendancies, so we exclude them
  const BASE_CLASSES = new Set([
    "Ranger",
    "Duelist",
    "Scion",
    "Witch",
    "Marauder",
    "Templar",
    "Shadow",
  ]);

  if (!IS_BUILD_LIST_PAGE) return;

  // general helpers

  const sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));

  // pick one candidate without Math.random bias
  function randomItem(items) {
    if (!items.length) return null;
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return items[values[0] % items.length];
  }

  // wait for poe.ninja's React UI to catch up
  async function waitFor(getValue, timeout = 20_000, interval = 100) {
    const deadline = Date.now() + timeout;
    let lastError;

    while (Date.now() < deadline) {
      try {
        const value = getValue();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await sleep(interval);
    }

    if (lastError) throw lastError;
    throw new Error("Timed out waiting for poe.ninja to update the page.");
  }

  function showError(container, error) {
    container.replaceChildren();
    const message = document.createElement("span");
    message.className = "pn-ubr-error";
    message.textContent =
      error instanceof Error ? error.message : String(error);
    container.append(message);
  }

  function findSection(title) {
    const heading = [...document.querySelectorAll("h1,h2,h3")].find(
      (element) => element.textContent.trim() === title,
    );
    return heading?.closest("section") || null;
  }

  // read the "Found X characters" total from the page
  function getFoundCount() {
    const match = document.body?.innerText.match(
      /Found\s+([\d,.]+)\s+characters?\./i,
    );
    return match ? Number(match[1].replace(/[^\d]/g, "")) : null;
  }

  // level filtering

  function getLevelFilters() {
    // grab poe.ninja's min/max level dropdowns
    const levelHeader = [...document.querySelectorAll("table thead th")].find(
      (header) => {
        const heading = header.querySelector("button")?.textContent.trim();
        return (
          heading === "Level" && header.querySelectorAll("select").length >= 2
        );
      },
    );
    const [minimum, maximum] = levelHeader?.querySelectorAll("select") || [];

    return minimum && maximum ? { minimum, maximum } : null;
  }

  async function configureMinimumLevelInput(input, preferredLevel) {
    // fetch min level from poe.ninja for the selected league
    const { minimum } = await waitFor(getLevelFilters);
    const pageMinimum = Math.min(
      ...[...minimum.options].map((option) => Number(option.value)),
    );

    if (!Number.isFinite(pageMinimum)) {
      throw new Error("Could not read poe.ninja's minimum character level.");
    }

    const savedLevel = Number(preferredLevel);
    const selectedLevel = Number.isInteger(savedLevel)
      ? Math.min(100, Math.max(pageMinimum, savedLevel))
      : pageMinimum;

    input.min = String(pageMinimum);
    input.value = String(selectedLevel);
    input.disabled = false;
    return pageMinimum;
  }

  // trigger poe.ninja's own dropdown change handler
  function setSelectValue(select, value) {
    const serializedValue = String(value);
    if (
      ![...select.options].some((option) => option.value === serializedValue)
    ) {
      throw new Error(
        `poe.ninja's Level filter does not offer level ${value}.`,
      );
    }

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    if (valueSetter) valueSetter.call(select, serializedValue);
    else select.value = serializedValue;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // make sure the level filter reached the visible rows
  function getRenderedCharacterLevels() {
    return [...document.querySelectorAll("table tbody tr")]
      .filter((row) => row.querySelector('a[href*="/character/"]'))
      .map((row) =>
        Number.parseInt(row.querySelectorAll("td")[1]?.textContent || "", 10),
      )
      .filter(Number.isFinite);
  }

  async function applyMinimumLevelFilter(minimumLevel) {
    // make poe.ninja filter the character list before rolling
    let filters = await waitFor(getLevelFilters);
    const pageMaximum = Math.max(
      ...[...filters.maximum.options].map((option) => Number(option.value)),
    );

    if (!Number.isFinite(pageMaximum) || pageMaximum < minimumLevel) {
      throw new Error(
        `poe.ninja's Level filter cannot include level ${minimumLevel}.`,
      );
    }

    if (Number(filters.maximum.value) !== pageMaximum) {
      setSelectValue(filters.maximum, pageMaximum);
      filters = await waitFor(() => {
        const current = getLevelFilters();
        return current && Number(current.maximum.value) === pageMaximum
          ? current
          : null;
      });
    }

    filters = await waitFor(() => {
      const current = getLevelFilters();
      return current &&
        [...current.minimum.options].some(
          (option) => Number(option.value) === minimumLevel,
        )
        ? current
        : null;
    });

    if (Number(filters.minimum.value) !== minimumLevel) {
      setSelectValue(filters.minimum, minimumLevel);
      await waitFor(() => {
        const current = getLevelFilters();
        return current && Number(current.minimum.value) === minimumLevel
          ? current
          : null;
      });
      await sleep(350);
    }

    await waitFor(() => {
      const current = getLevelFilters();
      const foundCount = getFoundCount();
      const levels = getRenderedCharacterLevels();
      return current &&
        Number(current.minimum.value) === minimumLevel &&
        foundCount !== null &&
        levels.every((level) => level >= minimumLevel)
        ? { foundCount }
        : null;
    });
  }

  // ascendancies

  function getRenderedAscendancies() {
    // grab ascendancies from the cards at the top of the page
    return [
      ...new Set(
        [...document.querySelectorAll(".class-name")]
          .map((element) => element.textContent.trim())
          .filter((name) => name && !BASE_CLASSES.has(name)),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }

  // fill our dropdown with actual ascendancies only, so no classes
  async function populateAscendancyOptions(select, preferredAscendancy) {
    try {
      const ascendancies = await waitFor(() => {
        const names = getRenderedAscendancies();
        return names.length ? names : null;
      });

      for (const name of ascendancies) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.append(option);
      }

      select.value = ascendancies.includes(preferredAscendancy)
        ? preferredAscendancy
        : "";
    } finally {
      select.disabled = false;
    }
  }

  // page navigation

  // build a clean poe.ninja URL for an ascendancy and skill
  function buildContextUrl(ascendancy, skill = "") {
    const url = new URL(LIST_PATH, location.origin);
    if (ascendancy) url.searchParams.set("class", ascendancy);
    if (skill) url.searchParams.set("skills", skill);
    return url;
  }

  // avoid letting old page filters affect a new roll
  function isCurrentRollContext(ascendancy) {
    if (location.pathname.replace(/\/$/, "") !== LIST_PATH) return false;

    const parameters = new URLSearchParams(location.search);
    const keys = [...parameters.keys()];
    if (keys.some((key) => key !== "class")) return false;
    return (parameters.get("class") || "") === ascendancy;
  }

  // skill scanning

  function parsePrecisePercentage(cell) {
    const background =
      cell.style.background || cell.getAttribute("style") || "";
    const precise = background.match(/\)\s*([\d.]+)%,\s*transparent/i);
    if (precise) return Number(precise[1]);

    const displayed = cell.textContent.match(/([\d.]+)%\s*$/);
    return displayed ? Number(displayed[1]) : Number.NaN;
  }

  function readRenderedSkillRows(list, collected) {
    for (const item of list.querySelectorAll("li[data-react-window-index]")) {
      const cell = item.querySelector('.filter-list-cell[role="checkbox"]');
      const nameElement = cell?.querySelector("[title]");
      const name = nameElement?.getAttribute("title")?.trim();
      const percentage = cell ? parsePrecisePercentage(cell) : Number.NaN;

      if (name && Number.isFinite(percentage)) {
        collected.set(name, { name, percentage });
      }
    }
  }

  async function collectMainSkills(onProgress) {
    // collect every Main Skill and its usage percentage
    const section = await waitFor(() => findSection("Main Skills"));
    const list = section.querySelector(
      '[role="list"].filter-list, [role="list"]',
    );
    if (!list) throw new Error("Could not find poe.ninja's Main Skills list.");

    const originalScrollTop = list.scrollTop;
    const collected = new Map();
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    const step = Math.max(144, list.clientHeight - 72);

    for (let position = 0; position <= maxScroll; position += step) {
      list.scrollTop = Math.min(position, maxScroll);
      await sleep(35);
      readRenderedSkillRows(list, collected);
      onProgress?.(
        maxScroll ? Math.min(1, position / maxScroll) : 1,
        collected.size,
      );
    }

    if (list.scrollTop !== maxScroll) {
      list.scrollTop = maxScroll;
      await sleep(50);
      readRenderedSkillRows(list, collected);
    }

    list.scrollTop = originalScrollTop;
    return [...collected.values()];
  }

  // settings

  function loadSettings() {
    // first-run defaults live here; saved settings override them
    const fallback = {
      minimumPlayers: 2,
      maximumPlayers: 10,
      minimumLevel: 85,
      ascendancy: "",
    };
    try {
      return {
        ...fallback,
        ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
      };
    } catch {
      return fallback;
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  // ui stuff

  function injectStyles() {
    // styling to make the UI look more like the rest of poe.ninja to avoid making the script "stick out" too much
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        --pn-ubr-bg-deep: var(--color-coolgrey-1000, #0e1216);
        --pn-ubr-bg: var(--color-coolgrey-950, #131a20);
        --pn-ubr-surface: var(--color-coolgrey-900, #1d262f);
        --pn-ubr-surface-raised: var(--color-coolgrey-850, #242e38);
        --pn-ubr-surface-hover: var(--color-coolgrey-800, #2f3b46);
        --pn-ubr-border: var(--color-coolgrey-700, #3f4d5a);
        --pn-ubr-text: var(--color-coolgrey-50, #f5f7fa);
        --pn-ubr-text-muted: var(--color-coolgrey-300, #9aa5b1);
        --pn-ubr-accent: var(--color-emerald-500, #00bb7f);
        --pn-ubr-accent-hover: var(--color-emerald-400, #00d492);
        --pn-ubr-gold: var(--color-gold, #b6ad8a);
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        color: var(--pn-ubr-text);
        font: 14px/1.4 system-ui, sans-serif;
        color-scheme: dark;
      }
      #${ROOT_ID} * { box-sizing: border-box; }
      #pn-ubr-toggle {
        display: block;
        margin-left: auto;
        border: 1px solid var(--pn-ubr-accent);
        border-radius: 3px;
        padding: 9px 13px;
        background: color-mix(in srgb, var(--pn-ubr-bg) 94%, transparent);
        color: var(--pn-ubr-accent);
        cursor: pointer;
        box-shadow: 0 4px 18px #000a;
        font-weight: 700;
        transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
      }
      #pn-ubr-toggle:hover {
        border-color: var(--pn-ubr-accent-hover);
        background: var(--pn-ubr-surface-raised);
        color: var(--pn-ubr-accent-hover);
      }
      #pn-ubr-panel {
        width: 340px;
        margin-bottom: 8px;
        border: 1px solid var(--pn-ubr-border);
        border-radius: 3px;
        padding: 14px;
        background: color-mix(in srgb, var(--pn-ubr-bg) 96%, transparent);
        box-shadow: 0 8px 28px #000c;
        backdrop-filter: blur(8px);
      }
      #pn-ubr-panel[hidden] { display: none; }
      .pn-ubr-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: -14px -14px 13px;
        border-bottom: 1px solid var(--pn-ubr-border);
        padding: 10px 12px;
        background: var(--pn-ubr-surface);
      }
      .pn-ubr-title { color: var(--pn-ubr-gold); font-size: 15px; font-weight: 700; letter-spacing: .01em; }
      .pn-ubr-close {
        width: 26px;
        height: 26px;
        border: 1px solid transparent;
        border-radius: 2px;
        padding: 0;
        background: transparent;
        color: var(--pn-ubr-text-muted);
        cursor: pointer;
        font-size: 20px;
        line-height: 22px;
      }
      .pn-ubr-close:hover { border-color: var(--pn-ubr-border); background: var(--pn-ubr-surface-hover); color: var(--pn-ubr-text); }
      .pn-ubr-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
      .pn-ubr-field { display: grid; gap: 5px; color: var(--pn-ubr-text-muted); font-size: 12px; }
      .pn-ubr-field-wide { margin-bottom: 10px; }
      .pn-ubr-field input, .pn-ubr-field select {
        width: 100%;
        height: 34px;
        border: 1px solid var(--pn-ubr-border);
        border-radius: 2px;
        padding: 6px 8px;
        outline: none;
        background: var(--pn-ubr-bg-deep);
        color: var(--pn-ubr-text);
      }
      .pn-ubr-field input:hover, .pn-ubr-field select:hover { border-color: var(--color-coolgrey-600, #515f6c); }
      .pn-ubr-field input:focus, .pn-ubr-field select:focus { border-color: var(--pn-ubr-accent); box-shadow: 0 0 0 1px var(--pn-ubr-accent); }
      .pn-ubr-field input:disabled, .pn-ubr-field select:disabled { opacity: .65; }
      #pn-ubr-roll {
        width: 100%;
        margin-top: 12px;
        border: 1px solid var(--pn-ubr-accent);
        border-radius: 2px;
        padding: 8px;
        background: var(--pn-ubr-accent);
        color: var(--pn-ubr-bg-deep);
        cursor: pointer;
        font-weight: 750;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      #pn-ubr-roll:hover { border-color: var(--pn-ubr-accent-hover); background: var(--pn-ubr-accent-hover); }
      #pn-ubr-roll:disabled { border-color: var(--pn-ubr-border); background: var(--pn-ubr-surface-hover); color: var(--pn-ubr-text-muted); cursor: wait; opacity: .75; }
      #pn-ubr-status {
        min-height: 20px;
        margin-top: 10px;
        border-left: 2px solid var(--pn-ubr-border);
        padding: 6px 8px;
        background: var(--pn-ubr-surface);
        color: var(--pn-ubr-text-muted);
        font-size: 12px;
      }
      #pn-ubr-status:empty { display: none; }
      #pn-ubr-result { margin-top: 10px; border-top: 1px solid var(--pn-ubr-border); padding-top: 10px; }
      #pn-ubr-result:empty { display: none; }
      .pn-ubr-skill { color: var(--color-gem, #65b8b1); font-size: 16px; font-weight: 700; }
      .pn-ubr-error { color: var(--color-red-500, #f56666); }
    `;
    document.head.append(style);
  }

  function createUi() {
    // build the floating settings panel
    if (document.getElementById(ROOT_ID)) return;
    injectStyles();

    const settings = loadSettings();
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <section id="pn-ubr-panel" hidden>
        <div class="pn-ubr-head">
          <div class="pn-ubr-title">Off-meta Build Settings</div>
          <button class="pn-ubr-close" type="button" aria-label="Close">&times;</button>
        </div>
        <label class="pn-ubr-field pn-ubr-field-wide">Ascendancy
          <select id="pn-ubr-ascendancy" disabled>
            <option value="">Any ascendancy</option>
          </select>
        </label>
        <div class="pn-ubr-grid">
          <label class="pn-ubr-field">Min players<input id="pn-ubr-min" type="number" min="1" max="100" value="${settings.minimumPlayers}"></label>
          <label class="pn-ubr-field">Max players<input id="pn-ubr-max" type="number" min="1" max="500" value="${settings.maximumPlayers}"></label>
          <label class="pn-ubr-field">Min level<input id="pn-ubr-level" type="number" max="100" value="${settings.minimumLevel}" disabled></label>
        </div>
        <button id="pn-ubr-roll" type="button" disabled>Reset filters &amp; roll</button>
        <div id="pn-ubr-status"></div>
        <div id="pn-ubr-result"></div>
      </section>
      <button id="pn-ubr-toggle" type="button">Off-meta Build</button>
    `;
    document.body.append(root);

    const panel = root.querySelector("#pn-ubr-panel");
    const toggle = root.querySelector("#pn-ubr-toggle");
    const close = root.querySelector(".pn-ubr-close");
    const roll = root.querySelector("#pn-ubr-roll");
    const status = root.querySelector("#pn-ubr-status");
    const result = root.querySelector("#pn-ubr-result");
    const ascendancySelect = root.querySelector("#pn-ubr-ascendancy");
    const minimumLevelInput = root.querySelector("#pn-ubr-level");
    let minimumLevelFloor = null;
    const ascendancyOptionsReady = populateAscendancyOptions(
      ascendancySelect,
      settings.ascendancy,
    ).catch((error) => {
      console.error(
        "[Off-meta Build Randomizer] Could not load ascendancies.",
        error,
      );
    });
    const minimumLevelReady = configureMinimumLevelInput(
      minimumLevelInput,
      settings.minimumLevel,
    )
      .then((pageMinimum) => {
        minimumLevelFloor = pageMinimum;
        return true;
      })
      .catch((error) => {
        console.error(
          "[Off-meta Build Randomizer] Could not load the level range.",
          error,
        );
        showError(status, error);
        return false;
      });
    const controlsReady = Promise.all([
      ascendancyOptionsReady,
      minimumLevelReady,
    ]).then(([, levelReady]) => {
      // wait for poe.ninja's controls before allowing a roll
      if (levelReady) roll.disabled = false;
      return levelReady;
    });

    // show the randomly rolled skill and ascendancy in the ui, together with how many people are playing that combo
    function showResult(skill, filteredCount, candidateCount, ascendancy) {
      result.replaceChildren();

      const skillLine = document.createElement("div");
      skillLine.className = "pn-ubr-skill";
      skillLine.textContent = skill;

      const countLine = document.createElement("div");
      const population = ascendancy
        ? `${ascendancy} character${filteredCount === 1 ? "" : "s"}`
        : `character${filteredCount === 1 ? "" : "s"}`;
      countLine.textContent = `${filteredCount} tracked ${population} use this Main Skill.`;

      result.append(skillLine, countLine);
      status.textContent = `Selected from ${candidateCount} eligible Main Skills.`;
    }

    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
    });
    close.addEventListener("click", () => {
      panel.hidden = true;
    });

    roll.addEventListener("click", async () => {
      result.replaceChildren();

      const minimumPlayers = Number(root.querySelector("#pn-ubr-min").value);
      const maximumPlayers = Number(root.querySelector("#pn-ubr-max").value);
      const minimumLevel = Number(minimumLevelInput.value);
      const ascendancy = ascendancySelect.value;

      if (
        minimumLevelFloor !== null &&
        Number.isInteger(minimumLevel) &&
        minimumLevel < minimumLevelFloor
      ) {
        showError(
          status,
          `Your min level is below the required level to be listed in the selected league. Required level: ${minimumLevelFloor}.`,
        );
        return;
      }

      if (
        !Number.isInteger(minimumPlayers) ||
        !Number.isInteger(maximumPlayers) ||
        minimumPlayers < 1 ||
        maximumPlayers < minimumPlayers ||
        !Number.isInteger(minimumLevel) ||
        minimumLevelFloor === null ||
        minimumLevel > 100
      ) {
        showError(status, "Check the player and level ranges.");
        return;
      }

      saveSettings({
        minimumPlayers,
        maximumPlayers,
        minimumLevel,
        ascendancy,
      });

      // move to a clean page for the chosen ascendancy first
      if (!isCurrentRollContext(ascendancy)) {
        status.textContent = ascendancy
          ? `Opening the ${ascendancy} build page…`
          : "Returning to the unfiltered build page…";
        const contextUrl = buildContextUrl(ascendancy);
        contextUrl.hash = "pn-ubr-autostart";
        location.assign(contextUrl);
        return;
      }

      roll.disabled = true;

      try {
        // filter by level before reading skill percentages
        status.textContent = `Applying poe.ninja's level ${minimumLevel}–100 filter…`;
        await applyMinimumLevelFilter(minimumLevel);

        const total = getFoundCount();
        if (total === null)
          throw new Error("Could not read the tracked character count.");
        if (total === 0) {
          throw new Error(
            `No tracked characters are level ${minimumLevel} or higher.`,
          );
        }

        status.textContent = "Scanning rendered Main Skills…";
        const skills = await collectMainSkills((progress, count) => {
          status.textContent = `Scanning rendered Main Skills… ${Math.round(progress * 100)}% (${count} found)`;
        });

        // turn each skill percentage into an estimated player count
        const candidates = skills
          .map((skill) => ({
            ...skill,
            players: Math.max(1, Math.round((total * skill.percentage) / 100)),
          }))
          .filter(
            (skill) =>
              skill.players >= minimumPlayers &&
              skill.players <= maximumPlayers,
          );

        if (!candidates.length) {
          throw new Error(
            `No Main Skills currently have ${minimumPlayers}–${maximumPlayers} tracked characters.`,
          );
        }

        const skill = randomItem(candidates);
        status.textContent = `Found ${candidates.length} eligible skills. Opening ${skill.name}…`;
        sessionStorage.setItem(
          PENDING_KEY,
          JSON.stringify({
            skill: skill.name,
            ascendancy,
            candidateCount: candidates.length,
            maximumPlayers,
            minimumLevel,
            listPath: LIST_PATH,
            createdAt: Date.now(),
          }),
        );
        location.assign(buildContextUrl(ascendancy, skill.name));
      } catch (error) {
        console.error("[Off-meta Build Randomizer]", error);
        showError(status, error);
      } finally {
        roll.disabled = false;
      }
    });

    async function resumePendingRoll() {
      const serialized = sessionStorage.getItem(PENDING_KEY);
      if (!serialized || !new URLSearchParams(location.search).has("skills"))
        return;

      sessionStorage.removeItem(PENDING_KEY);
      let pending;
      try {
        pending = JSON.parse(serialized);
      } catch {
        return;
      }

      if (
        !pending?.skill ||
        pending.listPath !== LIST_PATH ||
        (new URLSearchParams(location.search).get("class") || "") !==
          (pending.ascendancy || "") ||
        Date.now() - pending.createdAt > 120_000
      )
        return;

      panel.hidden = false;
      roll.disabled = true;
      status.textContent = `Applying poe.ninja's level ${pending.minimumLevel}–100 filter…`;

      try {
        await applyMinimumLevelFilter(pending.minimumLevel);
        status.textContent = `Waiting for poe.ninja to render ${pending.skill}…`;

        const filteredCount = await waitFor(() => {
          const count = getFoundCount();
          const links = document.querySelectorAll(
            'table tbody a[href*="/character/"]',
          );
          return count && count <= pending.maximumPlayers && links.length
            ? count
            : null;
        }, 25_000);

        showResult(
          pending.skill,
          filteredCount,
          pending.candidateCount,
          pending.ascendancy || "",
        );
      } catch (error) {
        showError(status, error);
      } finally {
        roll.disabled = false;
      }
    }

    if (location.hash === "#pn-ubr-autostart") {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      panel.hidden = false;
      void controlsReady.then((ready) => {
        if (ready) roll.click();
      });
    } else {
      void controlsReady.then((ready) => {
        if (ready) void resumePendingRoll();
      });
    }
  }

  if (document.body) createUi();
  else window.addEventListener("DOMContentLoaded", createUi, { once: true });
})();
