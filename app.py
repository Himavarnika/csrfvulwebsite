import json
import os
import secrets
import sqlite3

from flask import Flask, g, redirect, render_template, request, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("SESSION_DB", os.path.join(BASE_DIR, "data", "sessions.sqlite"))

CATALOG = [
    {"sku": "lantern", "name": "Brass camp lantern", "price": 48, "note": "Warm light, hinged glass."},
    {"sku": "blanket", "name": "Wool field blanket", "price": 76, "note": "Heavy weave, charcoal stripe."},
    {"sku": "kettle", "name": "Enamel kettle", "price": 34, "note": "Two-liter, cream and black."},
]

app = Flask(__name__, template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 1_000_000


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = connect()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                address TEXT NOT NULL,
                orders TEXT NOT NULL,
                log TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def fresh_session(sid):
    return {"sid": sid, "name": "Guest", "email": "", "address": "", "orders": [], "log": []}


def row_to_session(row):
    return {
        "sid": row["sid"],
        "name": row["name"],
        "email": row["email"],
        "address": row["address"],
        "orders": json.loads(row["orders"]),
        "log": json.loads(row["log"]),
    }


def load_session():
    sid = request.cookies.get("harbor_sid") or request.cookies.get("harbor_lax")
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM sessions WHERE sid = ?", (sid,)).fetchone() if sid else None
        if row is not None:
            return row_to_session(row)
        sid = secrets.token_hex(16)
        conn.execute(
            "INSERT INTO sessions (sid, name, email, address, orders, log) VALUES (?, ?, ?, ?, ?, ?)",
            (sid, "Guest", "", "", "[]", "[]"),
        )
        conn.commit()
        return fresh_session(sid)
    finally:
        conn.close()


def save_session(session):
    session["orders"] = session["orders"][:12]
    session["log"] = session["log"][:8]
    conn = connect()
    try:
        conn.execute(
            "UPDATE sessions SET name = ?, email = ?, address = ?, orders = ?, log = ? WHERE sid = ?",
            (
                session["name"],
                session["email"],
                session["address"],
                json.dumps(session["orders"]),
                json.dumps(session["log"]),
                session["sid"],
            ),
        )
        conn.commit()
    finally:
        conn.close()


def clip(value, limit):
    return str(value or "").strip()[:limit]


def supplied(name):
    if request.is_json:
        data = request.get_json(silent=True) or {}
        if name in data:
            return True, data.get(name)
    source = request.args if request.method == "GET" else request.form
    if name in source:
        return True, source.get(name)
    return False, None


def remember(session, action):
    session["log"].insert(
        0,
        {
            "action": action,
            "method": request.method,
            "origin": request.headers.get("Origin") or "(none)",
            "referer": request.headers.get("Referer") or "(none)",
        },
    )


# Intentionally vulnerable: state changes with no login and no CSRF token.
# The anonymous browser cookie is the only credential.
def apply_account_update(session):
    present_name, name = supplied("name")
    present_email, email = supplied("email")
    present_address, address = supplied("address")
    if present_name:
        session["name"] = clip(name, 80) or "Guest"
    if present_email:
        session["email"] = clip(email, 120)
    if present_address:
        session["address"] = clip(address, 200)
    remember(session, "Account updated")
    save_session(session)


def apply_order(session):
    _, sku = supplied("sku")
    sku = clip(sku, 40)
    item = next((entry for entry in CATALOG if entry["sku"] == sku), None)
    if item is None:
        return False
    session["orders"].insert(
        0,
        {"id": secrets.token_hex(3), "sku": item["sku"], "name": item["name"], "price": item["price"]},
    )
    remember(session, f"Order placed: {item['name']}")
    save_session(session)
    return True


@app.before_request
def prepare_request():
    if request.path == "/styles.css":
        return None
    hostname = request.host.split(":")[0].lower()
    if hostname in {"127.0.0.1", "::1"}:
        port = request.host.split(":", 1)[1] if ":" in request.host else ""
        target = "localhost" + (f":{port}" if port else "")
        return redirect(f"{request.scheme}://{target}{request.full_path}", code=302)
    g.session = load_session()
    return None


@app.after_request
def add_session_cookie(response):
    session = getattr(g, "session", None)
    if session is not None:
        sid = session["sid"]
        # SameSite=None lets a cross-site POST include the cookie (needs HTTPS, or localhost).
        # SameSite=Lax still rides along on a top-level cross-site GET.
        response.set_cookie("harbor_sid", sid, path="/", httponly=True, samesite="None", secure=True)
        response.set_cookie("harbor_lax", sid, path="/", httponly=True, samesite="Lax")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/styles.css")
def styles():
    return send_from_directory(os.path.join(BASE_DIR, "public"), "styles.css")


@app.get("/")
def home():
    return render_template("home.html", shopper=g.session, catalog=CATALOG)


@app.get("/account")
def account():
    notice = ""
    if request.args.get("saved"):
        notice = "Account saved."
    elif request.args.get("ordered"):
        notice = "Order placed."
    return render_template("account.html", shopper=g.session, notice=notice)


@app.route("/account/update", methods=["GET", "POST"])
def update_account():
    apply_account_update(g.session)
    return redirect("/account?saved=1")


@app.route("/order", methods=["GET", "POST"])
def place_order():
    if not apply_order(g.session):
        return render_template("message.html", title="Order", message="Unknown item."), 400
    return redirect("/account?ordered=1")


@app.errorhandler(404)
def missing(_error):
    return render_template("message.html", title="Not found", message="That page is not on this site."), 404


init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), debug=False)
