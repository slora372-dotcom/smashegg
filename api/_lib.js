// Shared server code for the Smash Egg API (Vercel serverless functions).
// Files starting with "_" are not exposed as API routes.

const crypto = require("crypto");

// Change NS to start a new campaign with a fresh player list and claims.
const NS = process.env.GAME_NAMESPACE || "xmas26:";

// Prizes RM1 to RM15. Higher weight = more likely. Weights add up to 100.
const PRIZES = [
  [1, 16], [2, 16], [3, 14], [4, 12], [5, 10],
  [6, 7], [7, 6], [8, 5], [9, 4], [10, 3],
  [11, 2], [12, 2], [13, 1], [14, 1], [15, 1],
];

const KEYS = {
  players: NS + "players",            // set of phone numbers allowed to play
  claim: (p) => NS + "claim:" + p,    // one claim per phone (JSON)
  recent: NS + "recent",              // latest winners for the public list
  log: NS + "log",                    // every claim, for the admin page
  count: NS + "stats:count",
  total: NS + "stats:total",
  rate: (ip) => NS + "rl:" + ip,
};

// ---------- Upstash Redis over its REST API (no packages needed) ----------
const DB_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const DB_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function pipeline(commands) {
  if (!DB_URL || !DB_TOKEN) throw new Error("DB_NOT_CONNECTED");
  const r = await fetch(DB_URL.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + DB_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error("DB_ERROR " + r.status);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error("DB_ERROR " + x.error);
    return x.result;
  });
}
const cmd = async (...args) => (await pipeline([args]))[0];

// ---------- Helpers ----------
// Accepts 012-345 6789, +6012..., 6012..., " \t0123456789" and returns 0123456789, or "".
function cleanPhone(v) {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.startsWith("60")) d = d.slice(1);
  return /^01\d{8,9}$/.test(d) ? d : "";
}

function pickPrize() {
  const total = PRIZES.reduce((s, p) => s + p[1], 0);
  let r = crypto.randomInt(total);
  for (const [amount, w] of PRIZES) { if ((r -= w) < 0) return amount; }
  return PRIZES[0][0];
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "XM-";
  for (let i = 0; i < 6; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

function send(res, status, data) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).end(JSON.stringify(data));
}

function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}

// Limits how many phone numbers one visitor can try (stops guessing numbers).
async function rateLimited(req, limit = 15, seconds = 600) {
  const key = KEYS.rate(clientIp(req));
  const [n] = await pipeline([["INCR", key], ["EXPIRE", key, String(seconds), "NX"]]);
  return n > limit;
}

// ---------- Admin accounts ----------
// Accounts are kept outside the campaign namespace so they carry over to the next event.
const AUTH = {
  users: "admin:users",                 // hash: username -> {salt, hash, role, created}
  session: (t) => "admin:session:" + t, // login token -> {user, role}
  audit: "admin:audit",                 // who did what
  tries: (ip) => "admin:tries:" + ip,
};
const SESSION_SECONDS = 12 * 60 * 60;
const ROLES = ["admin", "staff"];

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return { salt, hash };
}

// Checks a username + password. "owner" always uses the ADMIN_PASSWORD setting in Vercel.
async function checkLogin(username, password) {
  const u = String(username || "").trim().toLowerCase();
  if (!u || !password) return null;
  if (u === "owner") {
    const want = process.env.ADMIN_PASSWORD || "";
    return want && safeEqual(password, want) ? { user: "owner", role: "owner" } : null;
  }
  const raw = await cmd("HGET", AUTH.users, u);
  if (!raw) return null;
  const rec = JSON.parse(raw);
  return safeEqual(hashPassword(password, rec.salt).hash, rec.hash) ? { user: u, role: rec.role } : null;
}

async function createSession(who) {
  const token = crypto.randomBytes(24).toString("hex");
  await cmd("SET", AUTH.session(token), JSON.stringify(who), "EX", String(SESSION_SECONDS));
  return token;
}

async function getSession(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const raw = await cmd("GET", AUTH.session(token));
  if (!raw) return null;
  const who = JSON.parse(raw);
  if (who.user === "owner") return { ...who, token };
  // A deleted account is logged out at once; a changed role applies at once.
  const rec = await cmd("HGET", AUTH.users, who.user);
  return rec ? { user: who.user, role: JSON.parse(rec).role, token } : null;
}

async function audit(who, action, detail) {
  await pipeline([
    ["LPUSH", AUTH.audit, JSON.stringify({ at: new Date().toISOString(), user: who.user, action, detail })],
    ["LTRIM", AUTH.audit, "0", "499"],
  ]);
}

function handleError(res, e) {
  const msg = String(e && e.message || e);
  if (msg === "DB_NOT_CONNECTED") return send(res, 500, { ok: false, error: "db_not_connected" });
  console.error(msg);
  return send(res, 500, { ok: false, error: "server_error" });
}

module.exports = {
  NS, KEYS, PRIZES, AUTH, ROLES, pipeline, cmd, cleanPhone, pickPrize, makeCode, send, body, clientIp,
  rateLimited, hashPassword, checkLogin, createSession, getSession, audit, handleError,
};
