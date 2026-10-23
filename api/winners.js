// GET /api/winners?brand=ggc -> latest claims for that brand, last 4 phone digits only.
const { brandOf, keysFor, cmd, send, handleError } = require("./_lib");

module.exports = async (req, res) => {
  try {
    const brand = brandOf((req.query && req.query.brand) || "ggc");
    if (!brand) return send(res, 400, { ok: false, error: "unknown_brand" });
    const rows = (await cmd("LRANGE", keysFor(brand).recent, "0", "29")) || [];
    const winners = rows.map((r) => { const w = JSON.parse(r); return { phone: w.p, amount: w.a, at: w.t }; });
    res.setHeader("Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");
    res.setHeader("Content-Type", "application/json");
    res.status(200).end(JSON.stringify({ ok: true, winners }));
  } catch (e) {
    return handleError(res, e);
  }
};
