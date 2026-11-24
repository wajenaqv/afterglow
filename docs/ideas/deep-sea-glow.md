# Deep-sea glow (idea, 2026-11-24)

The owner liked a Python sketch of a bioluminescent jellyfish (`reference/jellyfish2.py`, kept as reference only: it renders a 1080x1920 video with numpy and Pillow, nothing of it runs in AfterGlow). It looks far more "cool and glowy" than our jellyfish. Not started; two ideas came out of it.

## Why it glows (most important first)

1. **Bloom over the text** (`frame`, "render"). After the characters are drawn, three blurred copies of the image are added on top: tight (2.5 px), a halo (12 px), and a wide one (30 px) made only from the brightest pixels (`hot`). The rim, the sense organs and the pulse rings look like they give off light, while dim parts stay crisp.
2. **Haze in the water** (`haze`). The emitted light spread very wide (gaussian 95-190 px) becomes a smooth blue cloud behind the characters, plus a vignette and a dark-blue gradient. The jelly sits inside its own light. Ours are characters on pure black.
3. **Lit tissue** (`deposit`, `kind="tissue"`). Clear jelly only shows where the glowing parts light it (`Lf`, the light spread around the emitters), so bell, tentacles and marine snow appear as light passes over them and fall back into the dark.
4. **Strands drawn along their direction** (`compose`). Per cell it sums the strands' direction (a structure tensor, `C2`/`S2` from twice the angle) and, where they agree (`coh`), draws `- / | \`, `( )` by which side of the cell, `' _` by height in the cell. The veil of 160 tentacles reads as threads. Ours uses one stroke character for tentacles.
5. **Light that travels.** Each beat sends a ring of light from crown to rim (`level`) and a wave down the tentacles (`launch`); a green GFP rim, eight sense organs as point stars, sixteen radial canals, a folded glowing stomach, frilled oral arms with their own ramp (`FR_RAMP`).

Ours (jellyfish.js / jellyfish-gl.js): light per cell with a 3x2 box blur in cell space, so the halo is more characters, never smooth light.

## Tension with the design rules

CLAUDE.md says "not too much light: tight halos, no bleed" (from heywajih). Bloom and haze are the opposite, so they would be an option, not a new default.

## Idea 1: a glow option for every wallpaper

Bloom (and a little haze) as a last GPU pass over the finished picture: a bright-pass and a two-pass blur at quarter resolution, added back. Cheap on the GPU, one switch per wallpaper (or global in Settings → performance). The CPU fallback would need a cheaper blur (`ctx.filter = "blur()"` on a downscaled copy), so it may look a little softer. Every GPU wallpaper gets it at once: jellyfish, sakura, constellation, shore, cloud sea. Recommended first: small, and it lets the owner judge bloom on wallpapers they already know.

## Idea 2: a "deep sea jelly" wallpaper

One great jelly after this reference: a veil of strands drawn along their direction, oral arms, the pulse ring and the travelling tentacle light, marine snow lit only by the jelly. Reaction: a new message is a wave of light in the app's colour running down the tentacles; waiting apps could be sense organs on the rim in their colours. Big: 3D-ish geometry and several lighting passes, with a GPU and a CPU renderer. Would use idea 1's bloom.
