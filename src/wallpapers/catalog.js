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

// The picker's tabs: each wallpaper's `tag` is one of these (keep `about` to
// one short line: long ones made the cards too tall)
export const TAGS = ["creatures", "nature", "sky", "tech", "clock"];

// The techy wallpapers (radar, life, circuit): the phosphor, and the CRT overlay
const PHOSPHOR = { key: "tint", label: "phosphor", choices: [["", "green"], ["amber", "amber"], ["ice", "ice blue"], ["white", "white"]] };
const CRT = { key: "crt", label: "scanlines", choices: [["", "on"], ["0", "off"]] };

// The jellyfish's drifting specks ("marine snow"), or plain black water
const SPECKS = { key: "specks", label: "background", choices: [["", "specks"], ["0", "black"]] };

export const WALLPAPERS = [
  {
    id: "jellyfish",
    name: "jellyfish",
    about: "Glowing jellyfish drifting up through dark water.",
    tag: "creatures",
    options: [PALETTE, { key: "count", label: "count", choices: [["", "auto"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])] }, SPECKS],
    reacts: ["pulse", "lanterns", "count", "flash"],
  },
  {
    id: "big-jellyfish",
    name: "big jellyfish",
    about: "One big jellyfish, pulsing where it floats.",
    tag: "creatures",
    options: [PALETTE, { key: "hue", label: "colour", choices: [["", "random"], ...Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])], hues: true }, SPECKS],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "paws",
    name: "paw prints",
    about: "Glowing paw prints of an invisible cat.",
    tag: "creatures",
    options: [PALETTE],
    reacts: ["pulse", "flash"],
  },
  {
    id: "cloudsea",
    name: "cloud sea",
    about: "A sea of cloud after sunset, its swells lit from behind.",
    tag: "nature",
    options: [PALETTE],
    reacts: ["pulse", "flash"],
  },
  {
    id: "sakura",
    name: "sakura",
    about: "A cherry branch at night, petals on the wind.",
    tag: "nature",
    options: [
      { key: "tint", label: "palette", choices: [["", "natural"], ["cool", "cool"], ["warm", "warm"], ["grey", "grey"], ["green", "AfterGlow green"]] },
      { key: "moon", label: "moon", choices: [["", "on"], ["0", "off"]] },
    ],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "constellation",
    name: "constellation",
    about: "Cats drawn in the stars, one after another.",
    tag: "sky",
    options: [
      { key: "tint", label: "palette", choices: [["", "natural"], ["cool", "cool"], ["warm", "warm"], ["grey", "grey"], ["green", "AfterGlow green"]] },
      { key: "pose", label: "cat", choices: [["", "all of them"], ["sitting", "sitting"], ["sleeping", "sleeping"], ["walking", "walking"], ["face", "face"], ["pouncing", "pouncing"], ["loaf", "loaf"], ["stretching", "stretching"]] },
    ],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "startrails",
    name: "star trails",
    about: "A long exposure of the stars over mountains.",
    tag: "sky",
    options: [{ key: "tint", label: "palette", choices: [["", "natural"], ["colour", "star colours"], ["cool", "cool"], ["warm", "warm"], ["green", "AfterGlow green"]] }],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "radar",
    name: "radar",
    about: "A phosphor radar sweep; waiting apps are contacts.",
    tag: "tech",
    options: [PHOSPHOR, CRT],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "life",
    name: "phosphor life",
    about: "Conway's Game of Life on a glowing phosphor screen.",
    tag: "tech",
    options: [PHOSPHOR, CRT],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "circuit",
    name: "circuit board",
    about: "A circuit board with pulses of light on its traces.",
    tag: "tech",
    options: [PHOSPHOR, CRT],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "impossible",
    name: "impossible",
    about: "Impossible shapes that only close from one viewpoint.",
    tag: "tech",
    options: [{ key: "object", label: "shape", choices: [["", "Penrose triangle"], ["stairs", "Penrose stairs"], ["reutersvard", "triangle of cubes"], ["square", "impossible frame"], ["pentagon", "impossible pentagon"]] }, PHOSPHOR, CRT],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "clock",
    name: "clock",
    about: "The time, big and glowing, in many styles.",
    tag: "clock",
    options: [
      {
        key: "style",
        label: "style",
        choices: [["", "slant"], ["phosphor", "phosphor (CRT)"], ["heywajih", "heywajih"], ["light", "light"], ["radar", "radar"], ["scope", "oscilloscope"], ["big", "big"], ["lcd", "lcd"]],
      },
      { key: "tint", label: "palette", choices: [["", "natural"], ["cool", "cool"], ["grey", "grey"], ["warm", "warm"], ["green", "AfterGlow green"]] },
      { key: "fill", label: "fill", choices: [["", "gradient"], ["solid", "solid"]] },
      { key: "hours", label: "hours", choices: [["", "like my system"], ["12", "12-hour"], ["24", "24-hour"]] },
    ],
    reacts: ["pulse", "lanterns", "flash"],
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
