// Settings for each Christmas Smash Egg brand page (/smashegg/<brand>).
// Prizes and player lists live on the server (api/_lib.js and the /admin page).
// To add a brand: add it here, in api/_lib.js, and copy the smashegg/ggc folder.

window.GAME_BRANDS = {
  ggc: {
    claimUrl: "https://ggc365.space/",                    // "Live Chat" and "Claim at Live Chat"
    storageKey: "xmas-smash-egg-2026",                    // remembers the result on the player's phone
  },
  ppg: {
    claimUrl: "https://ppg668.cc",
    storageKey: "xmas-smash-egg-2026-ppg",
  },
};

// The brand comes from the page address, e.g. /smashegg/ppg -> "ppg".
(function () {
  const m = location.pathname.match(/\/smashegg\/([a-z0-9]+)/i);
  const brand = m && window.GAME_BRANDS[m[1].toLowerCase()] ? m[1].toLowerCase() : "ggc";
  window.GAME = Object.assign({ brand, brandName: "", logo: "" }, window.GAME_BRANDS[brand]);
})();
