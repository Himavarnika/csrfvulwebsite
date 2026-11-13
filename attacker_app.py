import os

from flask import Flask, redirect, render_template, request

app = Flask(__name__, template_folder="templates")
SHOP_URL = os.environ.get("SHOP_URL", "http://localhost:8000").rstrip("/")


@app.before_request
def keep_this_site_separate():
    # localhost:8001 and localhost:8000 are the same site. 127.0.0.1 is a different site.
    hostname = request.host.split(":")[0].lower()
    if hostname == "localhost":
        port = request.host.split(":", 1)[1] if ":" in request.host else "8001"
        return redirect(f"http://127.0.0.1:{port}{request.full_path}", code=302)
    return None


@app.after_request
def no_store(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/")
def index():
    return render_template("trail.html", shop_url=SHOP_URL)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8001")), debug=False)
