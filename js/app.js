/* Mirror49 — application logic
   Vanilla JS, no framework, no backend. All progress persists to localStorage. */

(() => {
  "use strict";

  const STORAGE_KEY = "mirror49:v1";

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  function defaultState() {
    const days = {};
    DAYS.forEach((d) => {
      days[d.day] = {
        checklist: DAILY_CHECKLIST_LABELS.map(() => false),
        dsa: d.dsa.map(() => false),
      };
    });
    const weekGates = {};
    WEEKS.forEach((w) => {
      weekGates[w.week] = w.gate.map(() => false);
    });
    const resources = {};
    DAYS.forEach((d) => {
      if (d.resources) d.resources.forEach((r, i) => { resources[resourceKey(d.day, i)] = false; });
      const primerDay = DSA_PRIMERS_BY_DAY[d.day];
      if (primerDay) {
        primerDay.patterns.forEach((p) => {
          (p.resources || []).forEach((r, ri) => { resources[dsaPrimerVideoKey(d.day, p.id, ri)] = false; });
        });
      }
    });
    const dsaPrimer = {};
    DAYS.forEach((d) => {
      const primerDay = DSA_PRIMERS_BY_DAY[d.day];
      if (!primerDay) return;
      primerDay.patterns.forEach((p) => {
        dsaPrimer[dsaPrimerKey(d.day, p.id, "read")] = false;
        if (p.template) dsaPrimer[dsaPrimerKey(d.day, p.id, "template")] = false;
      });
      dsaPrimer[dsaPrimerKey(d.day, "day", "attempted")] = false;
      dsaPrimer[dsaPrimerKey(d.day, "day", "reviewed")] = false;
    });
    return {
      days,
      weekGates,
      rules: CONTRACT.rules.map(() => false),
      dsaMustInclude: DSA_OS.mustInclude.map(() => false),
      contentBlacklist: CONTENT_PATH.blacklist.map(() => false),
      finalReadiness: FINAL_READINESS.items.map(() => false),
      resources,
      dsaPrimer,
    };
  }

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // merge onto default so new fields never crash on old saved state
      const base = defaultState();
      return deepMerge(base, parsed);
    } catch (e) {
      console.warn("Mirror49: failed to load state, starting fresh.", e);
      return defaultState();
    }
  }

  function deepMerge(base, incoming) {
    if (!incoming || typeof incoming !== "object") return base;
    const out = Array.isArray(base) ? base.slice() : { ...base };
    Object.keys(base).forEach((key) => {
      if (incoming[key] === undefined) return;
      if (Array.isArray(base[key])) {
        if (Array.isArray(incoming[key])) {
          out[key] = base[key].map((v, i) =>
            incoming[key][i] !== undefined ? incoming[key][i] : v
          );
        }
      } else if (typeof base[key] === "object" && base[key] !== null) {
        out[key] = deepMerge(base[key], incoming[key]);
      } else {
        out[key] = incoming[key];
      }
    });
    return out;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Mirror49: failed to persist state.", e);
    }
  }

  function resetAllProgress() {
    if (!confirm("Reset all Mirror49 progress? This clears every checklist, DSA problem, weekly gate and readiness item. This cannot be undone.")) {
      return;
    }
    state = defaultState();
    saveState();
    render();
  }

  // ---------------------------------------------------------------------
  // Date / day helpers
  // ---------------------------------------------------------------------

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function computeCurrentDayNumber() {
    const today = startOfDay(new Date());
    const start = startOfDay(ROADMAP_START);
    const diff = Math.floor((today - start) / 86400000) + 1;
    if (diff < 1) return 1;
    if (diff > ROADMAP_END_DAYS) return ROADMAP_END_DAYS;
    return diff;
  }

  function getDayDef(n) {
    return DAYS.find((d) => d.day === n);
  }

  function getWeekDef(n) {
    return WEEKS.find((w) => w.week === n);
  }

  function daysInWeek(weekNum) {
    return DAYS.filter((d) => d.week === weekNum);
  }

  // ---------------------------------------------------------------------
  // Progress computation
  // ---------------------------------------------------------------------

  function dayStats(dayNum) {
    const def = getDayDef(dayNum);
    const s = state.days[dayNum];
    const total = DAILY_CHECKLIST_LABELS.length + def.dsa.length;
    const done = countTrue(s.checklist) + countTrue(s.dsa);
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0, complete: done === total };
  }

  function countTrue(arr) {
    return arr.reduce((acc, v) => acc + (v ? 1 : 0), 0);
  }

  function weekStats(weekNum) {
    const wd = daysInWeek(weekNum);
    let done = 0, total = 0;
    wd.forEach((d) => {
      const s = dayStats(d.day);
      done += s.done;
      total += s.total;
    });
    const completeDays = wd.filter((d) => dayStats(d.day).complete).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0, completeDays, totalDays: wd.length };
  }

  function gateStats(weekNum) {
    const arr = state.weekGates[weekNum];
    const done = countTrue(arr);
    return { done, total: arr.length, pct: arr.length ? Math.round((done / arr.length) * 100) : 0 };
  }

  function overallStats() {
    let done = 0, total = 0, completeDays = 0;
    DAYS.forEach((d) => {
      const s = dayStats(d.day);
      done += s.done;
      total += s.total;
      if (s.complete) completeDays += 1;
    });
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0, completeDays, totalDays: DAYS.length };
  }

  // ---------------------------------------------------------------------
  // Small render helpers
  // ---------------------------------------------------------------------

  function esc(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function checkIcon() {
    return '<svg viewBox="0 0 12 12" fill="none"><path d="M2 6.2L4.7 9L10 3" stroke="#04101c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function externalIcon() {
    return '<svg class="external-icon" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V11.5C1.5 12.0523 1.94772 12.5 2.5 12.5H10.5C11.0523 12.5 11.5 12.0523 11.5 11.5V8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 1.5H12.5V6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.2 1.8L6.5 7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function leetcodeUrl(title) {
    const slug = DSA_LEETCODE_SLUGS[title];
    return slug ? `https://leetcode.com/problems/${slug}/` : null;
  }

  // ---------------------------------------------------------------------
  // Learning-resource cards
  // ---------------------------------------------------------------------

  function resourceKey(dayNum, index) {
    return `${dayNum}:${index}`;
  }

  // DSA Pattern Primer completion keys — separate state bucket/namespace from the
  // AI-resource `resources` keys above, per the stable-ID scheme: dsa-primer:day:patternId:itemId.
  function dsaPrimerKey(dayNum, patternId, itemId) {
    return `dsa-primer:${dayNum}:${patternId}:${itemId}`;
  }
  function dsaPrimerVideoKey(dayNum, patternId, resIndex) {
    return dsaPrimerKey(dayNum, patternId, `video${resIndex}`);
  }

  function sumRequiredMinutes(arr) {
    return (arr || [])
      .filter((r) => r.priority === "REQUIRED")
      .reduce((acc, r) => acc + (parseInt(r.duration, 10) || 0), 0);
  }

  const ACTION_BY_FORMAT = {
    "Video": "Watch",
    "Article": "Read",
    "Documentation": "Read",
    "Course lesson": "Watch",
    "Internal exercise": "Attempt",
  };

  const ACTION_PAST_TENSE = {
    "Watch": "Watched",
    "Read": "Read",
    "Complete": "Completed",
    "Attempt": "Attempted",
  };

  function resourceAction(r) {
    return r.action || ACTION_BY_FORMAT[r.format] || "Complete";
  }

  function parseTimeToSeconds(t) {
    if (!t) return null;
    const parts = String(t).split(":").map((p) => parseInt(p, 10));
    if (parts.some((p) => Number.isNaN(p))) return null;
    let seconds = 0;
    for (const p of parts) seconds = seconds * 60 + p;
    return seconds;
  }

  function timestampedUrl(r) {
    if (!r.url) return null;
    if (!r.startTime) return r.url;
    const seconds = parseTimeToSeconds(r.startTime);
    if (seconds === null) return r.url;
    const sep = r.url.includes("?") ? "&" : "?";
    return `${r.url}${sep}t=${seconds}s`;
  }

  function priorityClass(priority) {
    if (priority === "REQUIRED") return "required";
    if (priority === "OPTIONAL") return "optional";
    return "reference";
  }

  function renderResourceCard(dayNum, r, index) {
    return renderResourceCardByKey(resourceKey(dayNum, index), r);
  }

  function renderResourceCardByKey(key, r) {
    const done = !!state.resources[key];
    const action = resourceAction(r);
    const pastTense = ACTION_PAST_TENSE[action] || "Done";
    const url = timestampedUrl(r);
    const priorityCls = priorityClass(r.priority);

    const titleHtml = url
      ? `<a class="resource-title" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}${externalIcon()}</a>`
      : `<span class="resource-title resource-title-plain">${esc(r.title)}</span>`;

    const timeRangeHtml = (r.startTime && r.endTime)
      ? `<span class="resource-tag resource-timerange">${esc(action)} ${esc(r.startTime)}–${esc(r.endTime)}</span>`
      : (r.startTime ? `<span class="resource-tag resource-timerange">${esc(action)} from ${esc(r.startTime)}</span>` : "");

    const paidHtml = r.paid ? `<span class="resource-tag resource-paid">Paid</span>` : "";

    // Hidden-mock content (unseen problems in Days 46/47/49) splits on a fixed delimiter:
    // the problem statement stays visible immediately, the pattern tag/solution/analysis
    // after it stays hidden until the learner explicitly presses "Reveal analysis".
    const REVEAL_DELIMITER = "--- REVEAL ANALYSIS BELOW ---";
    const contentHtml = r.content
      ? (r.content.includes(REVEAL_DELIMITER)
          ? (() => {
              const [before, ...rest] = r.content.split(REVEAL_DELIMITER);
              const after = rest.join(REVEAL_DELIMITER);
              return `
                <div class="resource-content resource-content-problem">${esc(before.trim())}</div>
                <details class="resource-details reveal-analysis"><summary>Reveal analysis</summary><div class="resource-content">${esc(after.trim())}</div></details>`;
            })()
          : `<details class="resource-details"><summary>Open full material</summary><div class="resource-content">${esc(r.content)}</div></details>`)
      : "";

    return `
      <div class="resource-card resource-card-${priorityCls}">
        <div class="resource-main">
          ${titleHtml}
          <div class="resource-meta">
            <span class="resource-priority resource-priority-${priorityCls}">${esc(r.priority)}</span>
            <span class="resource-platform">${esc(r.creator)}</span>
            <span class="resource-type">${esc(r.format)}</span>
            <span class="resource-tag resource-duration">${esc(r.duration)}</span>
            ${timeRangeHtml}
            ${paidHtml}
          </div>
          <div class="resource-instruction">${esc(r.instruction)}</div>
          ${r.why ? `<div class="resource-why"><span>Why this resource:</span> ${esc(r.why)}</div>` : ""}
          ${contentHtml}
        </div>
        <div class="resource-watched ${done ? "done" : ""}" data-nav="toggle-resource" data-key="${esc(key)}" role="checkbox" aria-checked="${done}" tabindex="0">
          <span class="check-box">${checkIcon()}</span>
          <span>${done ? pastTense : action}</span>
        </div>
      </div>`;
  }

  function renderDsaItem({ title, checked, dataAttrs }) {
    const attrs = Object.entries(dataAttrs).map(([k, v]) => `data-${k}="${v}"`).join(" ");
    const url = leetcodeUrl(title);
    const titleHtml = url
      ? `<a class="check-label dsa-link" href="${url}" target="_blank" rel="noopener noreferrer">${esc(title)}${externalIcon()}</a>`
      : `<span class="check-label">${esc(title)}</span>`;
    return `
      <div class="check-item dsa-item ${checked ? "done" : ""}" ${attrs} role="checkbox" aria-checked="${checked}" tabindex="0">
        <span class="check-box">${checkIcon()}</span>
        ${titleHtml}
      </div>`;
  }

  function renderResourcesCard(dayNum, resources) {
    if (!resources || !resources.length) {
      return `
        <div class="card">
          <div class="card-title" style="margin-bottom:10px;">Learning Resources</div>
          <div class="resource-empty">No external resources today — review notes and prior material.</div>
        </div>`;
    }
    const required = resources.filter((r) => r.priority === "REQUIRED");
    const requiredMinutes = sumRequiredMinutes(resources);
    const items = resources.map((r, i) => renderResourceCard(dayNum, r, i)).join("");

    return `
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div class="card-title">Learning Resources</div>
          ${required.length ? `<span class="pill">${requiredMinutes || "~"} min required</span>` : ""}
        </div>
        <div class="resource-list">${items}</div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // DSA Pattern Primer
  // ---------------------------------------------------------------------

  function renderDsaPrimerCheck(key, label) {
    const done = !!state.dsaPrimer[key];
    return `
      <div class="check-item dsa-primer-check ${done ? "done" : ""}" data-nav="toggle-dsa-primer" data-key="${esc(key)}" role="checkbox" aria-checked="${done}" tabindex="0">
        <span class="check-box">${checkIcon()}</span>
        <span class="check-label">${esc(label)}</span>
      </div>`;
  }

  function renderDsaPatternBlock(dayNum, pattern) {
    const readKey = dsaPrimerKey(dayNum, pattern.id, "read");
    const recognitionHtml = (pattern.recognition || []).map((r) => `<li>${esc(r)}</li>`).join("");
    const mistakesHtml = (pattern.commonMistakes || []).map((m) => `<li>${esc(m)}</li>`).join("");

    const complexityHtml = pattern.complexity
      ? `<div class="dsa-complexity">
          <span class="dsa-complexity-badge">Time ${esc(pattern.complexity.time)}</span>
          <span class="dsa-complexity-badge">Space ${esc(pattern.complexity.space)}</span>
        </div>`
      : "";

    const templateHtml = pattern.template
      ? `<details class="resource-details dsa-template">
          <summary>Open reusable template</summary>
          <pre class="dsa-template-code">${esc(pattern.template)}</pre>
        </details>
        ${renderDsaPrimerCheck(dsaPrimerKey(dayNum, pattern.id, "template"), "Template practised")}`
      : "";

    const walkthroughHtml = pattern.walkthrough
      ? `<details class="resource-details">
          <summary>Open tiny walkthrough</summary>
          <div class="resource-content">${esc(pattern.walkthrough)}</div>
        </details>`
      : "";

    const resourcesHtml = (pattern.resources || [])
      .map((r, ri) => renderResourceCardByKey(dsaPrimerVideoKey(dayNum, pattern.id, ri), r))
      .join("");

    return `
      <div class="dsa-pattern-block">
        <div class="dsa-pattern-header">
          <h3 class="dsa-pattern-name">${esc(pattern.name)}</h3>
          ${renderDsaPrimerCheck(readKey, "Primer read")}
        </div>
        ${recognitionHtml ? `<div class="dsa-subhead">Use this when…</div><ul class="dsa-list">${recognitionHtml}</ul>` : ""}
        ${pattern.intuition ? `<div class="dsa-subhead">Core intuition</div><p class="dsa-intuition">${esc(pattern.intuition)}</p>` : ""}
        ${templateHtml}
        ${complexityHtml}
        ${mistakesHtml ? `<div class="dsa-subhead">Common mistakes</div><ul class="dsa-list dsa-mistakes">${mistakesHtml}</ul>` : ""}
        ${walkthroughHtml}
        ${resourcesHtml ? `<div class="dsa-subhead">Required helper</div><div class="resource-list">${resourcesHtml}</div>` : ""}
      </div>`;
  }

  function renderDsaPrimerCard(dayNum, aiResources) {
    const primerDay = DSA_PRIMERS_BY_DAY[dayNum];
    if (!primerDay || !primerDay.patterns || !primerDay.patterns.length) return "";

    const patternsHtml = primerDay.patterns.map((p) => renderDsaPatternBlock(dayNum, p)).join("");
    const primerRequiredMin = primerDay.patterns.reduce(
      (acc, p) => acc + sumRequiredMinutes(p.resources), 0
    );
    const aiRequiredMin = sumRequiredMinutes(aiResources);
    const attemptedKey = dsaPrimerKey(dayNum, "day", "attempted");
    const reviewedKey = dsaPrimerKey(dayNum, "day", "reviewed");

    return `
      <div class="card dsa-primer-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div class="card-title">DSA Pattern Primer</div>
          <span class="pill">${primerRequiredMin || "~"} min required</span>
        </div>
        <div class="dsa-duration-strip">
          <span>AI learning: <b>${aiRequiredMin || "~"} min</b> required</span>
          <span>DSA primer: <b>${primerRequiredMin || "~"} min</b> required</span>
          <span>Problem solving: <b>approximately 60–90 min</b></span>
        </div>
        ${patternsHtml}
        <div class="dsa-primer-footer">
          ${renderDsaPrimerCheck(attemptedKey, "Problems attempted")}
          ${renderDsaPrimerCheck(reviewedKey, "Review completed")}
        </div>
      </div>`;
  }

  function renderCheckItem({ label, checked, dataAttrs }) {
    const attrs = Object.entries(dataAttrs).map(([k, v]) => `data-${k}="${v}"`).join(" ");
    return `
      <div class="check-item ${checked ? "done" : ""}" ${attrs} role="checkbox" aria-checked="${checked}" tabindex="0">
        <span class="check-box">${checkIcon()}</span>
        <span class="check-label">${esc(label)}</span>
      </div>`;
  }

  function barRow(pct) {
    return `
      <div class="bar-row">
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="bar-pct">${pct}%</span>
      </div>`;
  }

  function ring(pct, caption) {
    const r = 38, c = 2 * Math.PI * r;
    const offset = c - (pct / 100) * c;
    return `
      <div class="ring-wrap">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <defs>
            <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#06b6d4"/>
              <stop offset="100%" stop-color="#6366f1"/>
            </linearGradient>
          </defs>
          <circle class="ring-bg" cx="46" cy="46" r="${r}" fill="none" stroke-width="8"/>
          <circle class="ring-fg" cx="46" cy="46" r="${r}" fill="none" stroke-width="8"
            stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
        </svg>
        <div class="ring-center">
          <span class="ring-value">${pct}%</span>
          <span class="ring-caption">${esc(caption)}</span>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------

  function viewToday() {
    const dayNum = getSelectedDay();
    const def = getDayDef(dayNum);
    const s = state.days[dayNum];
    const stats = dayStats(dayNum);
    const weekDef = getWeekDef(def.week);
    const isRealToday = dayNum === computeCurrentDayNumber();

    const checklistHtml = DAILY_CHECKLIST_LABELS.map((label, i) =>
      renderCheckItem({
        label,
        checked: s.checklist[i],
        dataAttrs: { scope: "day-checklist", day: dayNum, index: i },
      })
    ).join("");

    const dsaHtml = def.dsa.map((label, i) =>
      renderDsaItem({
        title: label,
        checked: s.dsa[i],
        dataAttrs: { scope: "day-dsa", day: dayNum, index: i },
      })
    ).join("");

    return `
      <div class="view-header">
        <div class="eyebrow">${isRealToday ? "Today" : "Day view"} · Week ${def.week}</div>
        <h1 class="view-title">Today's Tasks</h1>
        <p class="view-subtitle">${esc(weekDef.title)}</p>
      </div>

      <div class="today-hero">
        <div class="today-hero-left">
          <div class="today-day-label">DAY ${def.day} OF 49</div>
          <h2 class="today-title">${esc(def.title)}</h2>
          <div class="today-date">${esc(def.date)}</div>
        </div>
        <div class="day-nav">
          <button data-nav="prev-day" ${dayNum <= 1 ? "disabled" : ""} title="Previous day" aria-label="Previous day">‹</button>
          <button data-nav="today" title="Jump to today" aria-label="Jump to today">•</button>
          <button data-nav="next-day" ${dayNum >= 49 ? "disabled" : ""} title="Next day" aria-label="Next day">›</button>
        </div>
      </div>

      <div class="today-grid">
        <div>
          <div class="card">
            <div class="field-row">
              <div class="field-label">Learn</div>
              <div class="field-value">${esc(def.learn)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Build</div>
              <div class="field-value">${esc(def.build)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Ship</div>
              <div class="field-value ship-value">${esc(def.ship)}</div>
            </div>
          </div>

          ${renderDsaPrimerCard(def.day, def.resources)}

          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div class="card-title">DSA problems</div>
              <span class="pill ${countTrue(s.dsa) === s.dsa.length ? "complete" : ""}">${countTrue(s.dsa)}/${s.dsa.length}</span>
            </div>
            <div class="checklist">${dsaHtml}</div>
          </div>

          ${renderResourcesCard(def.day, def.resources)}
        </div>

        <div class="side-stack">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div class="card-title">Daily completion</div>
              <span class="pill ${stats.complete ? "complete" : ""}">${stats.done}/${stats.total}</span>
            </div>
            <div class="checklist">${checklistHtml}</div>
          </div>

          <div class="card">
            <div class="card-title" style="margin-bottom:10px;">Day progress</div>
            ${barRow(stats.pct)}
          </div>
        </div>
      </div>
    `;
  }

  function viewProgress() {
    const overall = overallStats();
    const weeksHtml = WEEKS.map((w) => {
      const ws = weekStats(w.week);
      return `
        <div class="week-stat-card">
          <div class="week-stat-idx">WK ${w.week}</div>
          <div style="flex:1;min-width:0;">
            <div class="week-stat-name">${esc(w.title)}</div>
            <div class="week-stat-sub">${esc(w.dateRange)} · ${ws.completeDays}/${ws.totalDays} days complete</div>
          </div>
          <div class="week-stat-bar">${barRow(ws.pct)}</div>
        </div>`;
    }).join("");

    return `
      <div class="view-header">
        <div class="eyebrow">Overview</div>
        <h1 class="view-title">49-Day Progress</h1>
        <p class="view-subtitle">Every task, DSA problem and weekly gate rolled into one number.</p>
      </div>

      <div class="card" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
        ${ring(overall.pct, "Overall")}
        <div class="stat-grid" style="flex:1;margin-bottom:0;">
          <div class="stat-tile">
            <div class="stat-tile-label">Days complete</div>
            <div class="stat-tile-value accent">${overall.completeDays} / ${overall.totalDays}</div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile-label">Tasks done</div>
            <div class="stat-tile-value">${overall.done} / ${overall.total}</div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile-label">Current day</div>
            <div class="stat-tile-value">Day ${computeCurrentDayNumber()}</div>
          </div>
        </div>
      </div>

      <div class="section-block" style="margin-top:22px;">
        <div class="section-block-title">Weekly breakdown</div>
        <div class="week-stat-list">${weeksHtml}</div>
      </div>
    `;
  }

  function viewRoadmap() {
    const weeksHtml = WEEKS.map((w) => {
      const ws = weekStats(w.week);
      const gs = gateStats(w.week);
      const wd = daysInWeek(w.week);
      const open = uiState.openWeek === w.week;

      const dayTiles = wd.map((d) => {
        const ds = dayStats(d.day);
        const dotClass = ds.complete ? "complete" : ds.done > 0 ? "partial" : "";
        return `
          <button class="day-tile" data-nav="open-day" data-day="${d.day}">
            <span class="day-tile-num">D${d.day}</span>
            <span class="day-tile-body">
              <span class="day-tile-title">${esc(d.title)}</span>
              <span class="day-tile-progress">${ds.done}/${ds.total}</span>
            </span>
            <span class="day-tile-dot ${dotClass}"></span>
          </button>`;
      }).join("");

      const gateHtml = w.gate.map((label, i) =>
        renderCheckItem({
          label,
          checked: state.weekGates[w.week][i],
          dataAttrs: { scope: "week-gate", week: w.week, index: i },
        })
      ).join("");

      return `
        <div class="week-row ${open ? "open" : ""}">
          <div class="week-summary" data-nav="toggle-week" data-week="${w.week}">
            <div class="week-index">WEEK ${w.week}</div>
            <div class="week-info">
              <div class="week-title-row">
                <span class="week-title">${esc(w.title)}</span>
                <span class="week-dates">${esc(w.dateRange)}</span>
              </div>
              <div class="week-focus-row">
                <span>AI: <b>${esc(w.aiFocus)}</b></span>
                <span>DSA: <b>${esc(w.dsaFocus)}</b></span>
              </div>
            </div>
            <div class="week-bar">${barRow(ws.pct)}</div>
            <span class="week-chevron">▸</span>
          </div>
          <div class="week-body">
            <p class="week-outcome"><strong>Outcome:</strong> ${esc(w.outcome)}</p>
            <div class="gate-box">
              <div class="gate-box-title">Weekly gate — ${gs.done}/${gs.total}</div>
              <div class="checklist checklist-grid">${gateHtml}</div>
            </div>
            <div class="day-grid">${dayTiles}</div>
          </div>
        </div>`;
    }).join("");

    return `
      <div class="view-header">
        <div class="eyebrow">Structure</div>
        <h1 class="view-title">Seven-Week Roadmap</h1>
        <p class="view-subtitle">One system, increasing depth. Expand a week to reach its gate and days.</p>
      </div>
      <div class="week-list">${weeksHtml}</div>
    `;
  }

  function viewDayDetail(dayNum) {
    const def = getDayDef(dayNum);
    const weekDef = getWeekDef(def.week);
    const s = state.days[dayNum];
    const stats = dayStats(dayNum);

    const checklistHtml = DAILY_CHECKLIST_LABELS.map((label, i) =>
      renderCheckItem({
        label,
        checked: s.checklist[i],
        dataAttrs: { scope: "day-checklist", day: dayNum, index: i },
      })
    ).join("");

    const dsaHtml = def.dsa.map((label, i) =>
      renderDsaItem({
        title: label,
        checked: s.dsa[i],
        dataAttrs: { scope: "day-dsa", day: dayNum, index: i },
      })
    ).join("");

    return `
      <div class="crumb">
        <a href="#/roadmap">Roadmap</a><span>/</span>
        <a href="#/roadmap" data-nav="open-week" data-week="${def.week}">Week ${def.week}</a><span>/</span>
        <span>Day ${def.day}</span>
      </div>
      <div class="view-header">
        <div class="eyebrow">Week ${def.week} · ${esc(weekDef.title)}</div>
        <h1 class="view-title">Day ${def.day} — ${esc(def.title)}</h1>
        <p class="view-subtitle">${esc(def.date)}</p>
      </div>

      <div class="today-grid">
        <div>
          <div class="card">
            <div class="field-row">
              <div class="field-label">Learn</div>
              <div class="field-value">${esc(def.learn)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Build</div>
              <div class="field-value">${esc(def.build)}</div>
            </div>
            <div class="field-row">
              <div class="field-label">Ship</div>
              <div class="field-value ship-value">${esc(def.ship)}</div>
            </div>
          </div>
          ${renderDsaPrimerCard(def.day, def.resources)}
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div class="card-title">DSA problems</div>
              <span class="pill ${countTrue(s.dsa) === s.dsa.length ? "complete" : ""}">${countTrue(s.dsa)}/${s.dsa.length}</span>
            </div>
            <div class="checklist">${dsaHtml}</div>
          </div>
          ${renderResourcesCard(def.day, def.resources)}
        </div>
        <div class="side-stack">
          <div class="card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div class="card-title">Daily completion</div>
              <span class="pill ${stats.complete ? "complete" : ""}">${stats.done}/${stats.total}</span>
            </div>
            <div class="checklist">${checklistHtml}</div>
          </div>
          <div class="card">
            <div class="card-title" style="margin-bottom:10px;">Day progress</div>
            ${barRow(stats.pct)}
          </div>
        </div>
      </div>
    `;
  }

  function viewReference() {
    const tab = uiState.refTab || "dsa";

    const dsaPanel = `
      <div class="section-block">
        <p class="view-subtitle" style="margin-bottom:14px;">${esc(DSA_OS.intro)}</p>
        <div class="card">
          <table class="ref-table">
            <thead><tr><th>Result</th><th>Meaning</th><th>Required revisit</th></tr></thead>
            <tbody>
              ${DSA_OS.resultTable.map((r) => `
                <tr>
                  <td><span class="result-chip">${r.result}</span></td>
                  <td>${esc(r.meaning)}</td>
                  <td class="strong">${esc(r.revisit)}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="section-block">
        <div class="section-block-title">Every DSA answer must include</div>
        <div class="card">
          <div class="checklist checklist-grid">
            ${DSA_OS.mustInclude.map((label, i) => renderCheckItem({
              label, checked: state.dsaMustInclude[i], dataAttrs: { scope: "dsa-must", index: i },
            })).join("")}
          </div>
        </div>
      </div>
      <div class="section-block">
        <div class="section-block-title">Pattern prompts</div>
        <div class="card">
          <table class="ref-table">
            <thead><tr><th>Question signal</th><th>Likely pattern</th></tr></thead>
            <tbody>
              ${DSA_OS.patternPrompts.map((p) => `
                <tr><td>${esc(p.signal)}</td><td class="strong">${esc(p.pattern)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const contentPanel = `
      <div class="section-block">
        <p class="view-subtitle" style="margin-bottom:14px;">${esc(CONTENT_PATH.intro)}</p>
        <div class="card">
          <table class="ref-table">
            <thead><tr><th>Area</th><th>Primary resources</th></tr></thead>
            <tbody>
              ${CONTENT_PATH.resources.map((r) => `
                <tr><td class="strong">${esc(r.area)}</td><td>${esc(r.value)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="section-block">
        <div class="section-block-title">Dave Ebbelaar — where he fits</div>
        <div class="note-box">${esc(CONTENT_PATH.ebbelaarNote)}</div>
      </div>
      <div class="section-block">
        <div class="section-block-title">Content blacklist</div>
        <div class="card">
          <div class="checklist">
            ${CONTENT_PATH.blacklist.map((label, i) => renderCheckItem({
              label, checked: state.contentBlacklist[i], dataAttrs: { scope: "blacklist", index: i },
            })).join("")}
          </div>
        </div>
      </div>
    `;

    const contractPanel = `
      <div class="section-block">
        <div class="card">
          <table class="ref-table">
            <tbody>
              ${CONTRACT.rows.map((r) => `
                <tr><td class="strong">${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="section-block">
        <div class="section-block-title">Non-negotiable rules</div>
        <div class="card">
          <div class="checklist">
            ${CONTRACT.rules.map((label, i) => renderCheckItem({
              label, checked: state.rules[i], dataAttrs: { scope: "rules", index: i },
            })).join("")}
          </div>
        </div>
      </div>
      <div class="section-block">
        <div class="section-block-title">Daily completion definition</div>
        <div class="card">
          <ul style="margin:0;padding-left:18px;color:var(--text-secondary);font-size:13.5px;line-height:1.8;">
            ${DAILY_COMPLETION_DEFINITION.map((l) => `<li>${esc(l)}</li>`).join("")}
          </ul>
        </div>
      </div>
      <div class="section-block">
        <div class="quote-box">
          <div class="quote-label">The honest target</div>
          ${esc(CONTRACT.honestTarget)}
        </div>
      </div>
    `;

    return `
      <div class="view-header">
        <div class="eyebrow">Reference</div>
        <h1 class="view-title">Operating System</h1>
        <p class="view-subtitle">The rules, patterns and resources behind the roadmap — for lookup, not for logging.</p>
      </div>
      <div class="tabs">
        <button class="tab-btn ${tab === "dsa" ? "active" : ""}" data-nav="ref-tab" data-tab="dsa">DSA Operating System</button>
        <button class="tab-btn ${tab === "content" ? "active" : ""}" data-nav="ref-tab" data-tab="content">Curated Content Path</button>
        <button class="tab-btn ${tab === "contract" ? "active" : ""}" data-nav="ref-tab" data-tab="contract">The Contract</button>
      </div>
      <div class="tab-panel active">
        ${tab === "dsa" ? dsaPanel : tab === "content" ? contentPanel : contractPanel}
      </div>
    `;
  }

  function viewReadiness() {
    const done = countTrue(state.finalReadiness);
    const total = state.finalReadiness.length;
    const pct = Math.round((done / total) * 100);

    return `
      <div class="view-header">
        <div class="eyebrow">Day 49 Scorecard</div>
        <h1 class="view-title">Final Readiness</h1>
        <p class="view-subtitle">${esc(FINAL_READINESS.subtitle)}</p>
      </div>

      <div class="card" style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:18px;">
        ${ring(pct, "Readiness")}
        <div style="flex:1;min-width:220px;">
          <div class="card-title" style="margin-bottom:8px;">Proof checklist</div>
          <div class="card-meta">${done} of ${total} readiness items confirmed</div>
        </div>
      </div>

      <div class="card">
        <div class="checklist">
          ${FINAL_READINESS.items.map((label, i) => renderCheckItem({
            label, checked: state.finalReadiness[i], dataAttrs: { scope: "readiness", index: i },
          })).join("")}
        </div>
      </div>

      <div class="section-block" style="margin-top:20px;">
        <div class="section-block-title">Final positioning</div>
        <div class="note-box" style="font-weight:600;color:var(--text-primary);">${esc(FINAL_READINESS.positioning)}</div>
      </div>

      <div class="section-block">
        <div class="quote-box">
          <div class="quote-label">The standard</div>
          ${esc(FINAL_READINESS.standard)}
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // UI / routing state
  // ---------------------------------------------------------------------

  const uiState = {
    selectedDay: null,
    openWeek: null,
    refTab: "dsa",
  };

  function getSelectedDay() {
    if (uiState.selectedDay === null) {
      uiState.selectedDay = computeCurrentDayNumber();
    }
    return uiState.selectedDay;
  }

  function currentRoute() {
    const hash = window.location.hash.replace(/^#\/?/, "");
    return hash || "today";
  }

  const NAV_ITEMS = [
    { key: "today", label: "Today's Tasks", icon: "●" },
    { key: "progress", label: "Progress", icon: "◔" },
    { key: "roadmap", label: "Roadmap", icon: "▤" },
    { key: "reference", label: "Reference", icon: "▣" },
    { key: "readiness", label: "Final Readiness", icon: "✓" },
  ];

  function renderSidebar(route) {
    const overall = overallStats();
    const navHtml = NAV_ITEMS.map((item) => {
      const active = route === item.key || (item.key === "today" && route.startsWith("day/"));
      return `
        <a href="#/${item.key}" class="nav-item ${active ? "active" : ""}">
          <span>${item.label}</span>
        </a>`;
    }).join("");

    return `
      <div class="brand">
        <div class="brand-mark">
          <span class="brand-dot"></span>
          <span class="brand-name">Mirror49</span>
        </div>
        <span class="brand-tagline">49-day execution tracker</span>
      </div>
      <nav class="nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <div class="mini-progress">
          <span class="mini-progress-label">49-day progress</span>
          <span class="mini-progress-value">${overall.pct}%</span>
          <div class="bar-track"><div class="bar-fill" style="width:${overall.pct}%"></div></div>
        </div>
        <button class="reset-link" data-nav="reset">Reset all progress</button>
      </div>
    `;
  }

  function render() {
    const route = currentRoute();
    document.getElementById("sidebar").innerHTML = renderSidebar(route);

    let html;
    if (route === "today") {
      html = viewToday();
    } else if (route === "progress") {
      html = viewProgress();
    } else if (route === "roadmap") {
      html = viewRoadmap();
    } else if (route === "reference") {
      html = viewReference();
    } else if (route === "readiness") {
      html = viewReadiness();
    } else if (route.startsWith("day/")) {
      const n = parseInt(route.split("/")[1], 10);
      html = getDayDef(n) ? viewDayDetail(n) : viewToday();
    } else {
      html = viewToday();
    }
    document.getElementById("view").innerHTML = html;
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------------
  // Event delegation
  // ---------------------------------------------------------------------

  function toggleCheck(scope, a, b) {
    if (scope === "day-checklist") {
      state.days[a].checklist[b] = !state.days[a].checklist[b];
    } else if (scope === "day-dsa") {
      state.days[a].dsa[b] = !state.days[a].dsa[b];
    } else if (scope === "week-gate") {
      state.weekGates[a][b] = !state.weekGates[a][b];
    } else if (scope === "rules") {
      state.rules[b] = !state.rules[b];
    } else if (scope === "dsa-must") {
      state.dsaMustInclude[b] = !state.dsaMustInclude[b];
    } else if (scope === "blacklist") {
      state.contentBlacklist[b] = !state.contentBlacklist[b];
    } else if (scope === "readiness") {
      state.finalReadiness[b] = !state.finalReadiness[b];
    }
    saveState();
  }

  function handleClick(e) {
    if (e.target.closest("a.dsa-link")) return;

    const checkEl = e.target.closest(".check-item");
    if (checkEl && checkEl.dataset.scope) {
      const scope = checkEl.dataset.scope;
      const index = parseInt(checkEl.dataset.index, 10);
      const key = checkEl.dataset.day || checkEl.dataset.week || null;
      toggleCheck(scope, key !== null ? parseInt(key, 10) : null, index);
      render();
      return;
    }

    const navEl = e.target.closest("[data-nav]");
    if (navEl) {
      const nav = navEl.dataset.nav;
      if (nav === "prev-day") {
        uiState.selectedDay = Math.max(1, getSelectedDay() - 1);
        render();
      } else if (nav === "next-day") {
        uiState.selectedDay = Math.min(49, getSelectedDay() + 1);
        render();
      } else if (nav === "today") {
        uiState.selectedDay = computeCurrentDayNumber();
        render();
      } else if (nav === "toggle-week") {
        const w = parseInt(navEl.dataset.week, 10);
        uiState.openWeek = uiState.openWeek === w ? null : w;
        render();
      } else if (nav === "open-week") {
        e.preventDefault();
        uiState.openWeek = parseInt(navEl.dataset.week, 10);
        window.location.hash = "#/roadmap";
        render();
      } else if (nav === "open-day") {
        const d = parseInt(navEl.dataset.day, 10);
        window.location.hash = `#/day/${d}`;
      } else if (nav === "ref-tab") {
        uiState.refTab = navEl.dataset.tab;
        render();
      } else if (nav === "reset") {
        resetAllProgress();
      } else if (nav === "toggle-resource") {
        const key = navEl.dataset.key;
        state.resources[key] = !state.resources[key];
        saveState();
        render();
      } else if (nav === "toggle-dsa-primer") {
        const key = navEl.dataset.key;
        state.dsaPrimer[key] = !state.dsaPrimer[key];
        saveState();
        render();
      }
    }
  }

  function handleKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("a")) return;
    const checkEl = e.target.closest(".check-item, .resource-watched");
    if (!checkEl) return;
    e.preventDefault();
    checkEl.click();
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  function init() {
    document.getElementById("app-root").addEventListener("click", handleClick);
    document.getElementById("app-root").addEventListener("keydown", handleKeydown);
    window.addEventListener("hashchange", render);
    if (!window.location.hash) window.location.hash = "#/today";
    uiState.openWeek = getDayDef(computeCurrentDayNumber()).week;
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
