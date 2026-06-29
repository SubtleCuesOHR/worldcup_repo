// 2026 World Cup Dashboard — frontend logic

const fmtGroup = (g) => (g ? g.replace("_", " ").replace("GROUP", "Group") : "");

function statusLabel(s) {
  if (["IN_PLAY", "PAUSED", "LIVE"].includes(s)) return { cls: "LIVE", text: "LIVE" };
  if (s === "FINISHED") return { cls: "FINISHED", text: "FT" };
  return { cls: "UPCOMING", text: "Upcoming" };
}

function kickoff(utc) {
  const d = new Date(utc);
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function setSourceBadge(source) {
  const el = document.getElementById("source-badge");
  if (source === "live") {
    el.textContent = "● LIVE DATA";
    el.className = "source live";
  } else {
    el.textContent = "● SAMPLE DATA (add API key for live)";
    el.className = "source sample";
  }
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const hasTeams = (m) => m.homeTeam?.name && m.awayTeam?.name;

function renderMatches(data) {
  const matches = (data.matches || []).filter(hasTeams);
  const order = { IN_PLAY: 0, PAUSED: 0, LIVE: 0, TIMED: 1, SCHEDULED: 1, FINISHED: 2 };
  matches.sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));

  const cards = matches.map((m) => {
    const st = statusLabel(m.status);
    const h = m.score?.fullTime?.home;
    const a = m.score?.fullTime?.away;
    const hasScore = h !== null && h !== undefined;
    return `
      <div class="match-card">
        <div class="match-head">
          <span class="group-tag">${fmtGroup(m.group) || m.stage}</span>
          <span class="status ${st.cls}">${st.text}</span>
        </div>
        <div class="team-row">
          <span class="team-name">${m.homeTeam.name}</span>
          <span class="team-score">${hasScore ? h : "–"}</span>
        </div>
        <div class="team-row">
          <span class="team-name">${m.awayTeam.name}</span>
          <span class="team-score">${hasScore ? a : "–"}</span>
        </div>
        ${st.cls === "UPCOMING" ? `<div class="kickoff">${kickoff(m.utcDate)}</div>` : ""}
      </div>`;
  });
  document.getElementById("matches").innerHTML =
    `<div class="match-grid">${cards.join("") || "<p class='loading'>No matches.</p>"}</div>`;
}

