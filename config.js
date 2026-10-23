// Settings for the Christmas Smash Egg page. Change these per brand.

window.GAME = {
  // Shown at the top. Leave logo empty ("") to show text only.
  brandName: "",
  logo: "",

  // Where the buttons go.
  claimUrl: "https://ppg668.cc/register.php?r=BMMTH",    // "Claim at Live Chat"
  registerUrl: "https://ppg668.cc/register.php?r=BMMTH", // "Register"

  // Prizes RM1 to RM15. Higher weight = comes out more often.
  // These weights add up to 100, so weight 16 is about a 16% chance.
  prizes: [
    { amount: 1, weight: 16 },
    { amount: 2, weight: 16 },
    { amount: 3, weight: 14 },
    { amount: 4, weight: 12 },
    { amount: 5, weight: 10 },
    { amount: 6, weight: 7 },
    { amount: 7, weight: 6 },
    { amount: 8, weight: 5 },
    { amount: 9, weight: 4 },
    { amount: 10, weight: 3 },
    { amount: 11, weight: 2 },
    { amount: 12, weight: 2 },
    { amount: 13, weight: 1 },
    { amount: 14, weight: 1 },
    { amount: 15, weight: 1 },
  ],

  // Change this name to let everyone play again (for example next year).
  storageKey: "xmas-smash-egg-2026",
};
