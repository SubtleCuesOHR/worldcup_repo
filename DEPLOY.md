# Deploying the World Cup Dashboard

Two free options, **both now persistent:**
- **Render** provisions a free **Postgres** database (via `render.yaml`) and the
  app uses it automatically — picks survive restarts and redeploys.
- **PythonAnywhere** has no `DATABASE_URL`, so the app falls back to a local
  **SQLite** file, which PythonAnywhere also keeps between restarts.

The app picks its database automatically: **Postgres if `DATABASE_URL` is set,
otherwise SQLite.** Nothing to configure in code.

You will set two secrets on whichever host you choose — they are **not** in git:

| Variable | What it is |
|----------|------------|
| `FOOTBALL_DATA_API_KEY` | Your football-data.org key (live scores) |
| `ENTRY_PASS` | The Pick'em entry password |

---

## Option A — PythonAnywhere (recommended, no credit card)

1. **Sign up** for a free "Beginner" account at https://www.pythonanywhere.com.

2. **Get the code onto PythonAnywhere.** Open a *Bash console* (Consoles tab) and
   either clone your repo or upload the files:
   ```bash
   git clone https://github.com/<you>/<your-repo>.git worldcup
   cd worldcup
   ```

3. **Create a virtualenv and install deps:**
   ```bash
   python3.12 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

4. **Create the web app:** Web tab → *Add a new web app* → *Manual configuration*
   → *Python 3.12*.

5. **Point it at your virtualenv:** on the Web tab, set
   *Virtualenv* to `/home/<you>/worldcup/venv`.

6. **Set the source/working directory:** set *Source code* to `/home/<you>/worldcup`.

7. **Edit the WSGI file** (link is on the Web tab, e.g.
   `/var/www/<you>_pythonanywhere_com_wsgi.py`). Replace its contents with:
   ```python
   import sys
   path = "/home/<you>/worldcup"
   if path not in sys.path:
       sys.path.insert(0, path)
   from app import app as application   # noqa: E402
   ```

8. **Set your secrets.** Easiest: create a `.env` file in `/home/<you>/worldcup`
   (the app calls `load_dotenv()`, so it reads it automatically):
   ```
   FOOTBALL_DATA_API_KEY=your_key_here
   ENTRY_PASS=your_password_here
   ```
   In a Bash console: `nano .env`, paste, save. (`.env` is git-ignored, so it
   never leaves your machine via git — you create it directly on the server.)

9. **Reload** the web app (big green button on the Web tab) and open
   `https://<you>.pythonanywhere.com`.

To update later: `git pull` in the console, then hit **Reload**.

---

## Option B — Render (easiest auto-deploy, picks persist via Postgres)

1. Push this repo to GitHub.
2. https://render.com → **New + → Blueprint** → connect your repo. Render reads
   `render.yaml`, which creates **both** the web service and a free Postgres
   database, and wires `DATABASE_URL` into the app for you.
3. When prompted (the two `sync: false` vars), set:
   - `FOOTBALL_DATA_API_KEY` = your key
   - `ENTRY_PASS` = your password
4. Deploy. Render gives you a `https://worldcup-dashboard.onrender.com` URL.
   (Free services sleep after ~15 min idle; the first hit then takes ~30s. The
   free Postgres database expires after 90 days — Render emails you; create a
   fresh one and re-link if you're still running the pool then.)

Picks are stored in Postgres, so they **survive restarts and redeploys.**

---

## Sanity check after deploy
- Header badge shows **LIVE DATA** → API key is set correctly.
- Pick'em tab shows the 🔒 password screen → `ENTRY_PASS` is set correctly.
- Entering the password lets you submit a pick → end-to-end works.
