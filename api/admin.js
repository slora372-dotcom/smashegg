// POST /api/admin  (header "x-admin-key: <ADMIN_PASSWORD>")  { action, ... }
//   stats                      -> players, claims, total RM given
//   add       { phones: [] }   -> add phone numbers to the player list
//   lookup    { phone }        -> is this a player, and their claim
//   remove    { phone }        -> remove one phone from the player list
//   resetClaim{ phone }        -> let one phone play again
//   claims                     -> every claim (full phone), newest first
//   clearPlayers { confirm: "DELETE" } -> empty the whole player list
const { KEYS, pipeline, cmd, cleanPhone, send, body, isAdmin, handleError } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method" });
  if (!isAdmin(req)) return send(res, 401, { ok: false, error: "wrong_password" });
  try {
    const b = body(req);
    switch (b.action) {
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
        return send(res, 200, { ok: true, removed });
      }
      case "resetClaim": {
        const phone = cleanPhone(b.phone);
        if (!phone) return send(res, 400, { ok: false, error: "invalid_phone" });
        const removed = await cmd("DEL", KEYS.claim(phone));
        return send(res, 200, { ok: true, removed });
      }
      case "claims": {
        const rows = (await cmd("LRANGE", KEYS.log, "0", "-1")) || [];
        return send(res, 200, { ok: true, claims: rows.map((r) => JSON.parse(r)) });
      }
      case "clearPlayers": {
        if (b.confirm !== "DELETE") return send(res, 400, { ok: false, error: "confirm" });
        await cmd("DEL", KEYS.players);
        return send(res, 200, { ok: true });
      }
      default:
        return send(res, 400, { ok: false, error: "unknown_action" });
    }
  } catch (e) {
    return handleError(res, e);
  }
};
