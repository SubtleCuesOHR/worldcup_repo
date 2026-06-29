"""
2026 World Cup Dashboard — Flask backend.

Data source: football-data.org (https://www.football-data.org)
  Competition code "WC". Set FOOTBALL_DATA_API_KEY to use live data.
  Without a key, the app serves bundled sample data so the demo runs offline.
"""

import hmac
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, g, jsonify, render_template, request

load_dotenv()  # read key/values from a local .env file into the environment

app = Flask(__name__)

API_KEY = os.environ.get("FOOTBALL_DATA_API_KEY", "").strip()
API_BASE = "https://api.football-data.org/v4"
COMPETITION = "WC"  # FIFA World Cup
SAMPLE_DIR = Path(__file__).parent / "sample_data"
DB_PATH = Path(__file__).parent / "predictions.db"

# Use Postgres when DATABASE_URL is provided (e.g. Render's managed Postgres,
# which persists across restarts), otherwise fall back to a local SQLite file.
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_PG = bool(DATABASE_URL)

# Scoring: exact score is worth more than just calling the result.
POINTS_EXACT = 3
POINTS_RESULT = 1

# Password to enter the Pick'em game. Set ENTRY_PASS in .env to enable the gate;
# leave it unset/empty and the game is open (handy for local development).
entry_pass = os.environ.get("ENTRY_PASS", "")

# Tiny in-memory cache so we stay under the 10 req/min free-tier limit.
_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 60  # seconds


def _sample(name: str) -> dict:
    """Load a bundled sample-data file."""
    with open(SAMPLE_DIR / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)


