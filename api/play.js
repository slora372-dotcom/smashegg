// POST /api/play  { phone, egg, check }
//   check: true  -> only tells if the phone can play (no prize given)
//   otherwise    -> gives one prize to a registered phone, once.
const { brandOf, keysFor, pipeline, cmd, cleanPhone, pickPrize, makeCode, send, body, rateLimited, handleError } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "method" });
  try {
    const b = body(req);
    const brand = brandOf(b.brand || "ggc");
    if (!brand) return send(res, 400, { ok: false, error: "unknown_brand" });
    const KEYS = keysFor(brand);
    const phone = cleanPhone(b.phone);
    if (!phone) return send(res, 400, { ok: false, error: "invalid_phone" });
    if (await rateLimited(req)) return send(res, 429, { ok: false, error: "too_many" });

    const [isPlayer, existing] = await pipeline([
      ["SISMEMBER", KEYS.players, phone],
      ["GET", KEYS.claim(phone)],
    ]);
    if (existing) return send(res, 200, { ok: true, status: "claimed", claim: JSON.parse(existing) });
    if (!isPlayer) return send(res, 200, { ok: true, status: "not_found" });
    if (b.check) return send(res, 200, { ok: true, status: "eligible" });

    const egg = Math.max(0, Math.min(4, parseInt(b.egg, 10) || 0));
    const claim = { amount: pickPrize(), code: makeCode(), egg, at: new Date().toISOString() };

    // SET ... NX only succeeds once per phone, even if two requests arrive together.
    const ok = await cmd("SET", KEYS.claim(phone), JSON.stringify(claim), "NX");
    if (ok !== "OK") {
      const again = await cmd("GET", KEYS.claim(phone));
      return send(res, 200, { ok: true, status: "claimed", claim: JSON.parse(again) });
    }

    await pipeline([
      ["LPUSH", KEYS.recent, JSON.stringify({ p: phone.slice(-4), a: claim.amount, t: claim.at })],
      ["LTRIM", KEYS.recent, "0", "49"],
      ["LPUSH", KEYS.log, JSON.stringify({ phone, ...claim })],
      ["INCR", KEYS.count],
      ["INCRBY", KEYS.total, String(claim.amount)],
    ]);
    return send(res, 200, { ok: true, status: "won", claim });
  } catch (e) {
    return handleError(res, e);
  }
};
