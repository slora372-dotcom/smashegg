// GET /api/winners -> latest claims, last 4 phone digits only.
const { KEYS, cmd, send, handleError } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const rows = (await cmd("LRANGE", KEYS.recent, "0", "29")) || [];
    const winners = rows.map((r) => { const w = JSON.parse(r); return { phone: w.p, amount: w.a, at: w.t }; });
    res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");
    res.setHeader("Content-Type", "application/json");
    res.status(200).end(JSON.stringify({ ok: true, winners }));
  } catch (e) {
    return handleError(res, e);
  }
};
