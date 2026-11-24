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
    about: "Glowing, see-through jellyfish pulsing up through dark water, trailing their tentacles. Touch one with the cursor and its characters dissolve into shading blocks.",
    options: [PALETTE, { key: "count", label: "count", choices: [["", "auto"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)])] }, SPECKS],
    reacts: ["pulse", "lanterns", "count", "flash"],
  },
  {
    id: "big-jellyfish",
    name: "big jellyfish",
    about: "One big jellyfish that stays where it is and just pulses, each pulse rippling down its tentacles. Touch it and its characters dissolve into shading blocks.",
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
  {
    id: "cloudsea",
    name: "cloud sea",
    about: "A sea of cloud seen from above after sunset: a band of glow along the horizon and rolling swells below, their crests lit from behind. A notification sends a wave of the app's colour rolling in from the horizon, then it fades away slowly.",
    options: [PALETTE],
    reacts: ["pulse", "flash"],
  },
  {
    id: "sakura",
    name: "sakura",
    about: "A cherry branch at night crossing the moon, swaying in the wind, its petals torn loose and fluttering down. A notification opens a blossom in the app's colour; an app with something waiting keeps one lit until you rest the cursor on it, then it drops its petals.",
    options: [
      { key: "tint", label: "palette", choices: [["", "natural"], ["cool", "cool"], ["warm", "warm"], ["grey", "grey"], ["green", "AfterGlow green"]] },
      { key: "moon", label: "moon", choices: [["", "on"], ["0", "off"]] },
    ],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "constellation",
    name: "constellation",
    about: "Cats in the stars: chart lines join a few bright stars into a cat (sitting, asleep, pouncing, a loaf...), its Latin name fades in, then it dissolves and the next forms elsewhere. Sweep the cursor fast for a shooting star. A notification is a shooting star in the app's colour whose trail lingers; an app with something waiting is a bright star in its colour.",
    options: [
      { key: "tint", label: "palette", choices: [["", "natural"], ["cool", "cool"], ["warm", "warm"], ["grey", "grey"], ["green", "AfterGlow green"]] },
      { key: "pose", label: "cat", choices: [["", "all of them"], ["sitting", "sitting"], ["sleeping", "sleeping"], ["walking", "walking"], ["face", "face"], ["pouncing", "pouncing"], ["loaf", "loaf"], ["stretching", "stretching"]] },
    ],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "startrails",
    name: "star trails",
    about: "A long exposure of the night sky: stars turn slowly around the pole star, leaving thin arcs of light above dark mountains. A notification lights one star's trail in the app's colour; an app with something waiting keeps a trail in its colour until you rest the cursor on its star.",
    options: [{ key: "tint", label: "palette", choices: [["", "natural"], ["colour", "star colours"], ["cool", "cool"], ["warm", "warm"], ["green", "AfterGlow green"]] }],
    reacts: ["pulse", "lanterns", "flash"],
  },
  {
    id: "clock",
    name: "clock",
    about: "The time, big and glowing in the middle of the screen, in any of the clock styles: phosphor (drawn by the beam of a glowing CRT; old digits fade slowly when the minute turns), heywajih (the clock from heywajih.com), light, a radar, an oscilloscope, or ASCII fonts (slant, big, lcd).",
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
