
"use strict";

/*
  Taylorville SGL App Leaderboards

  Uses existing standings.js for league scores.
  Uses the same Par 3 calculations as index.html.

  Does not modify skins.js or the original website.
*/

(() => {
  const API = "https://xgjziyopzeeneccfaszb.supabase.co";
  const KEY = "sb_publishable_7ttHIcbCVOCv1rJlWpq0AA_59y0Tw7O";

  const $ = id => document.getElementById(id);

  const esc = value => String(value ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]
  );

  const isScore = value =>
    typeof value === "number" &&
    Number.isFinite(value);

  let db = null;
  let currentWeek = null;
  let currentMode = "gross";
  let seasonMode = "gross";
  let archiveMode = "gross";
  let archiveCategory = "individual";
  let archiveWeek = null;

  let par3Shots = [];
  let par3Weeks = [];
  let par3Mode = "weekly";
  let par3Week = null;
  let par3ManualWeek = false;

  let leagueError = "";
  let par3Error = "";
  let par3Loading = false;

  function panel(title, content) {
    return `
      <div class="panel">
        <h2>${title}</h2>
        ${content}
      </div>
    `;
  }

  function table(headers, rows, columns = headers.length) {
    return `
      <div style="overflow-x:auto">
        <table class="app-data-table">
          <thead>
            <tr>${headers.map(h =>
              `<th>${esc(h)}</th>`
            ).join("")}</tr>
          </thead>
          <tbody>
            ${rows || `
              <tr>
                <td colspan="${columns}" class="app-empty">
                  No results available.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    `;
  }

  function tabs(items, active, action) {
    return `
      <div class="tabs">
        ${items.map(item => `
          <button
            type="button"
            class="${item.value === active ? "active" : ""}"
            data-sgl-action="${action}"
            data-value="${item.value}">
            ${esc(item.label)}
          </button>
        `).join("")}
      </div>
    `;
  }

  function rankedRows(items, field, renderer) {
    let last = null;
    let rank = 0;

    return items.map((item, index) => {
      if (last === null || item[field] !== last) {
        rank = index + 1;
      }
      last = item[field];
      return renderer(item, rank);
    }).join("");
  }

  function scoreSort(a, b, field) {
    return a[field] - b[field] ||
      String(a.username || a.team)
        .localeCompare(String(b.username || b.team));
  }

  function handicap(value) {
    const n = Number(value);
    return value == null || value === "" ||
      !Number.isFinite(n) ? "—" : n.toFixed(1);
  }

  function currentWeekFrom(weeks) {
    const unfinished = weeks
      .filter(w => !w.finalized)
      .map(w => Number(w.week_number))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    return unfinished[0] ??
      Math.max(
        0,
        ...weeks.map(w => Number(w.week_number) || 0)
      ) + 1;
  }

  function completedWeeks() {
    return (db?.weeks || [])
      .filter(w => w.finalized)
      .sort((a, b) =>
        Number(a.week_number) - Number(b.week_number)
      );
  }

  function weekScores(number) {
    return (db?.scores || []).filter(s =>
      Number(s.week_number) === Number(number) &&
      String(s.status || "played")
        .trim().toLowerCase() === "played"
    );
  }

  function teamAssignments() {
    const names = new Map(
      db.teams.map(t => [
        String(t.id),
        t.team_name
      ])
    );

    return new Map(
      db.players.map(p => [
        String(p.username || "").trim().toLowerCase(),
        names.get(String(p.team_id)) || "Unassigned"
      ])
    );
  }

  function teamResults(weekNumber) {
    const teams = new Map(
      db.teams.map(t => [
        t.team_name,
        {
          team: t.team_name,
          total: 0,
          count: 0
        }
      ])
    );

    const assignments = teamAssignments();

    for (const score of weekScores(weekNumber)) {
      const key = String(score.username || "")
        .trim().toLowerCase();

      const team = teams.get(assignments.get(key));

      if (team && isScore(score.net_strokes)) {
        team.total += score.net_strokes;
        team.count++;
      }
    }

    return [...teams.values()]
      .map(t => ({
        ...t,
        complete: t.count === 4
      }))
      .sort((a, b) =>
        Number(b.complete) - Number(a.complete) ||
        (a.complete ? a.total : Infinity) -
        (b.complete ? b.total : Infinity) ||
        a.team.localeCompare(b.team)
      );
  }

  function seasonPlayers() {
    const players = new Map();
    const assignments = teamAssignments();

    for (const week of completedWeeks()) {
      for (const score of weekScores(week.week_number)) {
        if (
          !isScore(score.gross_strokes) ||
          !isScore(score.net_strokes)
        ) continue;

        const key = String(score.username || "")
          .trim().toLowerCase();

        if (!players.has(key)) {
          players.set(key, {
            username: score.username,
            team: assignments.get(key) || "Unassigned",
            rounds: 0,
            gross_strokes: 0,
            net_strokes: 0
          });
        }

        const p = players.get(key);
        p.rounds++;
        p.gross_strokes += score.gross_strokes;
        p.net_strokes += score.net_strokes;
      }
    }

    return [...players.values()];
  }

  function seasonTeams() {
    const completed = completedWeeks();

    const totals = new Map(
      db.teams.map(t => [
        t.team_name,
        {
          team: t.team_name,
          weeks: 0,
          total: 0
        }
      ])
    );

    for (const week of completed) {
      for (const team of teamResults(week.week_number)) {
        if (!team.complete) continue;

        const target = totals.get(team.team);
        target.weeks++;
        target.total += team.total;
      }
    }

    return [...totals.values()].sort((a, b) =>
      b.weeks - a.weeks ||
      a.total - b.total ||
      a.team.localeCompare(b.team)
    );
  }

  function renderStandings() {
    const root = $("sglAppStandings");
    if (!root) return;

    if (!db) {
      root.innerHTML = panel(
        "League Standings",
        `<p>${esc(leagueError || "Loading league standings…")}</p>`
      );
      return;
    }

    const currentField = currentMode + "_strokes";

    const current = weekScores(currentWeek)
      .filter(s => isScore(s[currentField]))
      .sort((a, b) => scoreSort(a, b, currentField));

    const currentRows = rankedRows(
      current,
      currentField,
      (s, rank) => `
        <tr>
          <td class="tag">${rank}</td>
          <td>${esc(s.username)}</td>
          <td>${handicap(s.handicap)}</td>
          <td><strong>${s[currentField]}</strong></td>
        </tr>
      `
    );

    const seasonField = seasonMode + "_strokes";

    const season = seasonPlayers()
      .sort((a, b) => scoreSort(a, b, seasonField));

    const seasonRows = rankedRows(
      season,
      seasonField,
      (p, rank) => `
        <tr>
          <td class="tag">${rank}</td>
          <td>${esc(p.username)}</td>
          <td>${esc(p.team)}</td>
          <td>${p.rounds}</td>
          <td><strong>${p[seasonField]}</strong></td>
          <td>${(p[seasonField] / p.rounds).toFixed(2)}</td>
        </tr>
      `
    );

    root.innerHTML =
      panel(
        `Current Week · Week ${currentWeek}`,
        tabs([
          {value:"gross",label:"Gross"},
          {value:"net",label:"Net"}
        ], currentMode, "current-mode") +
        table(
          ["POS","PLAYER","HCP",currentMode.toUpperCase()],
          currentRows
        ) +
        `<p class="muted">Combined scores from the current week.</p>`
      ) +
      panel(
        "Individual Season Standings",
        tabs([
          {value:"gross",label:"Gross"},
          {value:"net",label:"Net"}
        ], seasonMode, "season-mode") +
        table(
          ["POS","PLAYER","TEAM","ROUNDS","TOTAL","AVG"],
          seasonRows
        ) +
        `<p class="muted">
          Cumulative strokes from finalized weeks only.
        </p>`
      ) +
      panel(
        "Team Season Standings",
        renderSeasonTeamTable()
      );
  }

  function renderSeasonTeamTable() {
    if (!db) return "";

    const completed = completedWeeks();

    const rows = seasonTeams().map((t, i) => `
      <tr>
        <td class="tag">${t.weeks ? i + 1 : "—"}</td>
        <td>${esc(t.team)}</td>
        <td>${t.weeks}</td>
        <td>${t.weeks ? t.total : "—"}</td>
        <td>${
          t.weeks === completed.length
            ? "Complete"
            : "Incomplete"
        }</td>
      </tr>
    `).join("");

    return table(
      ["POS","TEAM","WEEKS","NET","STATUS"],
      rows
    );
  }

  function renderTeams() {
    const root = $("sglAppTeams");
    if (!root) return;

    if (!db) {
      root.innerHTML = panel(
        "Team Standings",
        `<p>${esc(leagueError || "Loading teams…")}</p>`
      );
      return;
    }

    const weekly = teamResults(currentWeek);

    const weeklyRows = weekly.map((t, i) => `
      <tr>
        <td class="tag">${t.complete ? i + 1 : "—"}</td>
        <td>${esc(t.team)}</td>
        <td>${t.count}/4</td>
        <td>${
          t.count
            ? (t.total > 0 ? "+" : "") + t.total
            : "—"
        }</td>
        <td>${t.complete ? "Complete" : "Pending"}</td>
      </tr>
    `).join("");

    root.innerHTML =
      panel(
        `Weekly Team Standings · Week ${currentWeek}`,
        table(
          ["POS","TEAM","FINISHED","NET","STATUS"],
          weeklyRows
        ) +
        `<p class="muted">
          All four golfers must finish for a complete team score.
        </p>`
      ) +
      panel(
        "Season Team Standings",
        renderSeasonTeamTable()
      );
  }

  function renderArchives() {
    const root = $("sglAppArchives");
    if (!root) return;

    if (!db) {
      root.innerHTML = panel(
        "Results Archive",
        `<p>${esc(leagueError || "Loading results…")}</p>`
      );
      return;
    }

    const completed = completedWeeks();

    if (!completed.some(w =>
      Number(w.week_number) === Number(archiveWeek)
    )) {
      archiveWeek =
        completed.at(-1)?.week_number ?? null;
    }

    const weekOptions = completed.map(w => `
      <option value="${Number(w.week_number)}"
        ${Number(w.week_number) === Number(archiveWeek)
          ? "selected" : ""}>
        Week ${Number(w.week_number)}
        ${w.course_name ? " · " + esc(w.course_name) : ""}
      </option>
    `).join("");

    let archiveTable = "";

    if (archiveWeek == null) {
      archiveTable = `<p class="muted">
        No finalized weeks yet.
      </p>`;
    } else if (archiveCategory === "individual") {
      const field = archiveMode + "_strokes";

      const scores = weekScores(archiveWeek)
        .filter(s => isScore(s[field]))
        .sort((a, b) => scoreSort(a, b, field));

      archiveTable = table(
        ["POS","PLAYER","HCP","STROKES"],
        rankedRows(scores, field, (s, rank) => `
          <tr>
            <td class="tag">${rank}</td>
            <td>${esc(s.username)}</td>
            <td>${handicap(s.handicap)}</td>
            <td>${s[field]}</td>
          </tr>
        `)
      );
    } else {
      archiveTable = table(
        ["POS","TEAM","PLAYERS","NET"],
        teamResults(archiveWeek).map((t, i) => `
          <tr>
            <td class="tag">${t.complete ? i + 1 : "—"}</td>
            <td>${esc(t.team)}</td>
            <td>${t.count}/4</td>
            <td>${t.complete ? t.total : "Incomplete"}</td>
          </tr>
        `).join("")
      );
    }

    const schedule = [...db.weeks]
      .sort((a, b) =>
        Number(a.week_number) - Number(b.week_number)
      )
      .map(w => {
        const n = Number(w.week_number);
        const status = w.finalized
          ? "Finalized"
          : n === Number(currentWeek)
            ? "Current week"
            : "Upcoming";

        return `
          <div class="row">
            <div>
              <strong>Week ${n}</strong>
              <div class="muted">
                ${status}
                ${w.course_name
                  ? " · " + esc(w.course_name)
                  : ""}
                · ${weekScores(n).length} recorded rounds
              </div>
            </div>
            ${w.finalized ? `
              <button class="app-small-btn"
                data-sgl-action="open-archive"
                data-value="${n}">
                Results
              </button>
            ` : ""}
          </div>
        `;
      }).join("");

    root.innerHTML =
      panel(
        `Weekly Results · ${completed.length} Completed`,
        `
          <select class="app-select"
            id="sglArchiveWeek"
            aria-label="Completed week">
            ${weekOptions}
          </select>

          ${tabs([
            {value:"individual",label:"Individuals"},
            {value:"teams",label:"Teams"}
          ], archiveCategory, "archive-category")}

          ${archiveCategory === "individual"
            ? tabs([
                {value:"gross",label:"Gross"},
                {value:"net",label:"Net"}
              ], archiveMode, "archive-mode")
            : ""}

          ${archiveTable}
        `
      ) +
      panel(
        "Tournament Schedule",
        schedule || `<p>No weeks available.</p>`
      );
  }

  function par3Normalize(name) {
    return String(name || "")
      .replace(/\s+/g, "")
      .toLowerCase();
  }

  function par3Better(a, b) {
    return a.distance_ft < b.distance_ft ||
      (
        a.distance_ft === b.distance_ft &&
        (
          a.week_number < b.week_number ||
          (
            a.week_number === b.week_number &&
            (
              a.hole_number < b.hole_number ||
              (
                a.hole_number === b.hole_number &&
                a.tournament_id < b.tournament_id
              )
            )
          )
        )
      );
  }

  function par3BestShots(shots) {
    const best = new Map();

    for (const shot of shots) {
      const key = par3Normalize(shot.username);
      if (!key) continue;

      const previous = best.get(key);

      if (!previous || par3Better(shot, previous)) {
        best.set(key, shot);
      }
    }

    return [...best.values()].sort((a, b) =>
      a.distance_ft - b.distance_ft ||
      a.username.localeCompare(b.username)
    );
  }

  function renderPar3() {
    const root = $("sglAppPar3");
    if (!root) return;

    const weekly = par3Mode === "weekly";

    const numbers = [...new Set(
      par3Weeks.map(w => Number(w.week_number))
        .filter(n => Number.isInteger(n) && n > 0)
    )].sort((a, b) => a - b);

    if (!numbers.length) {
      numbers.push(...[...new Set(
        par3Shots.map(s => s.week_number)
      )].sort((a, b) => a - b));
    }

    const activeWeek = par3Weeks
      .filter(w => w.finalized === false)
      .map(w => Number(w.week_number))
      .filter(n => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b)[0] ??
      numbers.at(-1) ??
      null;

    if (
      !par3ManualWeek ||
      !numbers.includes(par3Week)
    ) {
      par3Week = activeWeek;
      par3ManualWeek = false;
    }

    const relevant = weekly
      ? par3Shots.filter(s => s.week_number === par3Week)
      : par3Shots;

    const ranked = par3BestShots(relevant);

    const rows = rankedRows(
      ranked,
      "distance_ft",
      (s, rank) => `
        <tr>
          <td class="tag">${rank}</td>
          <td>${esc(s.username)}</td>
          ${weekly ? "" : `<td>Week ${s.week_number}</td>`}
          <td>${s.hole_number}</td>
          <td class="tag">${s.distance_ft.toFixed(2)} ft</td>
        </tr>
      `
    );

    root.innerHTML = panel(
      "Closest to the Pin",
      `
        <p class="muted">
          Each golfer's single closest recorded shot counts.
          Equal distances share rank.
        </p>

        ${tabs([
          {value:"weekly",label:"Weekly"},
          {value:"season",label:"Season"}
        ], par3Mode, "par3-mode")}

        ${weekly ? `
          <select id="sglPar3Week" class="app-select">
            ${numbers.map(n => `
              <option value="${n}"
                ${n === par3Week ? "selected" : ""}>
                Week ${n}${n === activeWeek
                  ? " · Current" : ""}
              </option>
            `).join("")}
          </select>
        ` : ""}

        <p class="muted">
          ${par3Error
            ? esc(par3Error)
            : `${weekly ? `Week ${par3Week ?? "—"}` : "Season"}
               · ${ranked.length} golfers with recorded shots`}
        </p>

        ${table(
          weekly
            ? ["POS","PLAYER","HOLE","DISTANCE"]
            : ["POS","PLAYER","WEEK","HOLE","DISTANCE"],
          rows,
          weekly ? 4 : 5
        )}
      `
    );
  }

  async function fetchPar3(table, select) {
    const params = new URLSearchParams({
      select,
      limit: "10000"
    });

    const response = await fetch(
      `${API}/rest/v1/${table}?${params}`,
      {
        headers: {
          apikey: KEY,
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        `${table}: HTTP ${response.status}`
      );
    }

    return response.json();
  }

  async function loadPar3() {
    if (par3Loading) return;
    par3Loading = true;

    try {
      const [shots, weeks] = await Promise.all([
        fetchPar3(
          "sgl_par3_shots",
          "week_number,tournament_id,username,hole_number,distance_ft"
        ),
        fetchPar3(
          "sgl_weeks",
          "week_number,finalized"
        )
      ]);

      par3Shots = shots.map(s => ({
        week_number: Number(s.week_number),
        tournament_id: Number(s.tournament_id),
        username: String(s.username || ""),
        hole_number: Number(s.hole_number),
        distance_ft: Number(s.distance_ft)
      })).filter(s =>
        Number.isInteger(s.week_number) &&
        Number.isInteger(s.hole_number) &&
        s.hole_number >= 1 &&
        s.hole_number <= 18 &&
        Number.isFinite(s.distance_ft) &&
        s.distance_ft >= 0 &&
        s.username
      );

      par3Weeks = weeks;
      par3Error = "";

    } catch (error) {
      console.error("App Par 3 error:", error);
      par3Error = error.message;

    } finally {
      par3Loading = false;
      renderPar3();
    }
  }

  function renderAll() {
    renderStandings();
    renderTeams();
    renderArchives();
    renderPar3();
  }

  function setupScreens() {
    const mappings = [
      ["standings", "sglAppStandings"],
      ["teams", "sglAppTeams"],
      ["archives", "sglAppArchives"],
      ["par3", "sglAppPar3"]
    ];

    for (const [screenId, containerId] of mappings) {
      const screen = $(screenId);
      if (!screen) continue;

      const body = screen.querySelector(".body");
      if (!body) continue;

      body.innerHTML = `<div id="${containerId}"></div>`;
    }

    const style = document.createElement("style");
    style.textContent = `
      .app-data-table{
        width:100%;
        border-collapse:collapse;
        font-size:12px;
      }
      .app-data-table th{
        text-align:left;
        color:#e8c879;
        font-size:10px;
        padding:10px 6px;
        background:#082c1d;
        white-space:nowrap;
      }
      .app-data-table td{
        padding:11px 6px;
        border-bottom:1px solid #bda16633;
        overflow-wrap:anywhere;
      }
      .app-data-table th:last-child,
      .app-data-table td:last-child{
        text-align:right;
      }
      .app-data-table .tag{
        color:#e8c879;
        font-weight:800;
      }
      .app-empty{
        text-align:center!important;
        padding:20px!important;
        color:#c9d2c7;
      }
      .app-select{
        width:100%;
        padding:12px;
        margin:0 0 14px;
        border:1px solid #bda166;
        border-radius:7px;
        background:#082c1d;
        color:#fff;
        font:inherit;
      }
      .app-small-btn{
        border:1px solid #bda166;
        border-radius:7px;
        background:#123e29;
        color:#f0d28b;
        padding:8px 11px;
      }
      .app-data-table tbody tr:nth-child(even){
        background:#ffffff08;
      }
    `;
    document.head.appendChild(style);
  }

  document.addEventListener("click", event => {
    const button = event.target.closest(
      "[data-sgl-action]"
    );

    if (!button) return;

    const action = button.dataset.sglAction;
    const value = button.dataset.value;

    if (action === "current-mode") {
      currentMode = value;
      renderStandings();
    }

    if (action === "season-mode") {
      seasonMode = value;
      renderStandings();
    }

    if (action === "archive-mode") {
      archiveMode = value;
      renderArchives();
    }

    if (action === "archive-category") {
      archiveCategory = value;
      renderArchives();
    }

    if (action === "par3-mode") {
      par3Mode = value;
      renderPar3();
    }

    if (action === "open-archive") {
      archiveWeek = Number(value);
      archiveCategory = "individual";
      renderArchives();

      $("sglAppArchives")?.scrollIntoView({
        behavior: "smooth"
      });
    }
  });

  document.addEventListener("change", event => {
    if (event.target.id === "sglArchiveWeek") {
      archiveWeek = Number(event.target.value);
      renderArchives();
    }

    if (event.target.id === "sglPar3Week") {
      par3Week = Number(event.target.value);
      par3ManualWeek = true;
      renderPar3();
    }
  });

  window.addEventListener(
    "sgl-current-ready",
    event => {
      if (db?.players?.length) return;

      const data = event.detail;
      currentWeek = Number(data.currentWeek);

      db = {
        players: [],
        teams: [],
        weeks: data.weeks,
        scores: data.scores
      };

      renderStandings();
    }
  );

  window.addEventListener(
    "sgl-standings-loaded",
    event => {
      db = event.detail;
      currentWeek = currentWeekFrom(db.weeks);
      leagueError = "";
      renderAll();
    }
  );

  window.addEventListener(
    "sgl-standings-refreshed",
    event => {
      db = {
        players: event.detail.players,
        teams: event.detail.teams,
        weeks: event.detail.weeks,
        scores: event.detail.scores
      };

      currentWeek = Number(event.detail.currentWeek);
      leagueError = "";
      renderAll();
    }
  );

  async function startStandings() {
    try {
      if (typeof window.loadSGLStandings !== "function") {
        await new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "standings.js?v=3";
          script.onload = resolve;
          script.onerror = () => reject(
            new Error("Could not load standings.js")
          );
          document.head.appendChild(script);
        });
      }

      if (window.SGL_DB) {
        db = window.SGL_DB;
        currentWeek = currentWeekFrom(db.weeks);
        renderAll();
      } else {
        await window.loadSGLStandings();
      }

    } catch (error) {
      console.error("App standings error:", error);
      leagueError = error.message;
      renderAll();
    }
  }

  setupScreens();
  renderAll();

  startStandings();
  loadPar3();

  setInterval(() => {
    if (document.visibilityState !== "visible") return;

    if (typeof window.refreshSGLStandings === "function") {
      window.refreshSGLStandings();
    }

    loadPar3();
  }, 60000);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState !== "visible") return;

      if (typeof window.refreshSGLStandings === "function") {
        window.refreshSGLStandings();
      }

      loadPar3();
    }
  );
})();
