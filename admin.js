(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = "smashEggAdminToken";
  let token = "";
  let role = "";
  let myName = "";
  let brand = "ggc";
  let allBrands = [];
  try { brand = sessionStorage.getItem("smashEggBrand") || "ggc"; } catch (e) {}
  try { token = sessionStorage.getItem(KEY) || ""; } catch (e) {}
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const cleanPhone = (v) => {
    let d = String(v == null ? "" : v).replace(/\D/g, "");
    if (d.startsWith("60")) d = d.slice(1);
    return /^01\d{8,9}$/.test(d) ? d : "";
  };

  async function call(action, data = {}) {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ action, brand, ...data }),
    });
    const out = await r.json().catch(() => ({ ok: false, error: "server_error" }));
    // Logged out (expired after 12 hours, or account deleted): back to the login box.
    if (out.error === "not_logged_in" && action !== "login") showLogin("Sesi tamat. Sila log masuk semula.");
    return out;
  }
  const errText = (e) => ({
    wrong_login: "Nama pengguna atau kata laluan salah.",
    too_many: "Terlalu banyak cubaan. Cuba lagi selepas 10 minit.",
    not_logged_in: "Sila log masuk semula.",
    no_permission: "Anda tiada kebenaran untuk tindakan ini.",
    db_not_connected: "Database belum disambung di Vercel.",
    invalid_phone: "Nombor telefon tidak sah.",
    bad_username: "Nama pengguna: 3–20 huruf kecil, nombor, titik atau sengkang.",
    bad_password: "Kata laluan mesti sekurang-kurangnya 8 aksara.",
    bad_role: "Pilih peranan.",
    user_exists: "Nama pengguna sudah wujud.",
    bad_brands: "Pilih sekurang-kurangnya satu brand.",
    no_brand_access: "Anda tiada akses kepada brand ini.",
    unknown_brand: "Brand tidak wujud.",
    wrong_old_password: "Kata laluan lama salah.",
  }[e] || "Ralat: " + e);

  // ---------- Login ----------
  function showLogin(msg) {
    token = "";
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    $("panel").hidden = true;
    $("login").hidden = false;
    $("loginMsg").textContent = msg || "";
  }
  async function enter() {
    const me = await call("me");
    if (!me.ok) return showLogin(me.error === "not_logged_in" ? "" : errText(me.error));
    role = me.role;
    myName = me.user;
    $("whoami").textContent = `Log masuk sebagai ${me.user} (${me.role})`;
    document.querySelectorAll("[data-roles]").forEach((el) => {
      if (!el.dataset.roles.split(" ").includes(role)) el.remove();
    });

    // Brand switch: only the brands this account may see.
    allBrands = me.allBrands || [];
    const mine = me.brands || [];
    if (!mine.some((x) => x.key === brand)) brand = mine.length ? mine[0].key : "ggc";
    $("brandSel").innerHTML = mine.map((x) => `<option value="${esc(x.key)}">${esc(x.name)}</option>`).join("");
    $("brandSel").value = brand;
    $("brandSel").disabled = mine.length < 2;
    showBrand();
    if ($("newBrands")) {
      $("newBrands").innerHTML = allBrands.map((x) =>
        `<label class="check"><input type="checkbox" value="${esc(x.key)}" checked> ${esc(x.name)}</label>`).join("");
    }

    $("login").hidden = true;
    $("panel").hidden = false;
    refresh();
  }

  function brandName(k) { const x = allBrands.find((b) => b.key === k); return x ? x.name : k.toUpperCase(); }
  function showBrand() {
    document.querySelectorAll(".brand-name").forEach((el) => (el.textContent = brandName(brand)));
  }
  $("brandSel").addEventListener("change", () => {
    brand = $("brandSel").value;
    try { sessionStorage.setItem("smashEggBrand", brand); } catch (e) {}
    showBrand();
    // Clear anything that belonged to the previous brand, then reload what's on screen.
    $("lookupResult").textContent = "";
    if ($("lookupActions")) $("lookupActions").hidden = true;
    $("claimsTable").hidden = true;
    $("claimsInfo").textContent = "";
    const open = document.querySelector(".nav .on");
    if (open && OPEN[open.dataset.go]) OPEN[open.dataset.go]();
    else refresh();
  });

  // ---------- Sidebar categories ----------
  const OPEN = {
    summary: () => refresh(),
    claims: () => loadClaims(),
    users: () => loadUsers(),
    audit: () => $("loadAudit").click(),
  };
  document.querySelectorAll(".nav [data-go]").forEach((b) =>
    b.addEventListener("click", () => {
      const go = b.dataset.go;
      document.querySelectorAll(".nav [data-go]").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== go));
      if (OPEN[go]) OPEN[go]();
      window.scrollTo(0, 0);
    })
  );
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = await call("login", { username: $("username").value, password: $("password").value });
    if (!out.ok) { $("loginMsg").textContent = errText(out.error); return; }
    token = out.token;
    try { sessionStorage.setItem(KEY, token); } catch (e) {}
    $("password").value = "";
    enter();
  });
  $("logout").addEventListener("click", async () => {
    await call("logout").catch(() => {});
    showLogin("");
    location.reload();
  });
  if (token) enter();

  // ---------- Stats ----------
  function showStats(s) {
    $("sPlayers").textContent = Number(s.players).toLocaleString();
    $("sClaims").textContent = Number(s.claims).toLocaleString();
    $("sTotal").textContent = "RM" + Number(s.totalRM).toLocaleString();
  }
  const refresh = async () => { const s = await call("stats"); if (s.ok) showStats(s); };
  $("refresh").addEventListener("click", refresh);

  // ---------- Add players ----------
  let fileText = "";

  // Small CSV reader that handles quoted fields.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Finds phone numbers. Uses only the "Phone" column when the file has one.
  function extractPhones(text) {
    if (!text.trim()) return [];
    const rows = parseCsv(text);
    const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
    const col = head.findIndex((h) => /phone|telefon|mobile|hp/.test(h));
    const values = col >= 0
      ? rows.slice(1).map((r) => r[col])
      : text.split(/[\s,;|]+/);
    return values.map(cleanPhone).filter(Boolean);
  }

  function collect() {
    const all = [...extractPhones($("paste").value), ...extractPhones(fileText)];
    return [...new Set(all)];
  }
  function updateInfo() {
    const n = collect().length;
    $("addBtn").disabled = n === 0;
    $("addBtn").textContent = n ? `Tambah ${n.toLocaleString()} nombor` : "Tambah";
    $("addInfo").className = "msg muted";
    $("addInfo").textContent = n ? `${n.toLocaleString()} nombor sah dijumpai.` : "";
  }
  $("paste").addEventListener("input", updateInfo);
  $("file").addEventListener("change", async () => {
    const f = $("file").files[0];
    fileText = f ? await f.text() : "";
    updateInfo();
  });

  $("addBtn").addEventListener("click", async () => {
    const phones = collect();
    if (!phones.length) return;
    const replace = $("replaceList").checked;
    if (replace && !confirm(`Padam SEMUA nombor ${brandName(brand)} dahulu, kemudian tambah ${phones.length.toLocaleString()} nombor ini?`)) return;
    $("addBtn").disabled = true;
    if (replace) {
      $("addInfo").className = "msg muted";
      $("addInfo").textContent = "Memadam senarai lama...";
      const wiped = await call("clearPlayers", { confirm: "DELETE" });
      if (!wiped.ok) {
        $("addInfo").className = "msg err";
        $("addInfo").textContent = errText(wiped.error);
        $("addBtn").disabled = false;
        return;
      }
    }
    let added = 0;
    for (let i = 0; i < phones.length; i += 2000) {
      $("addInfo").textContent = `Menghantar ${Math.min(i + 2000, phones.length).toLocaleString()} / ${phones.length.toLocaleString()}...`;
      const out = await call("add", { phones: phones.slice(i, i + 2000) });
      if (!out.ok) {
        $("addInfo").className = "msg err";
        $("addInfo").textContent = errText(out.error);
        $("addBtn").disabled = false;
        return;
      }
      added += out.added;
    }
    $("addInfo").className = "msg ok";
    $("addInfo").textContent = replace
      ? `Siap. Senarai lama dipadam, ${added.toLocaleString()} nombor ditambah.`
      : `Siap. ${added.toLocaleString()} nombor baharu ditambah (${(phones.length - added).toLocaleString()} sudah ada).`;
    $("paste").value = ""; $("file").value = ""; fileText = "";
    $("replaceList").checked = false;
    $("addBtn").textContent = "Tambah";
    refresh();
  });

  // ---------- Lookup ----------
  let current = "";
  $("lookupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = await call("lookup", { phone: $("lookupPhone").value });
    const box = $("lookupResult");
    if (!out.ok) { box.className = "msg err"; box.textContent = errText(out.error); if ($("lookupActions")) $("lookupActions").hidden = true; return; }
    current = out.phone;
    box.className = "msg";
    box.innerHTML = `<b>${out.phone}</b>: ${out.isPlayer ? '<span class="ok">pemain berdaftar</span>' : '<span class="err">tiada dalam senarai</span>'}` +
      (out.claim ? `<br>Sudah tuntut <b>RM${out.claim.amount}</b>, kod <b>${out.claim.code}</b>, ${new Date(out.claim.at).toLocaleString()}` : "<br>Belum main.");
    if ($("lookupActions")) {
      $("lookupActions").hidden = false;
      $("resetBtn").hidden = !out.claim;
      $("removeBtn").hidden = !out.isPlayer;
    }
  });
  $("resetBtn").addEventListener("click", async () => {
    if (!confirm(`Benarkan ${current} main sekali lagi?`)) return;
    const out = await call("resetClaim", { phone: current });
    $("lookupResult").textContent = out.ok ? `${current} boleh main semula.` : errText(out.error);
    if ($("lookupActions")) $("lookupActions").hidden = true;
  });
  $("removeBtn").addEventListener("click", async () => {
    if (!confirm(`Buang ${current} dari senarai pemain?`)) return;
    const out = await call("remove", { phone: current });
    $("lookupResult").textContent = out.ok ? `${current} dibuang.` : errText(out.error);
    if ($("lookupActions")) $("lookupActions").hidden = true;
    refresh();
  });

  // ---------- Claims ----------
  let claims = [];
  async function loadClaims() {
    const out = await call("claims");
    if (!out.ok) { $("claimsInfo").textContent = errText(out.error); return false; }
    claims = out.claims;
    const tbody = $("claimsTable").querySelector("tbody");
    tbody.innerHTML = claims.map((c) =>
      `<tr><td>${new Date(c.at).toLocaleString()}</td><td>${c.phone}</td><td>RM${c.amount}</td><td>${c.code}</td></tr>`
    ).join("");
    $("claimsTable").hidden = claims.length === 0;
    $("claimsInfo").textContent = claims.length ? `${claims.length.toLocaleString()} tuntutan.` : "Belum ada tuntutan.";
    return true;
  }
  $("loadClaims").addEventListener("click", loadClaims);
  $("downloadClaims").addEventListener("click", async () => {
    if (!(await loadClaims())) return;
    const lines = [["Time", "Phone", "Amount (RM)", "Code"]].concat(
      claims.map((c) => [new Date(c.at).toLocaleString(), "\t" + c.phone, c.amount, c.code])
    );
    const csv = lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = `smash-egg-claims-${brand}.csv`;
    a.click();
  });

  // ---------- Users (owner only) ----------
  async function loadUsers() {
    const out = await call("listUsers");
    if (!out.ok) { $("userMsg").className = "msg err"; $("userMsg").textContent = errText(out.error); return; }
    $("usersTable").querySelector("tbody").innerHTML =
      `<tr><td><b>${esc(myName)}</b></td><td>owner</td><td>Semua</td><td class="muted">–</td><td></td></tr>` +
      out.users.map((u) =>
        `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.role)}</td><td>${esc(u.brands.map(brandName).join(", "))}</td><td>${new Date(u.created).toLocaleDateString()}</td>` +
        `<td><button class="ghost" data-brands="${esc(u.username)}" data-current="${esc(u.brands.join(","))}">Akses brand</button>` +
        `<button class="ghost" data-pass="${esc(u.username)}">Tukar kata laluan</button><button class="danger" data-del="${esc(u.username)}">Padam</button></td></tr>`
      ).join("");
  }
  if ($("usersTable")) {
    $("usersTable").addEventListener("click", async (e) => {
      const del = e.target.dataset.del, pass = e.target.dataset.pass;
      if (del) {
        if (!confirm(`Padam pengguna ${del}? Mereka akan dilog keluar serta-merta.`)) return;
        const out = await call("removeUser", { username: del });
        $("userMsg").className = out.ok ? "msg ok" : "msg err";
        $("userMsg").textContent = out.ok ? `${del} dipadam.` : errText(out.error);
        loadUsers();
      } else if (pass) {
        const p = prompt(`Kata laluan baharu untuk ${pass} (min 8 aksara):`);
        if (!p) return;
        const out = await call("setPassword", { username: pass, password: p });
        $("userMsg").className = out.ok ? "msg ok" : "msg err";
        $("userMsg").textContent = out.ok ? `Kata laluan ${pass} ditukar.` : errText(out.error);
      } else if (e.target.dataset.brands) {
        const u = e.target.dataset.brands;
        const keys = allBrands.map((x) => x.key).join(", ");
        const v = prompt(`Brand yang ${u} boleh lihat (pisahkan dengan koma).\nPilihan: ${keys}`, e.target.dataset.current.replace(/,/g, ", "));
        if (v == null) return;
        const out = await call("setUserBrands", { username: u, brands: v.toLowerCase().split(/[\s,]+/).filter(Boolean) });
        $("userMsg").className = out.ok ? "msg ok" : "msg err";
        $("userMsg").textContent = out.ok ? `Akses brand ${u} dikemas kini.` : errText(out.error);
        loadUsers();
      }
    });
    $("addUserForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("newUser").value.trim().toLowerCase();
      const brands = [...document.querySelectorAll("#newBrands input:checked")].map((x) => x.value);
      const out = await call("addUser", { username, password: $("newPass").value, role: $("newRole").value, brands });
      $("userMsg").className = out.ok ? "msg ok" : "msg err";
      $("userMsg").textContent = out.ok ? `Pengguna ${username} ditambah. Beri nama pengguna dan kata laluan kepada mereka.` : errText(out.error);
      if (out.ok) { $("newUser").value = ""; $("newPass").value = ""; loadUsers(); }
    });
  }

  // ---------- Settings: my password (everyone) ----------
  $("myPassForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if ($("myNewPass").value !== $("myNewPass2").value) {
      $("myPassMsg").className = "msg err";
      $("myPassMsg").textContent = "Kata laluan baharu tidak sama.";
      return;
    }
    const out = await call("changeMyPassword", { oldPassword: $("oldPass").value, password: $("myNewPass").value });
    $("myPassMsg").className = out.ok ? "msg ok" : "msg err";
    $("myPassMsg").textContent = out.ok ? "Kata laluan ditukar. Gunakan kata laluan baharu untuk log masuk seterusnya." : errText(out.error);
    if (out.ok) { $("oldPass").value = ""; $("myNewPass").value = ""; $("myNewPass2").value = ""; }
  });

  // ---------- Activity log ----------
  if ($("loadAudit")) {
    $("loadAudit").addEventListener("click", async () => {
      const out = await call("audit");
      if (!out.ok) return;
      $("auditTable").querySelector("tbody").innerHTML = out.entries.map((a) =>
        `<tr><td>${new Date(a.at).toLocaleString()}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`
      ).join("");
      $("auditTable").hidden = out.entries.length === 0;
    });
  }

  // ---------- Delete all numbers (button on Ringkasan) ----------
  if ($("wipeBtn")) $("wipeBtn").addEventListener("click", async () => {
    const n = $("sPlayers").textContent;
    if (!confirm(`Padam SEMUA ${n} nombor pemain untuk ${brandName(brand)}?\n\nTuntutan dan pemenang tidak dipadam. Tindakan ini tidak boleh dibatalkan.`)) return;
    $("wipeBtn").disabled = true;
    const out = await call("clearPlayers", { confirm: "DELETE" });
    $("wipeBtn").disabled = false;
    $("wipeMsg").className = out.ok ? "msg ok" : "msg err";
    $("wipeMsg").textContent = out.ok ? `Semua nombor ${brandName(brand)} dipadam. Anda boleh muat naik senarai baharu di Pemain.` : errText(out.error);
    refresh();
  });

  // ---------- Clear players ----------
  if ($("clearBtn")) $("clearBtn").addEventListener("click", async () => {
    const out = await call("clearPlayers", { confirm: $("confirmDelete").value.trim() });
    $("clearMsg").className = out.ok ? "msg ok" : "msg err";
    $("clearMsg").textContent = out.ok ? "Senarai pemain dikosongkan." : out.error === "confirm" ? "Taip DELETE untuk sahkan." : errText(out.error);
    $("confirmDelete").value = "";
    refresh();
  });
})();
