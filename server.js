const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 3000;
const HOST = "127.0.0.1";

const CATALOG = [
  { sku: "lantern", name: "Brass camp lantern", price: 48, note: "Warm light, hinged glass." },
  { sku: "blanket", name: "Wool field blanket", price: 76, note: "Heavy weave, charcoal stripe." },
  { sku: "kettle", name: "Enamel kettle", price: 34, note: "Two-liter, cream and black." },
];

const sessions = new Map();

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function readCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(raw);
    } catch {
      cookies[key] = raw;
    }
  }
  return cookies;
}

function freshSession() {
  return {
    name: "Guest",
    email: "",
    address: "",
    orders: [],
    log: [],
  };
}

function getSession(req, res) {
  const cookies = readCookies(req);
  let sid = cookies.sid || cookies.sid_lax;
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomBytes(16).toString("hex");
    sessions.set(sid, freshSession());
  }
  // Two cookies, same id:
  // - sid is SameSite=None so a cross-site POST can send it
  // - sid_lax is SameSite=Lax so a cross-site link (GET) still works
  //   even when the browser blocks third-party cookies
  res.setHeader("Set-Cookie", [
    `sid=${sid}; Path=/; HttpOnly; SameSite=None; Secure`,
    `sid_lax=${sid}; Path=/; HttpOnly; SameSite=Lax`,
  ]);
  const session = sessions.get(sid);
  session.sid = sid;
  return session;
}

