(function () {
  // ---------- Settings per brand page (/claw/<brand>) ----------
  const BRANDS = {
    ggc: {
      campaign: "clawggc",                        // server data for this page
      claimUrl: "https://ggc365.space/",          // Live Chat buttons
      storageKey: "treasure-claw-2026-ggc",       // remembers the result on the player's phone
    },
  };
  const m = location.pathname.match(/\/claw\/([a-z0-9]+)/i);
  const G = BRANDS[m && BRANDS[m[1].toLowerCase()] ? m[1].toLowerCase() : "ggc"];

  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 150) : ms));

  // ---------- Saved result on this phone (the server is the real check) ----------
  const load = () => { try { return JSON.parse(localStorage.getItem(G.storageKey)); } catch (e) { return null; } };
  const save = (d) => { try { localStorage.setItem(G.storageKey, JSON.stringify(d)); } catch (e) {} };

  ["claimBtn", "claimedBtn", "chatBtn"].forEach((id) => ($(id).href = G.claimUrl));

  // ---------- Chests ----------
  const chests = [...document.querySelectorAll(".chest")];
  chests.forEach((c) => {
    c.innerHTML = '<svg viewBox="0 0 100 80"><use href="#chestBody"/><g class="lid"><use href="#chestLid"/></g></svg>';
  });

  // ---------- Server ----------
  async function api(path, data) {
    const r = await fetch(path, {
      method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    const out = await r.json().catch(() => ({ ok: false, error: "server_error" }));
    if (r.status === 429) out.error = "too_many";
    return out;
  }

  const cleanPhone = (v) => {
    let d = String(v || "").replace(/\D/g, "");
    if (d.startsWith("60")) d = d.slice(1);
    return /^01\d{8,9}$/.test(d) ? d : "";
  };
  const MESSAGES = {
    not_found: "Nombor ini tidak berdaftar untuk event ini. Sila hubungi Live Chat.",
    invalid_phone: "Sila masukkan nombor telefon yang sah (contoh: 60123456789).",
    too_many: "Terlalu banyak cubaan. Sila cuba lagi selepas 10 minit.",
    db_not_connected: "Sistem belum sedia. Sila hubungi Live Chat.",
    server_error: "Ralat sambungan. Sila cuba lagi.",
  };
  function phoneError(msg) {
    $("phoneErr").textContent = msg;
    $("phone").focus();
    $("phoneForm").classList.remove("nudge"); void $("phoneForm").offsetWidth; $("phoneForm").classList.add("nudge");
  }

  // ---------- Winners list ----------
  let winners = [], mine = null;
  async function loadWinners() {
    try { const out = await api("/api/winners?brand=" + G.campaign); if (out.ok) { winners = out.winners; renderWinners(); } } catch (e) {}
  }
  function renderWinners() {
    const rows = winners.map((w) => ({ ...w, you: !!mine && w.at === mine.at && String(w.phone) === mine.phone.slice(-4) }));
    if (mine && mine.phone && !rows.some((w) => w.you)) rows.unshift({ phone: mine.phone.slice(-4), amount: mine.amount, you: true });
    const html = rows.map((w) =>
      `<li${w.you ? ' class="you"' : ""}><span>****${String(w.phone).slice(-4)}${w.you ? " <em>Anda</em>" : ""}</span><b>RM${Number(w.amount)}</b></li>`).join("");
    const list = $("winList");
    $("winEmpty").hidden = rows.length > 0;
    list.parentElement.hidden = rows.length === 0;
    const scroll = rows.length > 5 && !reduceMotion;
    list.innerHTML = scroll ? html + html : html;
    list.classList.toggle("scroll", scroll);
    list.style.animationDuration = rows.length * 2.2 + "s";
  }

  // ---------- Claw movement ----------
  const glass = $("glass"), carriage = $("carriage"), claw = $("claw");
  let verified = "", moving = false, busy = false, x = 0, dir = 1, last = 0, timer = null;

  // Centre of each chest, measured from the left of the glass.
  const centers = () => {
    const g = glass.getBoundingClientRect();
    return chests.map((c) => { const r = c.getBoundingClientRect(); return r.left - g.left + r.width / 2; });
  };
  const place = (px) => { carriage.style.left = px + "px"; };
  function parkCenter() { const c = centers(); x = c[2]; place(x); }

  function step(t) {
    if (!moving) return;
    const c = centers(), min = c[0], max = c[c.length - 1];
    const dt = last ? Math.min(50, t - last) : 16;
    last = t;
    x += dir * ((max - min) / 1500) * dt; // one full sweep about 1.5 s
    if (x >= max) { x = max; dir = -1; }
    if (x <= min) { x = min; dir = 1; }
    place(x);
    requestAnimationFrame(step);
  }
  function startMoving() {
    moving = true; last = 0;
    claw.classList.add("open");
    requestAnimationFrame(step);
    let left = 10;
    $("countdown").hidden = false;
    $("countdown").textContent = left;
    timer = setInterval(() => {
      left -= 1;
      $("countdown").textContent = left;
      if (left <= 0) drop(); // drops by itself after 10 seconds
    }, 1000);
  }

  function lock() {
    verified = ""; moving = false;
    clearInterval(timer);
    $("countdown").hidden = true;
    glass.classList.add("locked");
    $("lockNote").hidden = false;
    $("dropBtn").disabled = true;
    claw.classList.remove("open", "closed");
    carriage.style.setProperty("--drop", "0px");
    chests.forEach((c) => { c.style.transform = ""; c.classList.remove("open", "faded"); });
    parkCenter();
  }
  function unlock(phone) {
    verified = phone;
    glass.classList.remove("locked");
    $("lockNote").hidden = true;
    $("dropBtn").disabled = false;
    $("status").textContent = "✅ Nombor disahkan! Tekan DROP untuk tangkap peti.";
    startMoving();
  }

  // ---------- PLAY: check the number ----------
  $("phoneForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || load() || verified) return;
    const phone = cleanPhone($("phone").value);
    if (!phone) return phoneError(MESSAGES.invalid_phone);
    $("playBtn").disabled = true; $("playBtn").textContent = "...";
    const out = await api("/api/play", { brand: G.campaign, phone, check: true }).catch(() => ({ ok: false, error: "server_error" }));
    $("playBtn").disabled = false; $("playBtn").textContent = "PLAY";
    if (!out.ok) return phoneError(MESSAGES[out.error] || MESSAGES.server_error);
    if (out.status === "not_found") return phoneError(MESSAGES.not_found);
    if (out.status === "claimed") {
      const data = { ...out.claim, phone };
      save(data); showClaimed(data);
      $("status").textContent = "⚠️ Nombor ini sudah bermain. Tuntut hadiah anda di Live Chat.";
      return;
    }
    $("phone").disabled = true;
    unlock(phone);
    glass.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  });
  $("phone").addEventListener("input", () => ($("phoneErr").textContent = ""));

  // ---------- DROP ----------
  async function drop() {
    if (!moving || busy) return;
    busy = true; moving = false;
    clearInterval(timer);
    $("countdown").hidden = true;
    $("dropBtn").disabled = true;
    $("status").textContent = "⬇ Cakar sedang turun...";

    // Line up with the nearest chest.
    const c = centers();
    let i = 0;
    c.forEach((v, k) => { if (Math.abs(v - x) < Math.abs(c[i] - x)) i = k; });
    carriage.style.transition = "left .25s ease";
    place(c[i]); x = c[i];
    await wait(260);
    carriage.style.transition = "";

    // Lower the claw so its fingers reach around the chest lid.
    const chest = chests[i];
    const g = glass.getBoundingClientRect(), cr = chest.getBoundingClientRect(), cl = claw.getBoundingClientRect();
    const dropPx = Math.max(0, cr.top - cl.bottom + cr.height * 0.42);
    const request = api("/api/play", { brand: G.campaign, phone: verified, egg: i }).catch(() => ({ ok: false, error: "server_error" }));
    carriage.style.setProperty("--speed", "0.9s");
    chest.style.setProperty("--speed", "0.9s");
    carriage.style.setProperty("--drop", dropPx + "px");
    await wait(950);
    claw.classList.remove("open"); claw.classList.add("closed");
    if (navigator.vibrate) navigator.vibrate(40);
    await wait(380);

    const out = await request;
    if (!out.ok || out.status === "not_found") {
      claw.classList.remove("closed"); claw.classList.add("open");
      carriage.style.setProperty("--drop", "0px");
      await wait(900);
      busy = false; $("phone").disabled = false;
      lock();
      $("status").textContent = "📱 Masukkan nombor telefon akaun anda untuk mula.";
      return phoneError(MESSAGES[out.ok ? "not_found" : out.error] || MESSAGES.server_error);
    }
    const data = { ...out.claim, phone: verified };
    if (out.status === "claimed") {
      busy = false; save(data); showClaimed(data);
      $("status").textContent = "⚠️ Nombor ini sudah bermain. Tuntut hadiah anda di Live Chat.";
      return;
    }

    // Lift the chest, then open it.
    if (!data.test) save(data);
    const lift = dropPx * 0.6;
    carriage.style.setProperty("--drop", dropPx - lift + "px");
    chest.style.transform = `translateY(${-lift}px)`;
    chests.forEach((o) => { if (o !== chest) o.classList.add("faded"); });
    $("status").textContent = "💎 Dapat! Membuka peti...";
    await wait(1000);
    chest.classList.add("open");
    burst(chest, data.amount);
    await wait(900);
    openModal(data);
    showClaimed(data, true);
    loadWinners();
    busy = false;
  }
  $("dropBtn").addEventListener("click", drop);
  glass.addEventListener("click", drop);

  // ---------- Results ----------
  function showClaimed(data, keepScene) {
    $("claimedAmount").textContent = "RM" + data.amount;
    $("claimedCode").textContent = data.code;
    $("claimedPhone").textContent = data.phone || "-";
    $("phone").value = data.phone || "";
    $("phone").disabled = true;
    $("playBtn").disabled = true;
    $("dropBtn").disabled = true;
    $("lockNote").hidden = true;
    glass.classList.remove("locked");
    moving = false; clearInterval(timer); $("countdown").hidden = true;
    if (!keepScene) {
      // Show the chest this number opened before.
      const i = Math.max(0, Math.min(4, +data.egg || 0));
      chests.forEach((c, k) => c.classList.toggle("faded", k !== i));
      chests[i].classList.add("open");
      claw.classList.add("open");
    }
    mine = data.phone ? data : null;
    renderWinners();
    $("claimed").hidden = false;
    $("status").textContent = "✅ Anda sudah main. Tuntut hadiah anda di Live Chat.";
  }

  function openModal(data) {
    $("prize").textContent = "RM" + data.amount;
    $("code").textContent = data.code;
    $("modalPhone").textContent = data.phone;
    $("modal").hidden = false;
    $("claimBtn").focus();
  }
  $("closeModal").addEventListener("click", () => ($("modal").hidden = true));
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modal").hidden = true; });
  $("otherNumber").addEventListener("click", () => {
    try { localStorage.removeItem(G.storageKey); } catch (e) {}
    location.reload();
  });

  function burst(el, amount) {
    const fx = $("fx"), r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.3;
    for (let k = 0; k < (reduceMotion ? 0 : 24); k++) {
      const s = document.createElement("span");
      s.className = k % 3 === 0 ? "bit star" : "bit coin";
      s.textContent = k % 3 === 0 ? "✦" : "";
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 110;
      s.style.left = cx + "px"; s.style.top = cy + "px";
      s.style.setProperty("--dx", Math.cos(a) * d + "px");
      s.style.setProperty("--dy", Math.sin(a) * d - 60 + "px");
      fx.appendChild(s);
      setTimeout(() => s.remove(), 1400);
    }
    const tag = document.createElement("div");
    tag.className = "pop-amount";
    tag.textContent = "RM" + amount;
    tag.style.left = cx + "px"; tag.style.top = cy + "px";
    fx.appendChild(tag);
    setTimeout(() => tag.remove(), 1600);
  }

  // ---------- Start ----------
  addEventListener("resize", () => { if (!moving && !busy) parkCenter(); });
  const saved = load();
  if (saved) { requestAnimationFrame(() => { parkCenter(); showClaimed(saved); }); }
  else { requestAnimationFrame(lock); renderWinners(); }
  loadWinners();
  setInterval(loadWinners, 30000);
})();
