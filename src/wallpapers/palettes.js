// The jellies' palettes (?tint=): each hue a bell, glow and tentacle colour,
// plus the water's deep and snow colours. Shared by jellyfish.js and the
// light clock (lightclock.js), so a clock and a jelly look like one world.
export const TINTS = {
  natural: {
    hues: [
      { bell: [255, 120, 205], glow: [255, 70, 170], tent: [255, 160, 220] }, // pink
      { bell: [170, 130, 255], glow: [140, 90, 255], tent: [200, 170, 255] }, // violet
      { bell: [90, 225, 255], glow: [40, 190, 255], tent: [150, 240, 255] }, // cyan
      { bell: [255, 170, 120], glow: [255, 120, 70], tent: [255, 200, 160] }, // peach
      { bell: [255, 215, 100], glow: [255, 180, 40], tent: [255, 230, 150] }, // gold
      { bell: [120, 255, 200], glow: [60, 240, 170], tent: [170, 255, 220] }, // mint
    ],
    deep: [50, 105, 175], snow: [150, 180, 210],
  },
  cool: {
    hues: [
      { bell: [90, 225, 255], glow: [40, 190, 255], tent: [150, 240, 255] }, // cyan
      { bell: [110, 160, 255], glow: [60, 110, 255], tent: [160, 195, 255] }, // blue
      { bell: [120, 255, 220], glow: [50, 230, 190], tent: [170, 255, 230] }, // aqua
      { bell: [150, 140, 255], glow: [110, 90, 255], tent: [190, 180, 255] }, // blue-violet
      { bell: [80, 210, 200], glow: [30, 180, 175], tent: [140, 230, 220] }, // teal
      { bell: [170, 220, 255], glow: [120, 190, 255], tent: [205, 235, 255] }, // ice
    ],
    deep: [35, 85, 170], snow: [140, 185, 225],
  },
  grey: {
    hues: [
      { bell: [235, 240, 248], glow: [255, 255, 255], tent: [210, 215, 225] }, // pearl
      { bell: [185, 192, 205], glow: [230, 235, 245], tent: [165, 172, 185] }, // silver
      { bell: [215, 215, 215], glow: [245, 245, 245], tent: [180, 180, 180] }, // light grey
      { bell: [160, 165, 175], glow: [210, 215, 225], tent: [140, 145, 155] }, // slate
      { bell: [245, 242, 235], glow: [255, 255, 250], tent: [215, 212, 205] }, // warm white
    ],
    deep: [70, 74, 82], snow: [170, 175, 185],
  },
  warm: {
    hues: [
      { bell: [255, 130, 120], glow: [255, 80, 70], tent: [255, 170, 160] }, // coral
      { bell: [255, 120, 180], glow: [255, 70, 140], tent: [255, 165, 205] }, // rose
      { bell: [255, 170, 120], glow: [255, 120, 70], tent: [255, 200, 160] }, // peach
      { bell: [255, 215, 100], glow: [255, 180, 40], tent: [255, 230, 150] }, // gold
      { bell: [255, 150, 70], glow: [255, 110, 30], tent: [255, 190, 130] }, // amber
      { bell: [255, 105, 150], glow: [240, 60, 110], tent: [255, 150, 185] }, // raspberry
    ],
    deep: [120, 55, 70], snow: [220, 175, 160],
  },
};

// ---- the other wallpapers' palettes, here so the clock can wear them
// (clockcolours.js) ----

const C = (r, g, b) => [r / 255, g / 255, b / 255];

// Paw prints: one colour per walk, and what prints cool to as they fade
export const PAWS = {
  natural: {
    old: C(175, 135, 205),
    tints: [
      C(255, 176, 150), // peach
      C(255, 150, 190), // rose
      C(255, 204, 128), // amber
      C(210, 175, 255), // lilac
      C(150, 235, 210), // mint
      C(140, 205, 255), // sky
      C(255, 130, 130), // coral
      C(170, 160, 255), // periwinkle
      C(255, 230, 150), // honey
      C(240, 150, 255), // orchid
      C(120, 235, 240), // aqua
    ],
  },
  cool: {
    old: C(110, 120, 200),
    tints: [C(140, 205, 255), C(120, 235, 240), C(150, 235, 210), C(170, 160, 255), C(110, 160, 255), C(190, 225, 255), C(100, 215, 200)], // sky, aqua, mint, periwinkle, blue, ice, teal
  },
  grey: {
    old: C(110, 112, 120),
    tints: [C(240, 242, 248), C(200, 205, 215), C(220, 220, 220), C(175, 180, 190), C(245, 240, 232)], // pearl, silver, light grey, slate, warm white
  },
  warm: {
    old: C(170, 90, 110),
    tints: [C(255, 176, 150), C(255, 150, 190), C(255, 204, 128), C(255, 130, 130), C(255, 230, 150), C(255, 160, 90), C(255, 110, 160)], // peach, rose, amber, coral, honey, tangerine, raspberry
  },
};

