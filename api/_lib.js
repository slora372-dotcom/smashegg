// Shared server code for the Smash Egg API (Vercel serverless functions).
// Files starting with "_" are not exposed as API routes.

const crypto = require("crypto");

// Each brand link (/smashegg/<brand>) has its own player list, claims and stats.
// To add a brand: add a line here, in config.js, and copy the smashegg/ggc folder.
// GGC keeps the original "xmas26:" data so nothing already uploaded is lost.
const BRANDS = {
  ggc: { name: "GGC", ns: "xmas26:" },
  ppg: { name: "PPG", ns: "xmas26:ppg:" },
};
const NS = BRANDS.ggc.ns;
const brandOf = (v) => (Object.prototype.hasOwnProperty.call(BRANDS, v) ? v : "");

// Prizes RM1 to RM15. Higher weight = more likely. Weights add up to 100.
const PRIZES = [
  [1, 16], [2, 16], [3, 14], [4, 12], [5, 10],
  [6, 7], [7, 6], [8, 5], [9, 4], [10, 3],
  [11, 2], [12, 2], [13, 1], [14, 1], [15, 1],
];

function keysFor(brand) {
  const ns = BRANDS[brand].ns;
  return {
    players: ns + "players",            // set of phone numbers allowed to play
    claim: (p) => ns + "claim:" + p,    // one claim per phone (JSON)
    recent: ns + "recent",              // latest winners for the public list
    log: ns + "log",                    // every claim, for the admin page
    count: ns + "stats:count",
    total: ns + "stats:total",
  };
}
const KEYS = { rate: (ip) => NS + "rl:" + ip };

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
  ownerPass: "admin:ownerpass",         // owner's own password, once changed in Tetapan
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

// Owner login: this username + the ADMIN_PASSWORD setting in Vercel.
const OWNER = (process.env.OWNER_USERNAME || "olen1919").toLowerCase();

// Checks a username + password.
async function checkLogin(username, password) {
  const u = String(username || "").trim().toLowerCase();
  if (!u || !password) return null;
  if (u === OWNER) {
    // A password set in Tetapan wins; until then the ADMIN_PASSWORD setting in Vercel is used.
    const saved = await cmd("GET", AUTH.ownerPass);
    if (saved) {
      const rec = JSON.parse(saved);
      return safeEqual(hashPassword(password, rec.salt).hash, rec.hash) ? { user: OWNER, role: "owner" } : null;
    }
    const want = process.env.ADMIN_PASSWORD || "";
    return want && safeEqual(password, want) ? { user: OWNER, role: "owner" } : null;
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
  if (who.role === "owner") return who.user === OWNER ? { ...who, brands: Object.keys(BRANDS), token } : null;
  // A deleted account is logged out at once; a changed role or brand access applies at once.
  const raw2 = await cmd("HGET", AUTH.users, who.user);
  if (!raw2) return null;
  const rec = JSON.parse(raw2);
  return { user: who.user, role: rec.role, brands: userBrands(rec), token };
}

// Brands an account may see. Older accounts without a list can see every brand.
function userBrands(rec) {
  const list = Array.isArray(rec.brands) ? rec.brands.filter(brandOf) : Object.keys(BRANDS);
  return list.length ? list : Object.keys(BRANDS);
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
  BRANDS, brandOf, keysFor, userBrands, NS, KEYS, PRIZES, AUTH, ROLES, pipeline, cmd, cleanPhone, pickPrize, makeCode, send, body, clientIp,
  OWNER, rateLimited, hashPassword, checkLogin, createSession, getSession, audit, handleError,
};
