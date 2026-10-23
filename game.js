(function () {
  const G = window.GAME;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Saved result on this phone (the server is the real check) ----------
  const load = () => {
    try { return JSON.parse(localStorage.getItem(G.storageKey)); } catch (e) { return null; }
  };
  const save = (data) => {
    try { localStorage.setItem(G.storageKey, JSON.stringify(data)); } catch (e) {}
  };
  // Open the page with ?reset=1 to clear the saved result while testing.
  if (new URLSearchParams(location.search).get("reset") === "1") {
    try { localStorage.removeItem(G.storageKey); } catch (e) {}
    history.replaceState(null, "", location.pathname);
  }

  // ---------- Brand and links ----------
  if (G.logo) $("brand").innerHTML = `<img src="${G.logo}" alt="${G.brandName || ""}">`;
  else if (G.brandName) $("brand").textContent = G.brandName;
  ["claimBtn", "claimedBtn", "chatBtn"].forEach((id) => ($(id).href = G.claimUrl));

  // ---------- Eggs ----------
  const eggSvg = `
    <svg viewBox="0 0 100 140" aria-hidden="true">
      <use class="whole" href="#eggArt"/>
      <g class="half top" clip-path="url(#topHalf)"><use href="#eggArt"/></g>
      <g class="half bottom" clip-path="url(#bottomHalf)"><use href="#eggArt"/></g>
      <g class="cracks" fill="none" stroke="#5a2d00" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path class="crack c1" d="M50 34 46 48 55 57 47 69"/>
        <path class="crack c2" d="M47 69 35 77 29 90M55 57 67 64 74 79"/>
        <path class="crack c3" d="M29 90 21 101M74 79 82 95M46 48 33 44M67 64 80 58"/>
      </g>
    </svg>`;
  const eggs = [...document.querySelectorAll(".egg")];
  eggs.forEach((b) => (b.innerHTML = eggSvg));

  // ---------- Server ----------
  // Opened straight from a file on the computer there is no server, so the
  // page runs a preview: any valid number can play and nothing is saved.
  const DEMO = location.protocol === "file:";
  if (DEMO) $("demo").hidden = false;

  async function api(path, data) {
    if (DEMO) return demoApi(path, data);
    const r = await fetch(path, {
      method: data ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    const out = await r.json().catch(() => ({ ok: false, error: "server_error" }));
    if (r.status === 429) out.error = "too_many";
    return out;
  }
  function demoApi(path, data) {
    if (path.includes("winners")) return { ok: true, winners: [] };
    if (data.check) return { ok: true, status: "eligible" };
    const w = [16, 16, 14, 12, 10, 7, 6, 5, 4, 3, 2, 2, 1, 1, 1];
    let r = Math.random() * 100, amount = 1;
    for (let i = 0; i < w.length; i++) { if ((r -= w[i]) < 0) { amount = i + 1; break; } }
    const code = "XM-DEMO" + Math.floor(Math.random() * 90 + 10);
    return { ok: true, status: "won", claim: { amount, code, egg: data.egg, at: new Date().toISOString() } };
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 120) : ms));

  let busy = false;

  // ---------- Phone number ----------
  // Accepts 012-345 6789, +6012..., 6012... and returns 0123456789, or "" if not valid.
  const cleanPhone = (v) => {
    let d = String(v || "").replace(/\D/g, "");
    if (d.startsWith("60")) d = d.slice(1);
    return /^01\d{8,9}$/.test(d) ? d : "";
  };
  const mask = (last4) => "****" + last4;
  // ---------- PLAY: eggs unlock only for numbers in the player list ----------
  let verified = "";
  function lockEggs() {
    verified = "";
    $("stage").classList.add("locked");
    $("lockNote").hidden = false;
    eggs.forEach((b) => (b.disabled = true));
  }
  function unlockEggs(phone) {
    verified = phone;
    $("stage").classList.remove("locked");
    $("lockNote").hidden = true;
    eggs.forEach((b) => (b.disabled = false));
    $("status").textContent = "✅ Nombor disahkan! Pilih dan tekan satu telur.";
  }

  $("phoneForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || load()) return;
    const phone = cleanPhone($("phone").value);
    if (!phone) return phoneError(MESSAGES.invalid_phone);
    $("playBtn").disabled = true;
    $("playBtn").textContent = "...";
    const out = await api("/api/play", { phone, check: true }).catch(() => ({ ok: false, error: "server_error" }));
    $("playBtn").disabled = false;
    $("playBtn").textContent = "PLAY";
    if (!out.ok) return phoneError(MESSAGES[out.error] || MESSAGES.server_error);
    if (out.status === "not_found") return phoneError(MESSAGES.not_found);
    if (out.status === "claimed") {
      const data = { ...out.claim, phone };
      save(data);
      showClaimed(data);
      $("status").textContent = "⚠️ Nombor ini sudah bermain. Tuntut hadiah anda di Live Chat.";
      return;
    }
    unlockEggs(phone);
    $("stage").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  });
  $("phone").addEventListener("input", () => {
    $("phoneErr").textContent = "";
    if (verified && cleanPhone($("phone").value) !== verified) {
      lockEggs();
      $("status").textContent = "📱 Tekan PLAY untuk sahkan nombor baharu.";
    }
  });

  // ---------- Recent winners list (from the server) ----------
  let winners = [];
  let mine = null;
  async function loadWinners() {
    try {
      const out = await api("/api/winners");
      if (out.ok) { winners = out.winners; renderWinners(); }
    } catch (e) {}
  }
  function renderWinners() {
    const rows = winners.map((w) => ({
      ...w,
      you: !!mine && w.at === mine.at && String(w.phone) === mine.phone.slice(-4),
    }));
    if (mine && mine.phone && !rows.some((w) => w.you)) {
      rows.unshift({ phone: mine.phone.slice(-4), amount: mine.amount, you: true });
    }
    const html = rows.map((w) =>
      `<li${w.you ? ' class="you"' : ""}><span>${mask(String(w.phone).slice(-4))}${w.you ? ' <em>Anda</em>' : ""}</span><b>RM${Number(w.amount)}</b></li>`
    ).join("");
    const list = $("winList");
    $("winEmpty").hidden = rows.length > 0;
    list.parentElement.hidden = rows.length === 0;
    // More than 5 rows: scroll the list slowly (rows are doubled so the loop is seamless).
    const scroll = rows.length > 5 && !reduceMotion;
    list.innerHTML = scroll ? html + html : html;
    list.classList.toggle("scroll", scroll);
    list.style.animationDuration = rows.length * 2.2 + "s";
  }

  function showClaimed(data) {
    $("claimedAmount").textContent = "RM" + data.amount;
    $("claimedCode").textContent = data.code;
    $("claimedPhone").textContent = data.phone || "-";
    $("phone").value = data.phone || "";
    $("phone").disabled = true;
    $("playBtn").disabled = true;
    $("stage").classList.remove("locked");
    $("lockNote").hidden = true;
    mine = data.phone ? data : null;
    renderWinners();
    $("claimed").hidden = false;
    $("status").textContent = "✅ Anda sudah smash. Tuntut hadiah anda di Live Chat.";
    eggs.forEach((b, i) => {
      b.disabled = true;
      if (i === data.egg) b.classList.add("broken", "picked");
      else b.classList.add("faded");
    });
  }

  function openModal(data) {
    $("prize").textContent = "RM" + data.amount;
    $("code").textContent = data.code;
    $("modalPhone").textContent = data.phone;
    $("modal").hidden = false;
    $("claimBtn").focus();
  }
  // Lets another player on the same phone enter their own number.
  $("otherNumber").addEventListener("click", () => {
    try { localStorage.removeItem(G.storageKey); } catch (e) {}
    location.reload();
  });
  $("closeModal").addEventListener("click", () => ($("modal").hidden = true));
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) $("modal").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modal").hidden = true; });

  // Hammer sits above the chosen egg and swings three times.
  function placeHammer(egg) {
    const stage = $("stage").getBoundingClientRect();
    const r = egg.getBoundingClientRect();
    const h = $("hammer");
    h.style.left = r.left - stage.left + r.width * 0.45 + "px";
    h.style.top = r.top - stage.top - r.width * 0.55 + "px";
    h.style.width = r.width * 0.9 + "px";
    h.classList.add("show");
  }

  function burst(egg, amount) {
    const fx = $("fx");
    const r = egg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
    const n = reduceMotion ? 0 : 26;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = i % 3 === 0 ? "bit star" : "bit coin";
      s.textContent = i % 3 === 0 ? "✦" : "";
      const a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 120;
      s.style.left = cx + "px";
      s.style.top = cy + "px";
      s.style.setProperty("--dx", Math.cos(a) * d + "px");
      s.style.setProperty("--dy", Math.sin(a) * d - 60 + "px");
      s.style.animationDelay = Math.random() * 0.1 + "s";
      fx.appendChild(s);
      setTimeout(() => s.remove(), 1400);
    }
    const tag = document.createElement("div");
    tag.className = "pop-amount";
    tag.textContent = "RM" + amount;
    tag.style.left = cx + "px";
    tag.style.top = cy + "px";
    fx.appendChild(tag);
    setTimeout(() => tag.remove(), 1600);
  }

  function phoneError(msg) {
    $("phoneErr").textContent = msg;
    $("phone").focus();
    $("phoneForm").classList.remove("nudge"); void $("phoneForm").offsetWidth; $("phoneForm").classList.add("nudge");
  }

  const MESSAGES = {
    not_found: "Nombor ini tidak berdaftar untuk event ini. Sila hubungi Live Chat.",
    invalid_phone: "Sila masukkan nombor telefon yang sah (contoh: 60123456789).",
    too_many: "Terlalu banyak cubaan. Sila cuba lagi selepas 10 minit.",
    db_not_connected: "Sistem belum sedia. Sila hubungi Live Chat.",
    server_error: "Ralat sambungan. Sila cuba lagi.",
  };

  // Puts the eggs back as they were when the server says no.
  function resetEggs() {
    $("hammer").classList.remove("show", "swing");
    eggs.forEach((b) => {
      b.disabled = false;
      b.classList.remove("faded", "picked", "shake", "crack1", "crack2", "crack3", "broken");
    });
    $("phone").disabled = false;
    $("playBtn").disabled = false;
    lockEggs();
    $("status").textContent = "📱 Masukkan nombor telefon akaun anda untuk mula.";
  }

  async function smash(egg) {
    if (busy || load() || !verified) return;
    const phone = verified;
    busy = true;
    const i = +egg.dataset.i;
    $("phone").disabled = true;
    $("playBtn").disabled = true;
    eggs.forEach((b) => { b.disabled = true; if (b !== egg) b.classList.add("faded"); });
    egg.classList.add("picked");
    $("status").textContent = "🔨 Smash! Smash! Smash!";
    placeHammer(egg);

    // Ask the server while the hammer swings.
    const request = api("/api/play", { phone, egg: i }).catch(() => ({ ok: false, error: "server_error" }));
    const hit = async (n) => {
      const h = $("hammer");
      h.classList.remove("swing"); void h.offsetWidth; h.classList.add("swing");
      await wait(220);
      egg.classList.remove("shake"); void egg.offsetWidth; egg.classList.add("shake", "crack" + n);
      if (navigator.vibrate) navigator.vibrate(30);
      await wait(260);
    };
    await hit(1);
    await hit(2);
    const out = await request;

    if (!out.ok || out.status === "not_found") {
      resetEggs();
      busy = false;
      return phoneError(MESSAGES[out.ok ? "not_found" : out.error] || MESSAGES.server_error);
    }

    const data = { ...out.claim, phone };
    if (out.status === "claimed") {
      // This number already played: show the prize it won before.
      resetEggs();
      save(data);
      showClaimed(data);
      $("status").textContent = "⚠️ Nombor ini sudah bermain. Tuntut hadiah anda di Live Chat.";
      busy = false;
      return;
    }

    save(data);
    await hit(3);
    $("hammer").classList.remove("show", "swing");
    egg.classList.add("broken");
    burst(egg, data.amount);
    await wait(900);
    openModal(data);
    showClaimed(data);
    loadWinners();
    busy = false;
  }

  eggs.forEach((b) => b.addEventListener("click", () => smash(b)));

  const saved = load();
  if (saved) showClaimed(saved);
  else { lockEggs(); renderWinners(); }
  loadWinners();
  setInterval(loadWinners, 30000);

  // ---------- Falling snow ----------
  const canvas = $("snow");
  const ctx = canvas.getContext("2d");
  let flakes = [];
  function resize() {
    canvas.width = innerWidth * devicePixelRatio;
    canvas.height = innerHeight * devicePixelRatio;
    const count = Math.round(Math.min(120, innerWidth / 6));
    flakes = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: (Math.random() * 2.2 + 0.8) * devicePixelRatio,
      s: (Math.random() * 0.6 + 0.3) * devicePixelRatio,
      w: Math.random() * Math.PI * 2,
    }));
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    for (const f of flakes) {
      f.y += f.s; f.w += 0.01; f.x += Math.sin(f.w) * 0.4;
      if (f.y > canvas.height) { f.y = -5; f.x = Math.random() * canvas.width; }
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  resize();
  addEventListener("resize", resize);
  if (!reduceMotion) draw();
})();
