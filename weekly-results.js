
(function () {
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;'
  }[c]));

  let selectedWeek = null;
  let scoreType = 'gross';
  let category = 'individual';

  function buildArchive() {
    if (document.getElementById('sgl-weekly-archive')) return;

    const section = document.createElement('section');
    section.id = 'sgl-weekly-archive';
    section.className = 'card';
    section.style.cssText = 'margin:28px auto;padding:24px;max-width:1100px;border:1px solid #665331;border-radius:18px;background:#191919;color:#f5f1e8';

    section.innerHTML = `
      <div style="color:#d8b66c;font-weight:800;letter-spacing:3px;font-size:13px">LEAGUE HISTORY</div>
      <h2>Weekly Results Archive</h2>
      <p>View individual and team results from completed weeks.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin:20px 0">
        <select id="archiveWeek" style="padding:12px;background:#111;color:white;border:1px solid #b99a57;border-radius:8px"></select>
        <select id="archiveCategory" style="padding:12px;background:#111;color:white;border:1px solid #b99a57;border-radius:8px">
          <option value="individual">Individual Scores</option>
          <option value="teams">Team Scores</option>
        </select>
        <select id="archiveScoring" style="padding:12px;background:#111;color:white;border:1px solid #b99a57;border-radius:8px">
          <option value="gross">Gross</option>
          <option value="net">Net</option>
        </select>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead id="archiveHead"></thead>
          <tbody id="archiveBody"></tbody>
        </table>
      </div>
    `;

    const anchor = document.getElementById('seasonTeams');
    const seasonSection = anchor?.closest('section');
    if (seasonSection) {
      seasonSection.insertAdjacentElement('afterend', section);
    } else {
      document.querySelector('main')?.appendChild(section);
    }

    section.querySelector('#archiveWeek').onchange = e => {
      selectedWeek = e.target.value;
      renderArchive();
    };
    section.querySelector('#archiveCategory').onchange = e => {
      category = e.target.value;
      renderArchive();
    };
    section.querySelector('#archiveScoring').onchange = e => {
      scoreType = e.target.value;
      renderArchive();
    };
  }

  function renderArchive() {
    const db = window.SGL_DB;
    if (!db) return;

    buildArchive();
    const section = document.getElementById('sgl-weekly-archive');
    if (!section) return;

    const completed = db.weeks
      .filter(w => w.finalized)
      .sort((a, b) => a.week_number - b.week_number);

    const weekSelect = section.querySelector('#archiveWeek');
    if (!selectedWeek || !completed.some(w => String(w.week_number) === selectedWeek)) {
      selectedWeek = String(completed.at(-1)?.week_number ?? '');
    }

    weekSelect.innerHTML = completed.map(w =>
      `<option value="${w.week_number}">Week ${w.week_number}${w.course_name ? ' - ' + escapeHTML(w.course_name) : ''}</option>`
    ).join('');
    weekSelect.value = selectedWeek;

    const scoringSelect = section.querySelector('#archiveScoring');
    scoringSelect.style.display = category === 'teams' ? 'none' : '';
    scoringSelect.value = scoreType;

    const week = completed.find(w => String(w.week_number) === selectedWeek);
    const head = section.querySelector('#archiveHead');
    const body = section.querySelector('#archiveBody');

    if (!week) {
      body.innerHTML = '<tr><td>No completed weeks yet.</td></tr>';
      return;
    }

    const results = db.scores.filter(s =>
      s.week_number === week.week_number
    );

    const thStyle = 'padding:12px 8px;text-align:left;border-bottom:1px solid #665331;color:#d8b66c';
    const tdStyle = 'padding:12px 8px;border-bottom:1px solid #38332b';

    if (category === 'individual') {
      head.innerHTML = `<tr><th style="${thStyle}">Pos</th><th style="${thStyle}">Golfer</th><th style="${thStyle}">Score</th></tr>`;

      const field = scoreType === 'gross' ? 'gross_strokes' : 'net_strokes';
      const ranked = results
        .filter(s => Number.isFinite(s[field]))
        .sort((a, b) => a[field] - b[field] || a.username.localeCompare(b.username));

      body.innerHTML = ranked.map((s, i) =>
        `<tr><td style="${tdStyle}">${i + 1}</td><td style="${tdStyle}">${escapeHTML(s.username)}</td><td style="${tdStyle}"><strong>${s[field]}</strong></td></tr>`
      ).join('') || `<tr><td colspan="3" style="${tdStyle}">No scores available.</td></tr>`;
    } else {
      head.innerHTML = `<tr><th style="${thStyle}">Pos</th><th style="${thStyle}">Team</th><th style="${thStyle}">Net Strokes</th></tr>`;

      const teamNames = Object.fromEntries(db.teams.map(t => [t.id, t.team_name]));
      const playerTeams = Object.fromEntries(db.players.map(p => [
        p.username.trim().toLowerCase(), teamNames[p.team_id]
      ]));

      const totals = new Map(db.teams.map(t => [
        t.team_name, { total: 0, count: 0 }
      ]));

      for (const s of results) {
        const team = playerTeams[s.username.trim().toLowerCase()];
        if (!team || !Number.isFinite(s.net_strokes)) continue;
        const entry = totals.get(team);
        if (!entry) continue;
        entry.total += s.net_strokes;
        entry.count++;
      }

      const ranked = [...totals.entries()]
        .map(([team, data]) => ({ team, ...data }))
        .sort((a, b) =>
          (a.count === 4 ? 0 : 1) - (b.count === 4 ? 0 : 1) ||
          a.total - b.total
        );

      body.innerHTML = ranked.map((t, i) =>
        `<tr><td style="${tdStyle}">${t.count === 4 ? i + 1 : '—'}</td><td style="${tdStyle}">${escapeHTML(t.team)}</td><td style="${tdStyle}"><strong>${t.count === 4 ? t.total : 'Incomplete'}</strong></td></tr>`
      ).join('');
    }
  }

  window.addEventListener('sgl-standings-loaded', renderArchive);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.SGL_DB) renderArchive();
    });
  } else if (window.SGL_DB) {
    renderArchive();
  }
})();

