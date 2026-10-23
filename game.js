(function () {
  const G = window.GAME;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Saved result (one claim per player on this device) ----------
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
  $("registerBtn").href = G.registerUrl;

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

  const pickPrize = () => {
    const total = G.prizes.reduce((s, p) => s + p.weight, 0);
    let r = Math.random() * total;
    for (const p of G.prizes) { if ((r -= p.weight) < 0) return p.amount; }
    return G.prizes[0].amount;
  };
  const makeCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "XM-";
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };
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
  $("phoneForm").addEventListener("submit", (e) => e.preventDefault());
  $("phone").addEventListener("input", () => ($("phoneErr").textContent = ""));

  // ---------- Recent winners list ----------
  function renderWinners(own) {
    const rows = (window.RECENT_CLAIMS || []).slice(0, 30).map((w) => ({ ...w, you: false }));
    if (own) rows.unshift({ phone: own.phone.slice(-4), amount: own.amount, you: true });
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
    renderWinners(data.phone ? data : null);
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

  async function smash(egg) {
    if (busy || load()) return;
    const phone = cleanPhone($("phone").value);
    if (!phone) {
      $("phoneErr").textContent = "Sila masukkan nombor telefon yang sah dahulu (contoh: 0123456789).";
      $("phone").focus();
      $("phoneForm").classList.remove("nudge"); void $("phoneForm").offsetWidth; $("phoneForm").classList.add("nudge");
      return;
    }
    busy = true;
    const i = +egg.dataset.i;
    const data = { amount: pickPrize(), code: makeCode(), egg: i, phone, at: new Date().toISOString() };
    $("phone").disabled = true;
    save(data); // saved first, so refreshing mid-animation cannot give a second try

    eggs.forEach((b) => { b.disabled = true; if (b !== egg) b.classList.add("faded"); });
    egg.classList.add("picked");
    $("status").textContent = "🔨 Smash! Smash! Smash!";
    placeHammer(egg);

    for (let hit = 1; hit <= 3; hit++) {
      const h = $("hammer");
      h.classList.remove("swing"); void h.offsetWidth; h.classList.add("swing");
      await wait(220);
      egg.classList.remove("shake"); void egg.offsetWidth; egg.classList.add("shake", "crack" + hit);
      if (navigator.vibrate) navigator.vibrate(30);
      await wait(260);
    }
    $("hammer").classList.remove("show", "swing");
    egg.classList.add("broken");
    burst(egg, data.amount);
    await wait(900);
    openModal(data);
    showClaimed(data);
    busy = false;
  }

  eggs.forEach((b) => b.addEventListener("click", () => smash(b)));

  const saved = load();
  if (saved) showClaimed(saved);
  else renderWinners(null);

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
