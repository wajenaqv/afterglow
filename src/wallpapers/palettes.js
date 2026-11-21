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
