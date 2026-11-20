
"use strict";

const SGL = {
  url: "https://xgjziyopzeeneccfaszb.supabase.co",
  key: "sb_publishable_7ttHIcbCVOCv1rJlWpq0AA_59y0Tw7O"
};

async function sglFetch(table, options = {}) {
  const params = new URLSearchParams({
    select: options.select || "*",
    limit: String(options.limit || 10000)
  });

  if (options.week !== undefined) {
    params.set("week_number", "eq." + options.week);
  }

  const response = await fetch(
    `${SGL.url}/rest/v1/${table}?${params}`,
    {
      headers: {
        apikey: SGL.key,
        Accept: "application/json"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(
      `Could not load ${table}: ${response.status}`
    );
  }

  return response.json();
}

function sglNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sglCurrentWeek(weeks) {
  const unfinished = weeks
    .filter(w => !w.finalized)
    .sort((a, b) =>
      Number(a.week_number) - Number(b.week_number)
    );

  return unfinished[0]?.week_number ??
    (Math.max(
      0,
      ...weeks.map(w => Number(w.week_number) || 0)
    ) + 1);
}

function sglConvertScores(scores, weeks, players, teams) {
  const teamNames = new Map(
    teams.map(t => [String(t.id), t.team_name])
  );

  const playerTeams = new Map(
    players.map(p => [
      String(p.username || "").trim().toLowerCase(),
      teamNames.get(String(p.team_id)) || "Unassigned"
    ])
  );

  const weekInfo = new Map(
    weeks.map(w => [Number(w.week_number), w])
  );

  return scores.map(s => {
    const weekNumber = Number(s.week_number);
    const username = String(s.username || "").trim();
    const week = weekInfo.get(weekNumber);
    const par = sglNumber(week?.course_par) ?? 72;
    const grossRelative = sglNumber(s.gross_relative);
    const netRelative = sglNumber(s.net_relative);

    return {
      ...s,
      username,
      week_number: weekNumber,
      handicap: sglNumber(s.handicap),
      team: playerTeams.get(username.toLowerCase()) ||
        "Unassigned",
      course_par: par,
      gross_relative: grossRelative,
      net_relative: netRelative,
      gross_strokes: grossRelative === null
        ? null
        : par + grossRelative,
      net_strokes: netRelative === null
        ? null
        : par + netRelative
    };
  });
}

function sglEmit(eventName, data) {
  window.dispatchEvent(
    new CustomEvent(eventName, { detail: data })
  );
}

let sglLoadPromise = null;

async function loadSGLStandings() {
  if (sglLoadPromise) return sglLoadPromise;

  sglLoadPromise = (async () => {
    // First load the weeks and current week's scores.
    const weeks = await sglFetch("sgl_weeks");
    const currentWeek = Number(sglCurrentWeek(weeks));

    const currentRaw = await sglFetch("sgl_scores", {
      week: currentWeek
    });

    const currentScores = sglConvertScores(
      currentRaw, weeks, [], []
    );

    // Tell the website to display the current leaderboard.
    sglEmit("sgl-current-ready", {
      currentWeek,
      weeks,
      scores: currentScores
    });

    // Load the other league data separately.
    const [players, teams, allScores] =
      await Promise.all([
        sglFetch("sgl_players"),
        sglFetch("sgl_teams"),
        sglFetch("sgl_scores")
      ]);

    const results = sglConvertScores(
      allScores, weeks, players, teams
    );

    const database = {
      players,
      teams,
      weeks,
      scores: results
    };

    window.SGL_DB = database;

    sglEmit("sgl-standings-loaded", database);

    return database;
  })();

  try {
    return await sglLoadPromise;
  } finally {
    sglLoadPromise = null;
  }
}

let sglRefreshRunning = false;

async function refreshSGLStandings() {
  if (sglRefreshRunning || !window.SGL_DB) return;

  sglRefreshRunning = true;

  try {
    const database = window.SGL_DB;

    // Check the current week and finalized-week flags.
    const weeks = await sglFetch("sgl_weeks");
    const currentWeek = Number(sglCurrentWeek(weeks));

    // Refresh all scores so archives and season totals
    // remain consistent when weeks are finalized.
    const rawScores = await sglFetch("sgl_scores");

    const scores = sglConvertScores(
      rawScores,
      weeks,
      database.players,
      database.teams
    );

    const updated = {
      ...database,
      weeks,
      scores
    };

    window.SGL_DB = updated;

    sglEmit("sgl-standings-refreshed", {
      ...updated,
      currentWeek
    });

  } catch (error) {
    console.error("SGL refresh failed:", error);
  } finally {
    sglRefreshRunning = false;
  }
}

window.loadSGLStandings = loadSGLStandings;
window.refreshSGLStandings = refreshSGLStandings;
