
const SGL = {
  url: "https://xgjziyopzeeneccfaszb.supabase.co",
  key: "sb_publishable_7ttHIcbCVOCv1rJlWpq0AA_59y0Tw7O"
};

async function sglFetch(table) {
  const response = await fetch(
    `${SGL.url}/rest/v1/${table}?select=*&limit=10000`,
    {
      headers: {
        apikey: SGL.key,
        Accept: "application/json",
        "Cache-Control": "no-cache"
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

async function loadSGLStandings() {
  const [players, teams, weeks, scores] =
    await Promise.all([
      sglFetch("sgl_players"),
      sglFetch("sgl_teams"),
      sglFetch("sgl_weeks"),
      sglFetch("sgl_scores")
    ]);

  const teamNames = Object.fromEntries(
    teams.map(t => [t.id, t.team_name])
  );

  const playerTeams = Object.fromEntries(
    players.map(p => [
      String(p.username).trim().toLowerCase(),
      teamNames[p.team_id] || "Unassigned"
    ])
  );

  const weekInfo = Object.fromEntries(
    weeks.map(w => [Number(w.week_number), w])
  );

  const results = scores.map(s => {
    const weekNumber = Number(s.week_number);
    const week = weekInfo[weekNumber];

    const par = sglNumber(week?.course_par) ?? 72;
    const grossRelative = sglNumber(s.gross_relative);
    const netRelative = sglNumber(s.net_relative);
    const username = String(s.username || "").trim();

    return {
      ...s,
      username,
      week_number: weekNumber,
      team:
        playerTeams[username.toLowerCase()] ||
        "Unassigned",
      course_par: par,
      gross_relative: grossRelative,
      net_relative: netRelative,
      gross_strokes:
        grossRelative === null
          ? null
          : par + grossRelative,
      net_strokes:
        netRelative === null
          ? null
          : par + netRelative
    };
  });

  console.log(
    "SGL scores loaded:",
    results.length
  );

  console.log(
    "Week 4 players:",
    results
      .filter(s => s.week_number === 4)
      .map(s => ({
        username: s.username,
        gross: s.gross_strokes,
        net: s.net_strokes,
        status: s.status
      }))
  );

  window.SGL_DB = {
    players,
    teams,
    weeks,
    scores: results
  };

  window.dispatchEvent(
    new CustomEvent("sgl-standings-loaded", {
      detail: window.SGL_DB
    })
  );

  return window.SGL_DB;
}

window.loadSGLStandings = loadSGLStandings;