// Cloud sea: the glow's colour at night, in the middle and when bright, and
// the shade in the valleys
export const CLOUDS = {
  natural: { glow: [[0.22, 0.26, 0.7], [0.95, 0.33, 0.5], [1.0, 0.52, 0.14]], amb: [0.1, 0.09, 0.17] },
  cool: { glow: [[0.1, 0.3, 0.75], [0.2, 0.7, 0.9], [0.45, 0.92, 1.0]], amb: [0.05, 0.09, 0.17] },
  grey: { glow: [[0.5, 0.53, 0.6], [0.76, 0.78, 0.83], [0.96, 0.96, 0.98]], amb: [0.09, 0.095, 0.11] },
  warm: { glow: [[0.65, 0.2, 0.3], [1.0, 0.4, 0.34], [1.0, 0.62, 0.22]], amb: [0.15, 0.08, 0.09] },
};

// Sakura
export const SAKURA = {
  natural: { pale: [1.0, 0.86, 0.92], petal: [1.0, 0.62, 0.78], deep: [0.95, 0.36, 0.56], heart: [1.0, 0.4, 0.55], bark: [0.5, 0.34, 0.36], leaf: [0.42, 0.48, 0.22], moon: [0.85, 0.88, 0.95], anther: [1.0, 0.84, 0.5] },
  cool: { pale: [0.9, 0.95, 1.0], petal: [0.72, 0.82, 1.0], deep: [0.5, 0.58, 0.95], heart: [0.6, 0.55, 1.0], bark: [0.45, 0.48, 0.58], leaf: [0.3, 0.48, 0.45], moon: [0.85, 0.92, 1.0], anther: [0.95, 0.97, 1.0] },
  warm: { pale: [1.0, 0.9, 0.8], petal: [1.0, 0.68, 0.55], deep: [0.98, 0.45, 0.38], heart: [1.0, 0.5, 0.3], bark: [0.62, 0.42, 0.32], leaf: [0.5, 0.48, 0.2], moon: [1.0, 0.9, 0.75], anther: [1.0, 0.8, 0.4] },
  grey: { pale: [0.95, 0.95, 0.95], petal: [0.78, 0.78, 0.8], deep: [0.55, 0.55, 0.58], heart: [0.7, 0.7, 0.72], bark: [0.42, 0.42, 0.42], leaf: [0.4, 0.4, 0.4], moon: [0.92, 0.92, 0.92], anther: [1.0, 1.0, 1.0] },
  green: { pale: [0.8, 1.0, 0.9], petal: [0.3, 1.0, 0.6], deep: [0.15, 0.75, 0.45], heart: [0.5, 1.0, 0.75], bark: [0.3, 0.56, 0.43], leaf: [0.2, 0.6, 0.4], moon: [0.75, 1.0, 0.86], anther: [0.85, 1.0, 0.7] },
};

// Constellation
export const CONSTELLATION = {
  natural: { sky: C(1, 2, 6), dust: C(70, 60, 130), star: C(225, 232, 255), bright: C(255, 244, 220), line: C(120, 160, 235), label: C(215, 170, 85) }, // the names in a chart's gold
  cool: { sky: C(0, 3, 8), dust: C(40, 80, 140), star: C(200, 230, 255), bright: C(225, 245, 255), line: C(80, 185, 255), label: C(90, 140, 190) },
  warm: { sky: C(6, 2, 2), dust: C(130, 70, 60), star: C(255, 235, 210), bright: C(255, 225, 175), line: C(255, 160, 90), label: C(190, 135, 100) },
  grey: { sky: C(3, 3, 3), dust: C(90, 90, 95), star: C(225, 225, 230), bright: C(250, 250, 250), line: C(160, 165, 175), label: C(130, 132, 138) },
  green: { sky: C(0, 4, 2), dust: C(40, 110, 80), star: C(51, 255, 153), bright: C(255, 255, 255), line: C(125, 255, 192), label: C(77, 143, 110) },
};

