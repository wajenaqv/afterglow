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

// The side panel (Settings → wallpaper, a click on a card): what each one is in
// a few sentences, and how it reacts. "Waiting apps" is what the code calls
// lanterns: say it the user's way.
export const DETAILS = {
  jellyfish: {
    about: "See-through jellyfish pulse slowly up through dark water, trailing their tentacles.",
    message: "The nearest jelly pulses in the app's colour, then fades.",
    waiting: "Each app keeps one jelly glowing in its colour, breathing slowly. Rest your cursor on it for a moment to mark it seen.",
    many: "More jellies drift in as unread messages pile up.",
    flash: "Every jelly flares at once.",
    hover: "The jelly under your cursor dissolves into shading blocks.",
  },
  "big-jellyfish": {
    about: "One large jellyfish that stays in place and pulses, each beat rippling down its tentacles.",
    message: "It pulses in the app's colour.",
    waiting: "Its glow steps through the colours of the waiting apps. Rest your cursor on it for a moment to mark them seen.",
    flash: "It flares.",
    hover: "Its characters dissolve into shading blocks under your cursor.",
  },
  paws: {
    about: "An invisible cat walks across the screen, leaving glowing paw prints that slowly fade.",
    message: "Another cat walks by, its prints in the app's colour.",
    waiting: "Not yet.",
    flash: "The prints brighten.",
    hover: "Rest your cursor and the cat comes over, circles it and sits a moment.",
  },
  cloudsea: {
    about: "Seen from above after sunset: rolling swells of cloud, their crests lit from behind by the last glow on the horizon.",
    message: "A wave of the app's colour rolls in from the horizon and fades.",
    waiting: "Not yet.",
    flash: "The sky brightens.",
    hover: "None.",
  },
  sakura: {
    about: "A cherry branch at night, crossing the moon. The wind comes in gusts: the twigs sway, and petals tear loose and flutter down.",
    message: "A blossom opens in the app's colour, sheds a few petals, and fades back to pink.",
    waiting: "Each app keeps one big blossom lit in its colour. Rest your cursor on it for a moment to mark it seen: it drops its petals.",
    flash: "The whole branch lights up.",
    hover: "None: the cursor only marks waiting apps as seen.",
  },
  constellation: {
    about: "Bright stars kindle one by one and lines draw between them until they make a cat, its Latin name underneath. It holds, fades, and the next one forms elsewhere.",
    message: "A shooting star in the app's colour, its trail lingering.",
    waiting: "Each app is a bright star in its colour in the upper sky. Rest your cursor on it for a moment to mark it seen: it shoots off.",
    flash: "Every star flares.",
    hover: "Sweep your cursor quickly across the sky for a shooting star.",
  },
  startrails: {
    about: "A long exposure of the night sky: the stars turn slowly round the pole star, each leaving a thin arc of light, above dark mountains.",
    message: "One star's trail lights up in the app's colour, then fades.",
    waiting: "Each app keeps a trail glowing in its colour. Rest your cursor on its star for a moment to mark it seen.",
    flash: "Every trail brightens.",
    hover: "None.",
  },
  radar: {
    about: "A phosphor radar screen: the beam sweeps round, and everything it passes flares and slowly fades. Range rings, bearings, a stretch of coast.",
    message: "A new contact comes in from the rim in the app's colour.",
    waiting: "Each app is a contact labelled with its name, refreshed on every sweep. Rest your cursor on it for a moment to mark it seen.",
    flash: "The whole screen flares.",
    hover: "None.",
  },
  life: {
    about: "Conway's Game of Life on a phosphor screen: cells live and die, and the dead fade slowly, leaving glowing trails.",
    message: "A pair of gliders in the app's colour sails in; the cells they touch take on the colour.",
    waiting: "Each app keeps a pulsar beating in its colour. Rest your cursor on it for a moment to mark it seen: it's set free.",
    flash: "Every cell lights up.",
    hover: "None.",
  },
  circuit: {
    about: "A dark circuit board: chips and buses of traces, with packets of light running along them and the copper glowing behind.",
    message: "A packet in the app's colour runs in from the edge and lights up a chip.",
    waiting: "Each app takes a chip showing its name, with a blinking LED. Rest your cursor on it for a moment to mark it seen.",
    flash: "Current surges through every trace.",
    hover: "None.",
  },
  impossible: {
    about: "An impossible shape that is really there: it only closes from one viewpoint, and now and then the view swings to show it never was closed.",
    message: "A band of light in the app's colour runs round the endless loop.",
    waiting: "Each app is a light going round the loop for ever. Rest your cursor on it for a moment to mark it seen.",
    flash: "The edges flare.",
    hover: "None.",
  },
  clock: {
    about: "The time, big and glowing in the middle of the screen, in any of the clock styles, with the date underneath.",
    message: "The digits glow in the app's colour, then fade.",
    waiting: "Each app is a dot in its colour under the date. Rest your cursor on it for a moment to mark it seen.",
    flash: "The digits flare.",
    hover: "None.",
  },
};

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
        choices: [["", "slant"], ["phosphor", "phosphor (CRT)"], ["heywajih", "heywajih"], ["light", "light"], ["radar", "radar"], ["scope", "oscilloscope"], ["big", "big"], ["lcd", "lcd"], ["text", "plain text"], ...["doom", "lean", "isometric", "flip-dot", "split-flap", "constellation", "circuit", "extruded", "hatch", "rain", "binary", "dial", "bars", "words"].map((s) => [s, s])],
      },
      { key: "tint", label: "palette", choices: [["", "natural"], ["cool", "cool"], ["grey", "grey"], ["warm", "warm"], ["green", "AfterGlow green"], ["custom", "pick a colour"]] },
      // a colour of your own, used while the palette is "pick a colour"
      { key: "colour", label: "colour", type: "color", when: ["tint", "custom"], value: "#ff5fa2" },
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