function parseBody(raw, contentType) {
  const params = new URLSearchParams(raw);
  if ((contentType || "").includes("application/json")) {
    try {
      const data = JSON.parse(raw || "{}");
      for (const [key, value] of Object.entries(data)) {
        params.set(key, value == null ? "" : String(value));
      }
    } catch {
      // Ignore invalid JSON and keep the urlencoded fields.
    }
  }
  return params;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function clip(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

// Intentionally vulnerable: mutates the anonymous session from any origin.
// There is no login and no CSRF token. The browser cookie is the only credential.
function updateAccount(session, params, req) {
  if (params.has("name")) session.name = clip(params.get("name"), 80) || "Guest";
  if (params.has("email")) session.email = clip(params.get("email"), 120);
  if (params.has("address")) session.address = clip(params.get("address"), 200);
  session.log.unshift({
    at: new Date().toISOString(),
    action: "Account updated",
    method: req.method,
    origin: req.headers.origin || "(none)",
    referer: req.headers.referer || "(none)",
  });
  session.log = session.log.slice(0, 8);
}

function placeOrder(session, params, req) {
  const sku = clip(params.get("sku"), 40);
  const item = CATALOG.find((entry) => entry.sku === sku);
  if (!item) return { ok: false, error: "Unknown item." };
  session.orders.unshift({
    id: crypto.randomBytes(3).toString("hex"),
    sku: item.sku,
    name: item.name,
    price: item.price,
    at: new Date().toISOString(),
  });
  session.orders = session.orders.slice(0, 12);
  session.log.unshift({
    at: new Date().toISOString(),
    action: `Order placed: ${item.name}`,
    method: req.method,
    origin: req.headers.origin || "(none)",
    referer: req.headers.referer || "(none)",
  });
  session.log = session.log.slice(0, 8);
  return { ok: true };
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="banner">Local lab only. This site has no login, and it does not check a CSRF token. Do not put it on the public internet.</div>
  <header class="site">
    <a class="brand" href="/">Harbor Supply</a>
    <nav>
      <a href="/">Shop</a>
      <a href="/account">Account</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function homePage(session) {
  const cards = CATALOG.map((item) => `
    <article class="card">
      <p class="sku">${esc(item.sku)}</p>
      <h2>${esc(item.name)}</h2>
      <p>${esc(item.note)}</p>
      <div class="card-row">
        <strong>$${item.price}</strong>
        <form method="POST" action="/order">
          <input type="hidden" name="sku" value="${esc(item.sku)}">
          <button type="submit">Place order</button>
        </form>
      </div>
    </article>`).join("");

  return layout("Harbor Supply", `
    <section class="hero">
      <p class="eyebrow">Shopper profile, no password</p>
      <h1>Your receipt email and shipping address live in this browser.</h1>
      <p class="lede">There is no account login. A cookie identifies this browser. Orders and the receipt address are saved against that cookie.</p>
      <p class="status">Signed in as <strong>${esc(session.name)}</strong>${session.email ? ` · receipts to ${esc(session.email)}` : ""}.</p>
    </section>
    <section class="grid">${cards}</section>
  `);
}

function accountPage(session, notice) {
  const orders = session.orders.length
    ? session.orders.map((order) => `<li><span>${esc(order.name)}</span><span>$${order.price}</span></li>`).join("")
    : `<li class="empty">No orders yet.</li>`;
  const log = session.log.length
    ? session.log.map((entry) => `<li><span>${esc(entry.action)}</span><span>${esc(entry.method)} · origin ${esc(entry.origin)}</span></li>`).join("")
    : `<li class="empty">No changes yet.</li>`;

  return layout("Account · Harbor Supply", `
    <section class="hero narrow">
      <p class="eyebrow">Anonymous session ${esc(session.sid.slice(0, 8))}</p>
      <h1>Account details</h1>
      <p class="lede">Saving this form changes where receipts go and where orders ship. The form has no CSRF token.</p>
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
    </section>
    <section class="split">
      <form method="POST" action="/account/update" class="panel">
        <label>Display name <input name="name" value="${esc(session.name)}" maxlength="80"></label>
        <label>Receipt email <input name="email" type="email" value="${esc(session.email)}" maxlength="120" placeholder="you@example.com"></label>
        <label>Shipping address <textarea name="address" maxlength="200" rows="3">${esc(session.address)}</textarea></label>
        <button type="submit">Save account</button>
      </form>
      <div>
        <section class="panel">
          <h2>Orders</h2>
          <ul class="plain">${orders}</ul>
        </section>
        <section class="panel">
          <h2>Change log</h2>
          <ul class="plain">${log}</ul>
        </section>
      </div>
    </section>
  `);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "";
    if (host.startsWith("127.0.0.1") || host.startsWith("[::1]")) {
      redirect(res, `http://localhost:${PORT}${req.url}`);
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === "/styles.css") {
      const file = path.join(__dirname, "public", "styles.css");
      const css = fs.readFileSync(file);
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
      res.end(css);
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(res, 200, homePage(getSession(req, res)));
      return;
    }

    if (req.method === "GET" && url.pathname === "/account") {
      const session = getSession(req, res);
      const notice = url.searchParams.get("saved")
        ? "Account saved."
        : url.searchParams.get("ordered")
          ? "Order placed."
          : "";
      sendHtml(res, 200, accountPage(session, notice));
      return;
    }

    if ((req.method === "POST" || req.method === "GET") && url.pathname === "/account/update") {
      const session = getSession(req, res);
      const params = req.method === "GET"
        ? url.searchParams
        : parseBody(await readBody(req), req.headers["content-type"]);
      updateAccount(session, params, req);
      redirect(res, "/account?saved=1");
      return;
    }

    if ((req.method === "POST" || req.method === "GET") && url.pathname === "/order") {
      const session = getSession(req, res);
      const params = req.method === "GET"
        ? url.searchParams
        : parseBody(await readBody(req), req.headers["content-type"]);
      const result = placeOrder(session, params, req);
      if (!result.ok) {
        sendHtml(res, 400, layout("Order", `<p class="lede">${esc(result.error)}</p>`));
        return;
      }
      redirect(res, "/account?ordered=1");
      return;
    }

    sendHtml(res, 404, layout("Not found", `<p class="lede">That page is not on this site.</p>`));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Request failed.");
    console.error(error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Harbor Supply (vulnerable app)  http://localhost:${PORT}`);
});