// Star trails; "colour": each star its own temperature, cool to hot
export const STAR_COOL = [0.7, 0.82, 1.0];
export const STAR_HOT = [1.0, 0.78, 0.55];
export const STARTRAILS = {
  natural: { star: [0.88, 0.91, 1.0], rock: [0.55, 0.56, 0.6], haze: [0.5, 0.52, 0.58], bg: [0.012, 0.014, 0.02] },
  warm: { star: [1.0, 0.9, 0.78], rock: [0.46, 0.4, 0.36], haze: [0.6, 0.5, 0.42], bg: [0.02, 0.014, 0.012] },
  cool: { star: [0.75, 0.88, 1.0], rock: [0.34, 0.4, 0.5], haze: [0.4, 0.5, 0.65], bg: [0.008, 0.012, 0.024] },
  green: { star: [0.55, 1.0, 0.78], rock: [0.28, 0.45, 0.38], haze: [0.3, 0.6, 0.45], bg: [0.006, 0.016, 0.012] },
  colour: { star: null, rock: [0.42, 0.43, 0.46], haze: [0.5, 0.52, 0.58], bg: [0.012, 0.014, 0.02] },
};

// Currents: the hues its strands run through, a loop
export const CURRENTS = {
  natural: [C(90, 215, 255), C(120, 120, 255), C(200, 110, 255), C(255, 95, 165), C(255, 160, 100), C(235, 110, 190), C(120, 130, 255)],
  cool: [C(80, 225, 220), C(60, 160, 255), C(95, 100, 255), C(150, 190, 255)],
  warm: [C(255, 205, 100), C(255, 130, 70), C(255, 85, 110), C(230, 80, 170), C(255, 120, 90)],
  grey: [C(240, 242, 248), C(150, 156, 170), C(205, 208, 215), C(120, 125, 138)],
  green: [C(51, 255, 153), C(125, 255, 192), C(30, 190, 115), C(170, 255, 215)],
};

// Magnet: the two kinds of pole
export const MAGNET = {
  natural: { plus: C(255, 110, 190), minus: C(95, 145, 255) },
  cool: { plus: C(110, 235, 225), minus: C(90, 120, 255) },
  warm: { plus: C(255, 190, 95), minus: C(255, 85, 110) },
  grey: { plus: C(245, 245, 250), minus: C(140, 148, 165) },
  green: { plus: C(125, 255, 192), minus: C(51, 255, 153) },
};

// Attractor and silk: two hues each runs between (and silk's light from behind)
export const ATTRACTOR = {
  natural: { a: C(70, 115, 255), b: C(255, 75, 165) },
  cool: { a: C(60, 130, 255), b: C(95, 240, 225) },
  warm: { a: C(255, 80, 95), b: C(255, 190, 90) },
  grey: { a: C(130, 138, 155), b: C(240, 242, 248) },
  green: { a: C(40, 190, 115), b: C(125, 255, 192) },
};
export const SILK = {
  natural: { a: C(125, 85, 255), b: C(255, 85, 155), rim: C(40, 120, 220) },
  cool: { a: C(70, 110, 255), b: C(85, 220, 225), rim: C(90, 80, 230) },
  warm: { a: C(255, 90, 80), b: C(255, 180, 90), rim: C(200, 50, 110) },
  grey: { a: C(150, 156, 170), b: C(235, 237, 243), rim: C(110, 118, 135) },
  green: { a: C(51, 255, 153), b: C(125, 255, 192), rim: C(30, 140, 120) },
};

// The techy wallpapers' phosphors: green = the brand (P1/P31), amber (P3),
// ice (P7's blue-white flash colour), white (P4)
export const PHOSPHORS = {
  green: { ink: [0.2, 1.0, 0.6], dim: [0.08, 0.42, 0.26], flash: [0.85, 1.0, 0.95] },
  amber: { ink: [1.0, 0.68, 0.2], dim: [0.45, 0.28, 0.06], flash: [1.0, 0.95, 0.8] },
  ice: { ink: [0.55, 0.85, 1.0], dim: [0.18, 0.32, 0.48], flash: [0.95, 0.98, 1.0] },
  white: { ink: [0.88, 0.9, 0.95], dim: [0.32, 0.34, 0.38], flash: [1, 1, 1] },
};