def _fetch(endpoint: str, sample_name: str) -> dict:
    """Fetch from football-data.org, falling back to sample data.

    Returns a dict that always includes a "_source" key: "live" or "sample".
    """
    cached = _cache.get(endpoint)
    if cached and (time.time() - cached[0]) < CACHE_TTL:
        return cached[1]

    if not API_KEY:
        data = _sample(sample_name)
        data["_source"] = "sample"
        return data

    try:
        resp = requests.get(
            f"{API_BASE}/{endpoint}",
            headers={"X-Auth-Token": API_KEY},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        data["_source"] = "live"
        _cache[endpoint] = (time.time(), data)
        return data
    except requests.RequestException as exc:
        app.logger.warning("Live fetch failed (%s); using sample data.", exc)
        data = _sample(sample_name)
        data["_source"] = "sample"
        data["_error"] = str(exc)
        return data


# ---------------------------------------------------------------------------
# Database — Postgres when DATABASE_URL is set (persistent), else local SQLite.
# One prediction per (player, match), upsertable while the match is open.
# ---------------------------------------------------------------------------

def _connect():
    """Open a new DB connection with dict-style row access."""
    if USE_PG:
        import psycopg
        from psycopg.rows import dict_row
        dsn = DATABASE_URL
        if dsn.startswith("postgres://"):  # normalise legacy scheme for libpq
            dsn = "postgresql://" + dsn[len("postgres://"):]
        return psycopg.connect(dsn, row_factory=dict_row)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def get_db():
    if "db" not in g:
        g.db = _connect()
    return g.db


def _sql(query: str) -> str:
    """Queries are written with ? placeholders; Postgres needs %s."""
    return query.replace("?", "%s") if USE_PG else query


def db_query(query: str, params=()):
    return get_db().execute(_sql(query), params).fetchall()


def db_write(query: str, params=()):
    db = get_db()
    db.execute(_sql(query), params)
    db.commit()


@app.teardown_appcontext
def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    con = _connect()
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS predictions (
            player    TEXT    NOT NULL,
            match_id  INTEGER NOT NULL,
            pred_home INTEGER NOT NULL,
            pred_away INTEGER NOT NULL,
            created   TEXT    NOT NULL,
            PRIMARY KEY (player, match_id)
        )
        """
    )
    con.commit()
    con.close()


# ---------------------------------------------------------------------------
# Pick'em helpers
# ---------------------------------------------------------------------------

def _matches_by_id() -> dict[int, dict]:
    data = _fetch(f"competitions/{COMPETITION}/matches", "matches")
    return {int(m["id"]): m for m in data.get("matches", [])}


def is_open(match: dict) -> bool:
    """A match accepts predictions only before it kicks off.

    Open requires BOTH an upcoming status AND a kickoff still in the future,
    so a stale status can never re-open a match that has already started.
    """
    if match.get("status") not in ("TIMED", "SCHEDULED"):
        return False
    try:
        kickoff = datetime.fromisoformat(match["utcDate"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return True  # no parseable time — fall back to status only
    return datetime.now(timezone.utc) < kickoff


def _check_pass(provided: str) -> bool:
    """True if the entry password matches (constant-time), or none is set."""
    if not entry_pass:
        return True
    return hmac.compare_digest(provided or "", entry_pass)


def _outcome(home: int, away: int) -> int:
    return (home > away) - (home < away)  # 1 home win, 0 draw, -1 away win


def score_prediction(pred_home, pred_away, act_home, act_away) -> int:
    if pred_home == act_home and pred_away == act_away:
        return POINTS_EXACT
    if _outcome(pred_home, pred_away) == _outcome(act_home, act_away):
        return POINTS_RESULT
    return 0


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/standings")
def standings():
    return jsonify(_fetch(f"competitions/{COMPETITION}/standings", "standings"))


@app.route("/api/matches")
def matches():
    data = _fetch(f"competitions/{COMPETITION}/matches", "matches")
    for m in data.get("matches", []):
        m["_open"] = is_open(m)  # tell the UI whether picks are still allowed
    return jsonify(data)


@app.route("/api/scorers")
def scorers():
    return jsonify(_fetch(f"competitions/{COMPETITION}/scorers", "scorers"))


@app.route("/api/pickem/config")
def pickem_config():
    """Tell the UI whether a password is required to play."""
    return jsonify({"password_required": bool(entry_pass)})


@app.route("/api/pickem/auth", methods=["POST"])
def pickem_auth():
    """Validate the entry password so the UI can unlock the Pick'em tab."""
    body = request.get_json(silent=True) or {}
    if _check_pass(body.get("password", "")):
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Incorrect password."}), 401


@app.route("/api/predictions", methods=["GET"])
def get_predictions():
    """Return one player's predictions, keyed by match id."""
    player = (request.args.get("player") or "").strip()
    if not player:
        return jsonify({})
    rows = db_query(
        "SELECT match_id, pred_home, pred_away FROM predictions WHERE player = ?",
        (player,),
    )
    return jsonify({
        str(r["match_id"]): {"home": r["pred_home"], "away": r["pred_away"]}
        for r in rows
    })


@app.route("/api/predictions", methods=["POST"])
def submit_prediction():
    """Save a score prediction — rejected once the match has kicked off."""
    body = request.get_json(silent=True) or {}

    # Gate: enforced here too, so the password can't be skipped via the API.
    if not _check_pass(body.get("password", "")):
        return jsonify({"error": "Incorrect or missing password."}), 401

    player = (body.get("player") or "").strip()
    if not player:
        return jsonify({"error": "Enter your name first."}), 400

    try:
        match_id = int(body["match_id"])
        home = int(body["home"])
        away = int(body["away"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "match_id, home and away must be numbers."}), 400

    if not (0 <= home <= 99 and 0 <= away <= 99):
        return jsonify({"error": "Scores must be between 0 and 99."}), 400

    match = _matches_by_id().get(match_id)
    if match is None:
        return jsonify({"error": "Unknown match."}), 404

    if not (match.get("homeTeam", {}).get("name") and match.get("awayTeam", {}).get("name")):
        return jsonify({"error": "Both teams aren't decided yet."}), 400

    # The lock: enforced on the server so the UI can't be bypassed.
    if not is_open(match):
        return jsonify({"error": "This match has already started — picks are locked."}), 403

    db_write(
        """
        INSERT INTO predictions (player, match_id, pred_home, pred_away, created)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(player, match_id)
        DO UPDATE SET pred_home = excluded.pred_home,
                      pred_away = excluded.pred_away,
                      created   = excluded.created
        """,
        (player, match_id, home, away, datetime.now(timezone.utc).isoformat()),
    )
    return jsonify({"ok": True})


@app.route("/api/leaderboard")
def leaderboard():
    """Score every prediction against finished matches and rank players."""
    by_id = _matches_by_id()
    rows = db_query("SELECT player, match_id, pred_home, pred_away FROM predictions")

    board: dict[str, dict] = {}
    for r in rows:
        stats = board.setdefault(
            r["player"], {"player": r["player"], "points": 0, "exact": 0, "scored": 0}
        )
        match = by_id.get(r["match_id"])
        if not match or match.get("status") != "FINISHED":
            continue
        ft = match.get("score", {}).get("fullTime", {})
        ah, aa = ft.get("home"), ft.get("away")
        if ah is None or aa is None:
            continue
        pts = score_prediction(r["pred_home"], r["pred_away"], ah, aa)
        stats["points"] += pts
        stats["scored"] += 1
        if pts == POINTS_EXACT:
            stats["exact"] += 1

    ranked = sorted(board.values(), key=lambda s: (-s["points"], -s["exact"], s["player"]))
    return jsonify({"leaderboard": ranked, "scoring": {"exact": POINTS_EXACT, "result": POINTS_RESULT}})


# Ensure the table exists on import too, so production WSGI servers
# (gunicorn / PythonAnywhere) that never run __main__ still initialise it.
init_db()


if __name__ == "__main__":
    app.run(debug=True, port=5000)
