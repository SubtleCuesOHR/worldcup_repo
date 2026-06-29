# 2026 World Cup Dashboard

A Flask + HTML/JS dashboard for the FIFA World Cup 2026 — live group standings,
matches, and top scorers. Runs out of the box with bundled sample data; add an
API key for live data.

## Why football-data.org?

| API | Free tier | World Cup | Notes |
|-----|-----------|-----------|-------|
| **football-data.org** ✅ | Free, 10 req/min | Competition `WC` | Simplest auth, perfect for this demo |
| API-Football (api-sports.io) | 100 req/day | Yes | Most detailed (live events, lineups) — upgrade path |
| SportMonks | Paid | Yes | Commercial-grade |
| TheSportsDB | Free | Logos/images | Weak live data |

## Setup

```bash
pip install -r requirements.txt
python app.py
```

Open http://localhost:5000

## Live data (optional)

1. Get a free key at https://www.football-data.org/client/register
2. Set the environment variable, then run:

```bash
# macOS / Linux
export FOOTBALL_DATA_API_KEY=your_key_here

# Windows PowerShell
$env:FOOTBALL_DATA_API_KEY="your_key_here"

python app.py
```

Without a key (or if the API is unreachable) the app serves `sample_data/`,
and the badge in the header shows **SAMPLE DATA**. With a valid key it shows
**LIVE DATA**.

## Office Pick'em game

The **Pick'em** tab lets everyone predict match scores; the **Leaderboard**
tab ranks players automatically against real results.

- **Scoring:** exact score = **3 pts**, correct result (W/D/L) = **1 pt**.
- **Picks lock at kickoff.** A match is open only while its status is
  `TIMED`/`SCHEDULED` *and* kickoff is still in the future. This is enforced
  on the server (`POST /api/predictions` returns 403 once a match starts), so
  the lock can't be bypassed by calling the API directly.
- **Identity:** players just type a name (stored in the browser) — no logins.
- **Entry password:** set `ENTRY_PASS` in `.env` to gate the Pick'em tab. Players
  must enter it before they can make picks. Validation is enforced server-side
  (constant-time compare) on both `/api/pickem/auth` and `POST /api/predictions`,
  so it can't be bypassed via the API. Leave `ENTRY_PASS` empty for open play.
- **Storage:** SQLite (`predictions.db`, created on first run). Three demo
  colleagues are seeded against already-finished matches so the leaderboard
  isn't empty on first launch.

### Pick'em API

| Method | Route | Purpose |
|--------|-------|---------|
| GET  | `/api/predictions?player=NAME` | That player's saved picks |
| POST | `/api/predictions` | Save a pick `{player, match_id, home, away}` — 403 if locked |
| GET  | `/api/leaderboard` | Ranked standings, scored vs finished matches |

## Structure

```
app.py                 Flask backend — data proxy + Pick'em/leaderboard + SQLite + lock logic
templates/index.html   Dashboard shell (tabs: Matches / Pick'em / Leaderboard / Standings / Scorers)
static/style.css       Styling
static/app.js          Fetches /api/*, renders, auto-refreshes every 60s
sample_data/*.json     Offline fallback (matches football-data.org v4 shape)
predictions.db         SQLite store for picks (auto-created, git-ignored)
```
