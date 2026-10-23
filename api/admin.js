// POST /api/admin  { action, ... }
// "login" needs { username, password } and returns a token. Every other action
// needs the header "Authorization: Bearer <token>".
//
// Who can do what:
//   owner  (username "owner", password = ADMIN_PASSWORD in Vercel): everything
//   admin  : everything except managing accounts
//   staff  : stats, lookup, claims, change own password
const {
  KEYS, AUTH, ROLES, pipeline, cmd, cleanPhone, send, body, clientIp,
  hashPassword, checkLogin, createSession, getSession, audit, handleError,
} = require("./_lib");

const CAN = {
  stats: ["owner", "admin", "staff"],
  lookup: ["owner", "admin", "staff"],
  claims: ["owner", "admin", "staff"],
  me: ["owner", "admin", "staff"],
  logout: ["owner", "admin", "staff"],
  changeMyPassword: ["admin", "staff"],
  add: ["owner", "admin"],
  remove: ["owner", "admin"],
  resetClaim: ["owner", "admin"],
  clearPlayers: ["owner", "admin"],
  audit: ["owner", "admin"],
  listUsers: ["owner"],
  addUser: ["owner"],
  removeUser: ["owner"],
  setPassword: ["owner"],
};

const validUsername = (u) => /^[a-z0-9._-]{3,20}$/.test(u) && u !== "owner";
const validPassword = (p) => typeof p === "string" && p.length >= 8 && p.length <= 100;

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method" });
  try {
    const b = body(req);

    // ---------- Login ----------
    if (b.action === "login") {
      const key = AUTH.tries(clientIp(req));
      const [tries] = await pipeline([["INCR", key], ["EXPIRE", key, "600", "NX"]]);
      if (tries > 10) return send(res, 429, { ok: false, error: "too_many" });
      const who = await checkLogin(b.username, b.password);
      if (!who) return send(res, 401, { ok: false, error: "wrong_login" });
      await cmd("DEL", key);
      const token = await createSession(who);
      await audit(who, "login", "");
      return send(res, 200, { ok: true, token, user: who.user, role: who.role });
    }

    const who = await getSession(req);
    if (!who) return send(res, 401, { ok: false, error: "not_logged_in" });
    if (!CAN[b.action]) return send(res, 400, { ok: false, error: "unknown_action" });
    if (!CAN[b.action].includes(who.role)) return send(res, 403, { ok: false, error: "no_permission" });

    switch (b.action) {
      case "me":
        return send(res, 200, { ok: true, user: who.user, role: who.role });

      case "logout":
        await cmd("DEL", AUTH.session(who.token));
        return send(res, 200, { ok: true });

      case "stats": {
        const [players, count, total] = await pipeline([
          ["SCARD", KEYS.players], ["GET", KEYS.count], ["GET", KEYS.total],
        ]);
        return send(res, 200, { ok: true, players, claims: +count || 0, totalRM: +total || 0 });
      }

      case "add": {
        const list = Array.isArray(b.phones) ? b.phones : [];
        const valid = [...new Set(list.map(cleanPhone).filter(Boolean))];
        let added = 0;
        for (let i = 0; i < valid.length; i += 500) {
          added += await cmd("SADD", KEYS.players, ...valid.slice(i, i + 500));
        }
        const players = await cmd("SCARD", KEYS.players);
        if (added) await audit(who, "add players", `${added} added`);
        return send(res, 200, { ok: true, received: list.length, valid: valid.length, added, players });
      }

      case "lookup": {
        const phone = cleanPhone(b.phone);
        if (!phone) return send(res, 400, { ok: false, error: "invalid_phone" });
        const [isPlayer, claim] = await pipeline([["SISMEMBER", KEYS.players, phone], ["GET", KEYS.claim(phone)]]);
        return send(res, 200, { ok: true, phone, isPlayer: !!isPlayer, claim: claim ? JSON.parse(claim) : null });
      }

      case "remove": {
        const phone = cleanPhone(b.phone);
        if (!phone) return send(res, 400, { ok: false, error: "invalid_phone" });
        const removed = await cmd("SREM", KEYS.players, phone);
        if (removed) await audit(who, "remove player", phone);
        return send(res, 200, { ok: true, removed });
      }

      case "resetClaim": {
        const phone = cleanPhone(b.phone);
        if (!phone) return send(res, 400, { ok: false, error: "invalid_phone" });
        const removed = await cmd("DEL", KEYS.claim(phone));
        if (removed) await audit(who, "allow replay", phone);
        return send(res, 200, { ok: true, removed });
      }

      case "claims": {
        const rows = (await cmd("LRANGE", KEYS.log, "0", "-1")) || [];
        return send(res, 200, { ok: true, claims: rows.map((r) => JSON.parse(r)) });
      }

      case "clearPlayers": {
        if (b.confirm !== "DELETE") return send(res, 400, { ok: false, error: "confirm" });
        await cmd("DEL", KEYS.players);
        await audit(who, "clear player list", "");
        return send(res, 200, { ok: true });
      }

      case "audit": {
        const rows = (await cmd("LRANGE", AUTH.audit, "0", "199")) || [];
        return send(res, 200, { ok: true, entries: rows.map((r) => JSON.parse(r)) });
      }

      // ---------- Accounts (owner only) ----------
      case "listUsers": {
        const flat = (await cmd("HGETALL", AUTH.users)) || [];
        const users = [];
        for (let i = 0; i < flat.length; i += 2) {
          const rec = JSON.parse(flat[i + 1]);
          users.push({ username: flat[i], role: rec.role, created: rec.created });
        }
        users.sort((x, y) => x.username.localeCompare(y.username));
        return send(res, 200, { ok: true, users });
      }

      case "addUser": {
        const u = String(b.username || "").trim().toLowerCase();
        if (!validUsername(u)) return send(res, 400, { ok: false, error: "bad_username" });
        if (!validPassword(b.password)) return send(res, 400, { ok: false, error: "bad_password" });
        if (!ROLES.includes(b.role)) return send(res, 400, { ok: false, error: "bad_role" });
        const rec = { ...hashPassword(b.password), role: b.role, created: new Date().toISOString() };
        const isNew = await cmd("HSETNX", AUTH.users, u, JSON.stringify(rec));
        if (!isNew) return send(res, 400, { ok: false, error: "user_exists" });
        await audit(who, "add user", `${u} (${b.role})`);
        return send(res, 200, { ok: true });
      }

      case "removeUser": {
        const u = String(b.username || "").trim().toLowerCase();
        const removed = await cmd("HDEL", AUTH.users, u);
        if (removed) await audit(who, "remove user", u);
        return send(res, 200, { ok: true, removed });
      }

      case "setPassword": {
        const u = String(b.username || "").trim().toLowerCase();
        if (!validPassword(b.password)) return send(res, 400, { ok: false, error: "bad_password" });
        const raw = await cmd("HGET", AUTH.users, u);
        if (!raw) return send(res, 404, { ok: false, error: "no_user" });
        const rec = { ...JSON.parse(raw), ...hashPassword(b.password) };
        await cmd("HSET", AUTH.users, u, JSON.stringify(rec));
        await audit(who, "reset password", u);
        return send(res, 200, { ok: true });
      }

      case "changeMyPassword": {
        if (!validPassword(b.password)) return send(res, 400, { ok: false, error: "bad_password" });
        const ok = await checkLogin(who.user, b.oldPassword);
        if (!ok) return send(res, 400, { ok: false, error: "wrong_old_password" });
        const raw = await cmd("HGET", AUTH.users, who.user);
        const rec = { ...JSON.parse(raw), ...hashPassword(b.password) };
        await cmd("HSET", AUTH.users, who.user, JSON.stringify(rec));
        await audit(who, "changed own password", "");
        return send(res, 200, { ok: true });
      }
    }
  } catch (e) {
    return handleError(res, e);
  }
};