function renderStandings(data) {
  const groups = (data.standings || []).filter((s) => s.type === "TOTAL");
  const html = groups.map((g) => {
    const rows = g.table.map((t) => `
      <tr class="${t.position <= 2 ? "qualify" : ""}">
        <td class="pos">${t.position}</td>
        <td>${t.team.name}</td>
        <td>${t.playedGames}</td>
        <td>${t.won}-${t.draw}-${t.lost}</td>
        <td>${t.goalDifference > 0 ? "+" : ""}${t.goalDifference}</td>
        <td class="pts">${t.points}</td>
      </tr>`).join("");
    return `
      <div class="group-card">
        <h3>${fmtGroup(g.group)}</h3>
        <table>
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W-D-L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");
  document.getElementById("standings").innerHTML =
    `<div class="groups">${html || "<p class='loading'>No standings.</p>"}</div>`;
}

function renderScorers(data) {
  const scorers = data.scorers || [];
  const items = scorers.map((s, i) => `
    <div class="scorer">
      <span class="rank">${i + 1}</span>
      <div class="scorer-info">
        <div class="name">${s.player.name}</div>
        <div class="team">${s.team.name}</div>
      </div>
      <div class="goals">${s.goals}<span> goals</span>${s.assists ? ` · ${s.assists}<span> ast</span>` : ""}</div>
    </div>`).join("");
  document.getElementById("scorers").innerHTML =
    `<div class="scorer-list">${items || "<p class='loading'>No scorers.</p>"}</div>`;
}

// ---- Pick'em -------------------------------------------------------------

const playerName = () => (localStorage.getItem("wc_player") || "").trim();
let lastMatches = [];

let pickemRequired = false;
let pickemUnlocked = false;
const storedPass = () => sessionStorage.getItem("wc_pickem_pass") || "";

async function tryAuth(pw) {
  try {
    const res = await fetch("/api/pickem/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function initPickemAuth() {
  try {
    const cfg = await fetchJSON("/api/pickem/config");
    pickemRequired = cfg.password_required;
  } catch {
    pickemRequired = false;
  }
  if (!pickemRequired) {
    pickemUnlocked = true;
  } else if (storedPass()) {
    pickemUnlocked = await tryAuth(storedPass());
    if (!pickemUnlocked) sessionStorage.removeItem("wc_pickem_pass");
  }
}

function renderGate(list, bar) {
  bar.style.display = "none";
  list.innerHTML = `
    <div class="gate">
      <h3>🔒 This Pick'em is password protected</h3>
      <p class="hint">Enter the office password to make and view picks.</p>
      <div class="gate-form">
        <input id="gate-pass" type="password" placeholder="Password" autocomplete="off" />
        <button id="gate-go" class="pick-save">Unlock</button>
      </div>
      <p class="gate-err" id="gate-err"></p>
    </div>`;

  const submit = async () => {
    const pw = document.getElementById("gate-pass").value;
    if (await tryAuth(pw)) {
      pickemUnlocked = true;
      sessionStorage.setItem("wc_pickem_pass", pw);
      renderPickem();
    } else {
      document.getElementById("gate-err").textContent = "Incorrect password.";
    }
  };
  document.getElementById("gate-go").addEventListener("click", submit);
  document.getElementById("gate-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
}

async function renderPickem() {
  const list = document.getElementById("pickem-list");
  const bar = document.querySelector(".player-bar");
  if (pickemRequired && !pickemUnlocked) {
    renderGate(list, bar);
    return;
  }
  bar.style.display = "";

  const player = playerName();
  let mine = {};
  if (player) {
    try { mine = await fetchJSON(`/api/predictions?player=${encodeURIComponent(player)}`); }
    catch { mine = {}; }
  }

  // Show only what's actionable: matches open for picks, plus any the player
  // already predicted (so they can watch those settle). Skip TBD placeholders.
  const relevant = lastMatches.filter(
    (m) => hasTeams(m) && (m._open || mine[String(m.id)])
  );

  const rows = relevant.map((m) => {
    const p = mine[String(m.id)];
    const ft = m.score?.fullTime || {};
    const finished = m.status === "FINISHED";

    let right;
    if (m._open) {
      right = `
        <div class="pick-inputs">
          <input type="number" min="0" max="99" class="pick-h" value="${p ? p.home : ""}" placeholder="0" />
          <span>–</span>
          <input type="number" min="0" max="99" class="pick-a" value="${p ? p.away : ""}" placeholder="0" />
          <button class="pick-save" data-match="${m.id}">${p ? "Update" : "Save"}</button>
        </div>`;
    } else if (finished) {
      const yours = p ? `You: ${p.home}–${p.away}` : "No pick";
      right = `<div class="pick-locked">🔒 FT ${ft.home}–${ft.away} · <span class="${p ? "muted" : "nopick"}">${yours}</span></div>`;
    } else {
      const yours = p ? `You: ${p.home}–${p.away}` : "No pick";
      right = `<div class="pick-locked">🔒 Locked · ${yours}</div>`;
    }

    return `
      <div class="pick-row">
        <div class="pick-teams">
          <span class="group-tag">${fmtGroup(m.group) || m.stage}</span>
          <strong>${m.homeTeam.name}</strong> vs <strong>${m.awayTeam.name}</strong>
          ${m._open ? `<span class="kick-inline">${kickoff(m.utcDate)}</span>` : ""}
        </div>
        ${right}
      </div>`;
  });

  if (!player) {
    list.innerHTML = `<p class="notice">Enter your name above to start making picks.</p>` + rows.join("");
  } else {
    list.innerHTML = rows.join("") || "<p class='loading'>No fixtures.</p>";
  }

  list.querySelectorAll(".pick-save").forEach((btn) => {
    btn.addEventListener("click", () => savePick(btn));
  });
}

async function savePick(btn) {
  const player = playerName();
  if (!player) { alert("Enter your name first."); return; }
  const row = btn.closest(".pick-row");
  const home = row.querySelector(".pick-h").value;
  const away = row.querySelector(".pick-a").value;
  if (home === "" || away === "") { alert("Enter both scores."); return; }

  btn.disabled = true;
  try {
    const res = await fetch("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player, password: storedPass(), match_id: Number(btn.dataset.match), home: Number(home), away: Number(away) }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || "Could not save."); btn.disabled = false; return; }
    btn.textContent = "Saved ✓";
    setTimeout(() => { renderPickem(); }, 600);
  } catch {
    alert("Network error.");
    btn.disabled = false;
  }
}

// ---- Leaderboard ---------------------------------------------------------

function renderLeaderboard(data) {
  const board = data.leaderboard || [];
  const rows = board.map((s, i) => {
    const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}`;
    return `
      <div class="lb-row ${i < 3 ? "podium" : ""}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${s.player}</span>
        <span class="lb-meta">${s.scored} scored · ${s.exact} exact</span>
        <span class="lb-pts">${s.points}<span> pts</span></span>
      </div>`;
  }).join("");
  document.getElementById("leaderboard").innerHTML = `
    <p class="notice">Exact score = ${data.scoring.exact} pts · correct result = ${data.scoring.result} pt</p>
    <div class="lb-list">${rows || "<p class='loading'>No picks scored yet.</p>"}</div>`;
}

async function loadAll() {
  try {
    const [m, s, sc, lb] = await Promise.all([
      fetchJSON("/api/matches"),
      fetchJSON("/api/standings"),
      fetchJSON("/api/scorers"),
      fetchJSON("/api/leaderboard"),
    ]);
    setSourceBadge(m._source);
    lastMatches = m.matches || [];
    renderMatches(m);
    renderStandings(s);
    renderScorers(sc);
    renderLeaderboard(lb);
    renderPickem();
  } catch (err) {
    console.error(err);
  }
}

// Tab switching
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});

// Remember the player's name and refresh their picks when it changes.
const nameInput = document.getElementById("player-name");
nameInput.value = playerName();
nameInput.addEventListener("change", () => {
  localStorage.setItem("wc_player", nameInput.value.trim());
  renderPickem();
});

initPickemAuth().then(loadAll);
setInterval(loadAll, 60000); // refresh every 60s
