
const SGL = {
  url: "https://xgjziyopzeeneccfaszb.supabase.co",
  key: "sb_publishable_7ttHIcbCVOCv1rJlWpq0AA_59y0Tw7O"
};

async function sglFetch(table) {
  const response = await fetch(
    `${SGL.url}/rest/v1/${table}?select=*`,
    {
      headers: {
        apikey: SGL.key
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `Could not load ${table}: ${response.status}`
    );
  }

  return response.json();
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
      p.username,
      teamNames[p.team_id] || "Unassigned"
    ])
  );

  const weekInfo = Object.fromEntries(
    weeks.map(w => [w.week_number, w])
  );

  const results = scores.map(s => {
    const week = weekInfo[s.week_number];
    const par = week?.course_par ?? 72;

    return {
      ...s,
      team: playerTeams[s.username] || "Unassigned",
      course_par: par,
      gross_strokes:
        s.gross_relative == null
          ? null
          : par + s.gross_relative,
      net_strokes:
        s.net_relative == null
          ? null
          : par + s.net_relative
    };
  });

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
