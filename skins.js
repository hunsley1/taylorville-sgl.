"use strict";

(() => {
  const API = "https://xgjziyopzeeneccfaszb.supabase.co";
  const KEY = "sb_publishable_7ttHIcbCVOCv1rJlWpq0AA_59y0Tw7O";

  const $ = id => document.getElementById(id);

  const escapeHTML = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[c]
    );

  let holes = [];
  let cards = [];
  let weeks = [];
  let players = [];

  let selectedWeek = null;
  let selectedSessionId = null;
  let mode = "weekly";
  let loaded = false;
  let error = "";
  let manualWeekSelection = false;

  let requestVersion = 0;
  let loading = false;
  let switchingSession = false;

  const validWeek = n =>
    Number.isInteger(n) && n > 0;

  const orders = {
    sgl_sessions:
      "season_year.desc,session_number.desc,id.desc",
    sgl_skins:
      "week_number.asc,hole_number.asc",
    sgl_skins_player_scores:
      "week_number.asc,username.asc",
    sgl_weeks:
      "week_number.asc",
    sgl_players:
      "username.asc"
  };

  // ==========================================
  // DATABASE CONNECTION
  // ==========================================

  async function get(
    table,
    columns,
    sessionId = null
  ) {
    const rows = [];
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        select: columns,
        limit: "500",
        offset: String(offset),
        order: orders[table]
      });

      if (table !== "sgl_sessions") {
        if (sessionId === null) {
          throw new Error(
            "No league session selected"
          );
        }

        params.set(
          "session_id",
          "eq." + sessionId
        );
      }

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

      const page = await response.json();

      if (!Array.isArray(page)) {
        throw new Error(
          `Invalid response from ${table}`
        );
      }

      if (!page.length) break;

      rows.push(...page);
      offset += page.length;
    }

    return rows;
  }

  // ==========================================
  // SESSION MANAGEMENT
  // ==========================================

  async function resolveSession() {
    if (
      typeof window.sglGetSelectedSession
        === "function"
    ) {
      const selected =
        window.sglGetSelectedSession();

      if (selected) return selected.id;
    }

    if (window.SGL_DB?.session_id != null) {
      return window.SGL_DB.session_id;
    }

    const sessions = await get(
      "sgl_sessions",
      "id,season_year,session_number,status"
    );

    const session =
      sessions.find(
        s => s.status === "active"
      ) ||
      sessions.find(
        s => s.status === "completed"
      );

    if (!session) {
      throw new Error(
        "No available league sessions"
      );
    }

    return session.id;
  }

  function resetSession(sessionId) {
    selectedSessionId = sessionId;

    holes = [];
    cards = [];
    weeks = [];
    players = [];

    selectedWeek = null;
    manualWeekSelection = false;

    loaded = false;
    error = "";

    $("skinsWeek").innerHTML =
      '<option value="">Loading…</option>';

    $("skinsWeek").disabled = true;

    render();
  }

  // ==========================================
  // LEADERBOARD DISPLAY
  // ==========================================

  function setTabs() {
    $("skinsWeeklyBtn").classList.toggle(
      "active",
      mode === "weekly"
    );

    $("skinsSeasonBtn").classList.toggle(
      "active",
      mode === "season"
    );

    $("skinsWeek").style.display =
      mode === "weekly" ? "" : "none";
  }

  function rankRows(
    items,
    scoreField,
    rowFn
  ) {
    let rank = 0;
    let last = null;

    return items.map((item, i) => {
      if (
        last === null ||
        item[scoreField] !== last
      ) {
        rank = i + 1;
      }

      last = item[scoreField];

      return rowFn(item, rank);
    }).join("");
  }

  function renderWeeklyLeaders() {
    const container =
      $("skinsWeeklySummary");

    const body =
      $("skinsWeeklyLeaders");

    if (!container || !body) return;

    container.style.display =
      mode === "weekly" ? "" : "none";

    if (mode !== "weekly") return;

    if (!loaded || error) {
      body.innerHTML = `<tr>
<td colspan="4" class="empty">
${escapeHTML(error || "Loading…")}
</td>
</tr>`;

      return;
    }

    const totals = new Map();

    for (const hole of holes) {
      if (
        hole.week_number !== selectedWeek ||
        !hole.winner_username ||
        hole.skins_awarded <= 0
      ) continue;

      const key = hole.winner_username
        .trim()
        .toLowerCase();

      if (!totals.has(key)) {
        totals.set(key, {
          username: hole.winner_username,
          holesWon: 0,
          skins: 0
        });
      }

      const player = totals.get(key);

      player.holesWon++;
      player.skins += hole.skins_awarded;
    }

    const ranked = [...totals.values()]
      .sort((a, b) =>
        b.skins - a.skins ||
        a.username.localeCompare(b.username)
      );

    body.innerHTML = ranked.length
      ? rankRows(
          ranked,
          "skins",
          (player, rank) => `
<tr>
<td class="tag">${rank}</td>
<td>${escapeHTML(player.username)}</td>
<td>${player.holesWon}</td>
<td class="tag">${player.skins}</td>
</tr>`
        )
      : `<tr>
<td colspan="4" class="empty">
No skins winners recorded yet.
</td>
</tr>`;
  }

  function render() {
    setTabs();
    renderWeeklyLeaders();

    const weekly = mode === "weekly";

    const week = weeks.find(
      w => w.week_number === selectedWeek
    );

    $("skinsHead").innerHTML = weekly
      ? `<tr>
<th>HOLE</th>
<th>WINNER</th>
<th>GROSS</th>
<th>SKINS</th>
</tr>`
      : `<tr>
<th>POS</th>
<th>PLAYER</th>
<th>WEEKS WON</th>
<th>SKINS</th>
</tr>`;

    $("skinsFootnote").textContent = weekly
      ? `Week ${selectedWeek ?? "—"}: gross skins from both tournaments combined. Ties carry forward; unclaimed skins after hole 18 expire. ${
          week?.finalized
            ? "Finalized week."
            : "Provisional until the week is finalized."
        }`
      : "Official season totals include finalized weeks only. Provisional weekly skins are excluded.";

    if (error || !loaded) {
      $("skinsStatus").textContent = error
        ? "Unable to load skins results."
        : "Loading gross skins…";

      $("skinsBody").innerHTML = `
<tr>
<td colspan="4" class="empty${error ? " error" : ""}">
${escapeHTML(error || "Loading…")}
</td>
</tr>`;

      return;
    }

    if (weekly) {
      const rows = holes
        .filter(
          h => h.week_number === selectedWeek
        )
        .sort((a, b) =>
          a.hole_number - b.hole_number
        );

      const entrants = new Set(
        cards
          .filter(
            c => c.week_number === selectedWeek
          )
          .map(
            c => c.username?.trim().toLowerCase()
          )
          .filter(Boolean)
      ).size;

      const awarded = rows.reduce(
        (sum, h) => sum + h.skins_awarded,
        0
      );

      $("skinsStatus").textContent =
        `Week ${selectedWeek ?? "—"} · ${entrants} of ${
          players.length || "?"
        } league players finished · ${awarded} skins awarded · ${
          week?.finalized
            ? "Finalized"
            : "Provisional"
        }`;

      $("skinsBody").innerHTML = rows.length
        ? rows.map(h => `
<tr>
<td class="tag">${h.hole_number}</td>
<td>${
  h.is_tied
    ? "Tied"
    : escapeHTML(h.winner_username || "—")
}</td>
<td>${h.winning_score ?? "—"}</td>
<td class="tag">${
  h.is_tied
    ? "Carry " + h.carryover
    : h.skins_awarded || "—"
}</td>
</tr>`).join("")
        : `<tr>
<td colspan="4" class="empty">
No skins calculated for this week yet.
</td>
</tr>`;

    } else {
      const finalized = new Set(
        weeks
          .filter(w => w.finalized)
          .map(w => w.week_number)
      );

      const totals = new Map();

      for (const h of holes) {
        if (
          !finalized.has(h.week_number) ||
          !h.winner_username ||
          h.skins_awarded <= 0
        ) continue;

        const key =
          h.winner_username
            .trim()
            .toLowerCase();

        if (!totals.has(key)) {
          totals.set(key, {
            username: h.winner_username,
            skins: 0,
            weekSet: new Set()
          });
        }

        const item = totals.get(key);

        item.skins += h.skins_awarded;
        item.weekSet.add(h.week_number);
      }

      const ranked = [...totals.values()]
        .sort((a, b) =>
          b.skins - a.skins ||
          a.username.localeCompare(b.username)
        );

      $("skinsStatus").textContent =
        `Season · ${finalized.size} finalized week${
          finalized.size === 1 ? "" : "s"
        } · ${ranked.length} skins winners`;

      $("skinsBody").innerHTML = ranked.length
        ? rankRows(
            ranked,
            "skins",
            (p, rank) => `
<tr>
<td class="tag">${rank}</td>
<td>${escapeHTML(p.username)}</td>
<td>${p.weekSet.size}</td>
<td class="tag">${p.skins}</td>
</tr>`
          )
        : `<tr>
<td colspan="4" class="empty">
No finalized skins winners yet.
</td>
</tr>`;
    }
  }

  // ==========================================
  // LOAD SELECTED SESSION
  // ==========================================

  async function load(
    requestedSessionId = null,
    force = false
  ) {
    if (
      switchingSession &&
      requestedSessionId === null
    ) return;

    if (loading && !force) return;

    const version = ++requestVersion;

    loading = true;

    try {
      const sessionId =
        requestedSessionId ??
        await resolveSession();

      if (version !== requestVersion) {
        return;
      }

      if (
        String(selectedSessionId) !==
        String(sessionId)
      ) {
        resetSession(sessionId);
      }

      const [
        rawHoles,
        rawCards,
        rawWeeks,
        rawPlayers
      ] = await Promise.all([
        get(
          "sgl_skins",
          "week_number,hole_number,winner_username,winning_score,skins_awarded,carryover,is_tied",
          sessionId
        ),

        get(
          "sgl_skins_player_scores",
          "week_number,username",
          sessionId
        ),

        get(
          "sgl_weeks",
          "week_number,finalized",
          sessionId
        ),

        get(
          "sgl_players",
          "username",
          sessionId
        )
      ]);

      // Ignore outdated requests after
      // a visitor switches sessions.

      if (version !== requestVersion) {
        return;
      }

      holes = rawHoles.map(h => ({
        week_number: Number(h.week_number),

        hole_number: Number(h.hole_number),

        winner_username: h.winner_username,

        winning_score:
          h.winning_score == null
            ? null
            : Number(h.winning_score),

        skins_awarded:
          Number(h.skins_awarded) || 0,

        carryover:
          Number(h.carryover) || 0,

        is_tied: h.is_tied === true

      })).filter(h =>
        validWeek(h.week_number) &&
        h.hole_number >= 1 &&
        h.hole_number <= 18
      );

      cards = rawCards.map(c => ({
        week_number: Number(c.week_number),
        username: c.username
      }));

      weeks = rawWeeks.map(w => ({
        week_number: Number(w.week_number),
        finalized: w.finalized === true
      }))
      .filter(w => validWeek(w.week_number))
      .sort((a, b) =>
        a.week_number - b.week_number
      );

      players = rawPlayers;

      const unfinishedWeek = weeks.find(
        w => !w.finalized
      )?.week_number ?? null;

      const activeWeek =
        unfinishedWeek ??
        weeks.at(-1)?.week_number ??
        null;

      if (
        !manualWeekSelection ||
        !weeks.some(
          w => w.week_number === selectedWeek
        )
      ) {
        selectedWeek = activeWeek;
        manualWeekSelection = false;
      }

      const available = new Set(
        holes.map(h => h.week_number)
      );

      $("skinsWeek").innerHTML =
        weeks.map(w => `
<option value="${w.week_number}">
Week ${w.week_number}${
  w.week_number === unfinishedWeek
    ? " · Current"
    : available.has(w.week_number)
      ? " · Results"
      : ""
}
</option>`).join("");

      $("skinsWeek").disabled =
        weeks.length === 0;

      if (selectedWeek !== null) {
        $("skinsWeek").value =
          String(selectedWeek);
      }

      loaded = true;
      error = "";

    } catch (e) {
      if (version !== requestVersion) {
        return;
      }

      error = e.message;

      console.error(
        "Taylorville SGL skins error:",
        e
      );

    } finally {
      if (version === requestVersion) {
        loading = false;
        render();
      }
    }
  }

  // ==========================================
  // BUTTONS AND WEEK SELECTOR
  // ==========================================

  $("skinsWeeklyBtn").onclick = () => {
    mode = "weekly";
    render();
  };

  $("skinsSeasonBtn").onclick = () => {
    mode = "season";
    render();
  };

  $("skinsWeek").onchange = e => {
    selectedWeek = Number(e.target.value);
    manualWeekSelection = true;
    render();
  };

  // ==========================================
  // SHARED WEBSITE AND APP SESSION EVENTS
  // ==========================================

  window.addEventListener(
    "sgl-session-loading",
    event => {
      switchingSession = true;

      ++requestVersion;
      loading = false;

      resetSession(
        event.detail.session.id
      );
    }
  );

  window.addEventListener(
    "sgl-standings-loaded",
    event => {
      const sessionId =
        event.detail.session_id;

      if (sessionId == null) return;

      switchingSession = false;

      load(sessionId, true);
    }
  );

  window.addEventListener(
    "sgl-session-changed",
    event => {
      switchingSession = false;

      const sessionId =
        event.detail.session.id;

      if (
        String(sessionId) !==
          String(selectedSessionId) ||
        (!loaded && !loading)
      ) {
        load(sessionId, true);
      }
    }
  );

  window.addEventListener(
    "sgl-session-error",
    () => {
      switchingSession = false;
      load(null, true);
    }
  );

  window.addEventListener(
    "sgl-standings-refreshed",
    event => {
      if (switchingSession) return;

      const sessionId =
        event.detail.session_id;

      if (sessionId != null) {
        load(sessionId);
      }
    }
  );

  // ==========================================
  // INITIAL LOAD AND AUTOMATIC REFRESH
  // ==========================================

  load();

  setInterval(() => {
    if (
      document.visibilityState === "visible"
    ) {
      load();
    }
  }, 60000);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (
        document.visibilityState === "visible"
      ) {
        load();
      }
    }
  );
})();
