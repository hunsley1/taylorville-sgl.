"use strict";

const SGL = {
  url: "https://xgjziyopzeeneccfaszb.supabase.co",
  key: "sb_publishable_7ttHIcbCVOCv1rJlWpq0AA_59y0Tw7O"
};

const SGL_TABLE_ORDERS = {
  sgl_sessions: "season_year.desc,session_number.desc,id.desc",
  sgl_weeks: "week_number.asc",
  sgl_players: "username.asc",
  sgl_teams: "id.asc",
  sgl_scores: "week_number.asc,username.asc",
  sgl_par3_shots: "id.asc",
  sgl_skins: "week_number.asc,hole_number.asc",
  sgl_skins_player_scores: "week_number.asc,username.asc"
};

let sglSessions = [];
let sglSelectedSessionId = null;
let sglRequestVersion = 0;
let sglLoadPromise = null;
let sglRefreshRunning = false;


// ==========================================
// DATABASE CONNECTION
// ==========================================

async function sglFetch(table, options = {}) {
  const rows = [];
  const pageSize = 500;

  const requestedLimit =
    options.limit === undefined
      ? Infinity
      : Number(options.limit);

  let offset = 0;

  const sessionId =
    options.sessionId !== undefined
      ? options.sessionId
      : sglSelectedSessionId;

  if (
    table !== "sgl_sessions" &&
    sessionId === null
  ) {
    throw new Error(
      "No league session selected"
    );
  }

  while (rows.length < requestedLimit) {
    const remaining =
      requestedLimit - rows.length;

    const limit = Math.min(
      pageSize,
      remaining
    );

    const params = new URLSearchParams({
      select: options.select || "*",
      limit: String(limit),
      offset: String(offset)
    });

    const order =
      options.order ||
      SGL_TABLE_ORDERS[table];

    if (order) {
      params.set("order", order);
    }

    if (table !== "sgl_sessions") {
      params.set(
        "session_id",
        "eq." + sessionId
      );
    }

    if (options.week !== undefined) {
      params.set(
        "week_number",
        "eq." + options.week
      );
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

async function sglLoadSessions() {
  const sessions = await sglFetch(
    "sgl_sessions"
  );

  sglSessions = sessions.filter(
    session =>
      session.status === "active" ||
      session.status === "completed"
  );

  window.SGL_SESSIONS = sglSessions;

  return sglSessions;
}

function sglGetSessions() {
  return [...sglSessions];
}

function sglGetSelectedSession() {
  return sglSessions.find(
    session =>
      String(session.id) ===
      String(sglSelectedSessionId)
  ) || null;
}

function sglGetActiveSession() {
  return sglSessions.find(
    session => session.status === "active"
  ) || null;
}

function sglDefaultSession() {
  return (
    sglGetActiveSession() ||
    sglSessions[0] ||
    null
  );
}

async function sglSelectSession(sessionId) {
  if (!sglSessions.length) {
    await sglLoadSessions();
  }

  const session = sglSessions.find(
    item =>
      String(item.id) === String(sessionId)
  );

  if (!session) {
    throw new Error(
      "League session not found"
    );
  }

  if (
    String(sglSelectedSessionId) ===
      String(session.id) &&
    window.SGL_DB &&
    String(window.SGL_DB.session_id) ===
      String(session.id)
  ) {
    return window.SGL_DB;
  }

  const previousSessionId =
    sglSelectedSessionId;

  const previousDatabase =
    window.SGL_DB;

  sglSelectedSessionId = session.id;

  const version = ++sglRequestVersion;

  sglLoadPromise = null;

  sglEmit("sgl-session-loading", {
    session,
    sessions: sglGetSessions()
  });

  try {
    const database =
      await sglLoadSessionData(
        session,
        version
      );

    if (version !== sglRequestVersion) {
      return null;
    }

    sglEmit("sgl-session-changed", {
      session,
      sessions: sglGetSessions(),
      database
    });

    return database;

  } catch (error) {
    if (version === sglRequestVersion) {
      sglSelectedSessionId =
        previousSessionId;

      window.SGL_DB =
        previousDatabase;

      sglEmit("sgl-session-error", {
        session,
        message: error.message
      });
    }

    throw error;
  }
}


// ==========================================
// SCORE CONVERSION
// ==========================================

function sglNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function sglCurrentWeek(weeks) {
  const ordered = [...weeks].sort(
    (a, b) =>
      Number(a.week_number) -
      Number(b.week_number)
  );

  const unfinished = ordered.find(
    week => !week.finalized
  );

  if (unfinished) {
    return Number(
      unfinished.week_number
    );
  }

  if (ordered.length) {
    return Number(
      ordered[ordered.length - 1]
        .week_number
    );
  }

  return 1;
}

function sglConvertScores(
  scores,
  weeks,
  players,
  teams
) {
  const teamNames = new Map(
    teams.map(team => [
      String(team.id),
      team.team_name
    ])
  );

  const playerTeams = new Map(
    players.map(player => [
      String(player.username || "")
        .trim()
        .toLowerCase(),

      teamNames.get(
        String(player.team_id)
      ) || "Unassigned"
    ])
  );

  const weekInfo = new Map(
    weeks.map(week => [
      Number(week.week_number),
      week
    ])
  );

  return scores.map(score => {
    const weekNumber =
      Number(score.week_number);

    const username =
      String(score.username || "").trim();

    const week =
      weekInfo.get(weekNumber);

    const par =
      sglNumber(week?.course_par) ?? 72;

    const grossRelative =
      sglNumber(score.gross_relative);

    const netRelative =
      sglNumber(score.net_relative);

    return {
      ...score,

      username,

      week_number: weekNumber,

      handicap:
        sglNumber(score.handicap),

      team:
        playerTeams.get(
          username.toLowerCase()
        ) || "Unassigned",

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
}


// ==========================================
// WEBSITE AND APP EVENTS
// ==========================================

function sglEmit(eventName, data) {
  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: data
    })
  );
}


// ==========================================
// LOAD SESSION DATA
// ==========================================

async function sglLoadSessionData(
  session,
  version
) {
  const sessionId = session.id;

  const options = {
    sessionId
  };

  const [
    weeks,
    players,
    teams,
    rawScores
  ] = await Promise.all([
    sglFetch("sgl_weeks", options),
    sglFetch("sgl_players", options),
    sglFetch("sgl_teams", options),
    sglFetch("sgl_scores", options)
  ]);

  if (version !== sglRequestVersion) {
    return null;
  }

  const currentWeek =
    sglCurrentWeek(weeks);

  const scores = sglConvertScores(
    rawScores,
    weeks,
    players,
    teams
  );

  const database = {
    session,
    session_id: sessionId,
    sessions: sglGetSessions(),

    currentWeek,

    totalWeeks:
      Number(session.total_weeks) ||
      weeks.length,

    players,
    teams,
    weeks,
    scores
  };

  window.SGL_DB = database;

  window.SGL_SELECTED_SESSION =
    session;

  sglEmit("sgl-current-ready", {
    session,
    session_id: sessionId,
    currentWeek,
    weeks,

    scores: scores.filter(
      score =>
        Number(score.week_number) ===
        Number(currentWeek)
    )
  });

  sglEmit(
    "sgl-standings-loaded",
    database
  );

  return database;
}


// ==========================================
// INITIAL LEAGUE LOAD
// ==========================================

async function loadSGLStandings() {
  if (sglLoadPromise) {
    return sglLoadPromise;
  }

  const version = ++sglRequestVersion;

  const promise = (async () => {
    await sglLoadSessions();

    if (version !== sglRequestVersion) {
      return null;
    }

    const session =
      sglGetSelectedSession() ||
      sglDefaultSession();

    if (!session) {
      throw new Error(
        "No available league sessions"
      );
    }

    sglSelectedSessionId =
      session.id;

    return sglLoadSessionData(
      session,
      version
    );
  })();

  sglLoadPromise = promise;

  try {
    return await promise;

  } finally {
    if (sglLoadPromise === promise) {
      sglLoadPromise = null;
    }
  }
}


// ==========================================
// AUTOMATIC REFRESH
// ==========================================

async function refreshSGLStandings() {
  if (
    sglRefreshRunning ||
    sglLoadPromise ||
    !window.SGL_DB
  ) {
    return;
  }

  const database = window.SGL_DB;

  if (
    String(database.session_id) !==
    String(sglSelectedSessionId)
  ) {
    return;
  }

  sglRefreshRunning = true;

  const version = sglRequestVersion;

  const sessionId =
    database.session_id;

  const options = {
    sessionId
  };

  try {
    const [
      sessions,
      weeks,
      players,
      teams,
      rawScores
    ] = await Promise.all([
      sglFetch("sgl_sessions"),
      sglFetch("sgl_weeks", options),
      sglFetch("sgl_players", options),
      sglFetch("sgl_teams", options),
      sglFetch("sgl_scores", options)
    ]);

    if (
      version !== sglRequestVersion ||
      String(sessionId) !==
        String(sglSelectedSessionId)
    ) {
      return;
    }

    sglSessions = sessions.filter(
      session =>
        session.status === "active" ||
        session.status === "completed"
    );

    window.SGL_SESSIONS =
      sglSessions;

    const session =
      sglGetSelectedSession();

    if (!session) {
      return;
    }

    const currentWeek =
      sglCurrentWeek(weeks);

    const scores = sglConvertScores(
      rawScores,
      weeks,
      players,
      teams
    );

    const updated = {
      ...database,

      session,
      session_id: sessionId,

      sessions: sglGetSessions(),

      currentWeek,

      totalWeeks:
        Number(session.total_weeks) ||
        weeks.length,

      players,
      teams,
      weeks,
      scores
    };

    window.SGL_DB = updated;

    window.SGL_SELECTED_SESSION =
      session;

    sglEmit(
      "sgl-standings-refreshed",
      updated
    );

  } catch (error) {
    console.error(
      "SGL refresh failed:",
      error
    );

  } finally {
    sglRefreshRunning = false;
  }
}


// ==========================================
// PUBLIC WEBSITE AND APP FUNCTIONS
// ==========================================

window.sglFetch =
  sglFetch;

window.loadSGLStandings =
  loadSGLStandings;

window.refreshSGLStandings =
  refreshSGLStandings;

window.sglLoadSessions =
  sglLoadSessions;

window.sglGetSessions =
  sglGetSessions;

window.sglGetSelectedSession =
  sglGetSelectedSession;

window.sglGetActiveSession =
  sglGetActiveSession;

window.sglSelectSession =
  sglSelectSession;

window.sglCurrentWeek =
  sglCurrentWeek;
