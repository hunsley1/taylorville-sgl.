
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
  let mode = "weekly";
  let loaded = false;
  let error = "";

  const validWeek = n =>
    Number.isInteger(n) && n > 0;

  async function get(table, columns) {
    const query =
      `select=${encodeURIComponent(columns)}&limit=10000`;

    const response = await fetch(
      `${API}/rest/v1/${table}?${query}`,
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

  function rankRows(items, scoreField, rowFn) {
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

  function render() {
    setTabs();

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
<th>STATUS</th>
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

    const columns = weekly ? 5 : 4;

    if (error || !loaded) {
      $("skinsStatus").textContent = error
        ? "Unable to load skins results."
        : "Loading gross skins…";

      $("skinsBody").innerHTML = `
<tr>
<td colspan="${columns}" class="empty${error ? " error" : ""}">
${escapeHTML(error || "Loading…")}
</td>
</tr>`;
      return;
    }

    if (weekly) {
      const rows = holes
        .filter(h => h.week_number === selectedWeek)
        .sort((a, b) =>
          a.hole_number - b.hole_number
        );

      const entrants = cards.filter(
        c => c.week_number === selectedWeek
      ).length;

      const awarded = rows.reduce(
        (sum, h) => sum + h.skins_awarded,
        0
      );

      $("skinsStatus").textContent =
        `Week ${selectedWeek ?? "—"} · ${entrants} of ${
          players.length || "?"
        } league players finished · ${awarded} skins awarded · ${
          week?.finalized ? "Finalized" : "Provisional"
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
<td class="tag">${h.skins_awarded || "—"}</td>
<td>${
  h.is_tied
    ? `Carry ${h.carryover}`
    : "Won"
}</td>
</tr>`).join("")
        : `<tr>
<td colspan="5" class="empty">
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
          h.winner_username.toLowerCase();

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

  async function load() {
    try {
      const [
        rawHoles,
        rawCards,
        rawWeeks,
        rawPlayers
      ] = await Promise.all([
        get(
          "sgl_skins",
          "week_number,hole_number,winner_username,winning_score,skins_awarded,carryover,is_tied"
        ),
        get(
          "sgl_skins_player_scores",
          "week_number,username"
        ),
        get(
          "sgl_weeks",
          "week_number,finalized"
        ),
        get(
          "sgl_players",
          "username"
        )
      ]);

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

      const available = new Set(
        holes.map(h => h.week_number)
      );

      const latest = weeks
        .filter(w => available.has(w.week_number))
        .at(-1)?.week_number;

      if (
        selectedWeek === null ||
        !weeks.some(
          w => w.week_number === selectedWeek
        )
      ) {
        selectedWeek =
          latest ??
          weeks.at(-1)?.week_number ??
          null;
      }

      $("skinsWeek").innerHTML =
        weeks.map(w => `
<option value="${w.week_number}">
Week ${w.week_number}${
  available.has(w.week_number)
    ? " · Results"
    : ""
}
</option>`).join("");

      if (selectedWeek !== null) {
        $("skinsWeek").value =
          String(selectedWeek);
      }

      loaded = true;
      error = "";

    } catch (e) {
      error = e.message;

      console.error(
        "Taylorville SGL skins error:",
        e
      );
    }

    render();
  }

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
    render();
  };

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
