// The wallpapers AfterGlow offers and their options, for the Settings picker.
// `reacts`: the reactions it shows (signals.rs): pulse, count, flash.
// Keep the ids in sync with WALLPAPERS in src-tauri/src/settings.rs (the tray
// menu and validation) and with the pages in wallpapers/<id>.html.
//
// Each option is a URL parameter of the wallpaper page; a choice is
// [value, label], and the empty value means the wallpaper's own default (left
// out of the URL).

const PALETTE = {
  key: "tint",
  label: "palette",
  choices: [["", "natural"], ["cool", "cool"], ["grey", "grey"], ["warm", "warm"]],
};

// The jellyfish's drifting specks ("marine snow"), or plain black water
const SPECKS = { key: "specks", label: "background", choices: [["", "specks"], ["0", "black"]] };

export const WALLPAPERS = [
  {
    id: "jellyfish",
    name: "jellyfish",
    about: "Glowing, see-through jellyfish pulsing up through dark water, trailing their tentacles. Touch one with the cursor and its characters scramble a little.",
    options: [PALETTE, { key: "count", label: "count", choices: [["", "auto"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])] }, SPECKS],
    reacts: ["pulse", "lanterns", "count", "flash"],
  },
  {
    id: "big-jellyfish",
    name: "big jellyfish",
    about: "One big jellyfish that stays where it is and just pulses, each pulse rippling down its tentacles. Touch it and its characters scramble a little.",
    options: [PALETTE, { key: "hue", label: "colour", choices: [["", "random"], ...Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])], hues: true }, SPECKS],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "paws",
    name: "paw prints",
    about: "Glowing paw prints of an invisible cat walking across the screen. Rest the cursor and the curious cat comes over, circles it and sits a moment.",
    options: [PALETTE],
    reacts: ["pulse", "flash"],
  },
];

// The big jellyfish's colour menu names the colours of the chosen palette
// (jellyfish.js TINTS order; grey has only five)
export const HUE_NAMES = {
  "": ["pink", "violet", "cyan", "peach", "gold", "mint"],
  cool: ["cyan", "blue", "aqua", "indigo", "teal", "ice"],
  grey: ["pearl", "silver", "mist", "slate", "ivory"],
  warm: ["coral", "rose", "peach", "gold", "amber", "berry"],
};

// Options object -> "k=v&k2=v2" (defaults left out)
export function queryFor(options = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(options)) if (v) q.set(k, v);
  return q.toString();
}
