# Wallpaper plan

Quality over quantity (owner, 2026-11-22). The jellyfish and the shore set the bar: big, soft shapes of light with structure in them, slow motion, one subject on black, reacting to your apps. Anything that doesn't reach that bar is cut.

## How a wallpaper gets built

1. **Smooth mock first.** The look as a plain smooth image (`?smooth`), from the same maths that will draw the characters. If it isn't beautiful smooth, it never becomes characters.
2. **Characters.** The same light turned into characters (`nightscene.js startScene`, CPU), tuned live.
3. **GPU renderer.** Same maths in GLSL (`sampleCell`), checked against the CPU one on the same frame. Every wallpaper has both (see CLAUDE.md).
4. **Reactions.** A new message (pulse) leaves a glow in the app's colour that lingers and fades; waiting apps (lanterns) keep a patch of colour until you hover it; a flash. Hover where it makes sense.
5. **Settings card, palettes, stills**, then install and judge on the real desktop.

What fails: anything small and many-part (flocks, fish, insects: each member is one or two cells and reads as dust), fine detail (hairline rings), busy scenes. What works: large fields of light, strong lighting, structure you can see from far away.

## Status

| wallpaper | state |
| --- | --- |
| jellyfish, big jellyfish | done, the reference |
| shore | parked (2026-11-24): the top-down version and a side view (`parked/shore`) both read as stripes and noise; removed from the app. A restart would begin with a reference and a smooth mock |
| cloud sea | shipped (2026-11-22): rolling swells lit from behind, dim ASCII symbols, violet night view held still, palettes, pulse and flash, CPU and GPU. Still to do: waiting-app reaction (lights) and the waiting count |
| aurora | sketched, branch `wip/aurora`: smooth mock and characters done, the owner liked it; GPU, reactions and Settings card to do |
| ocean | half done, branch `wip/ocean`: needs shorter swells so the foreground is rows of waves |
| sakura branch | built (2026-11-24, branch `wip/sakura`), after a Python video sketch the owner shared (taken as reference only): branch from the top right across the moon, outlined five-petal blossoms, petals falling in gusts, CPU and GPU, palettes, pulse / lanterns / flash. Owner's verdict on the real desktop pending |
| star trails | built (2026-11-24) after the owner's Python sketch: a long exposure round the pole star over mountains; canvas 2D (real arcs) |
| constellation | ported from heywajih (2026-11-24): cat constellations, a shooting star per message, a star per waiting app; CPU and GPU through cells.js |
| clownfish and anemone | idea, below (2026-11-24) |
| wind grass | idea, below (2026-11-24) |
| samurai | idea, below: only as a silhouette, inside the wind grass scene |
| eclipse | idea, below |

Cut or parked: shore (`parked/shore`, see above), tesseract (`wip/tesseract`: lovely smooth, but 4D edges are line art and never held up as characters), rings (`parked/rings`: hairline detail turned to noise), goldfish and schools of fish (`wip/goldfish`: blobs), comb jellies (too close to the jellies), a lantern scene (owner doesn't like it; the waiting-app *reaction* is still called lanterns in the code).

## Cloud sea, "the afterglow"

The sun has already set; what remains is the glow it leaves, seen from above a sea of cloud. A luminous line along the horizon fades up through rose and violet to blue-black; the nearest cloud tops catch its last warmth, the valleys sit in cool shadow. The glow cools from orange through rose to violet over a 25 minute cycle and returns (`?dusk=0..1` freezes it for judging).

To do: richer relief in the characters (the glow washes shadows out), a glow stronger on one side with high cloud catching light, the GPU renderer. Reactions: a new message leaves a glow in the app's colour inside the clouds that lingers and fades like a phosphor (the afterglow in the literal sense); waiting apps keep a patch of colour until hovered. Palettes: dusk orange, and AfterGlow green (a green-tinted afterglow, like a CRT).

## Tesseract (cut, kept for the record)

A four-dimensional hypercube turning slowly in 4D and projected down: 16 vertices, 32 edges, 24 square faces. As it turns, the inner cube swells and swaps places with the outer one, inside-out, which is the whole beauty.

- **Look:** thick, soft glowing edges (not hairlines: each edge is a glowing tube a few cells wide, drawn per cell from its distance to the segment), faint translucent faces that add up where they overlap, brighter vertices. One bold subject, centred, on black. A slow double rotation (XW and ZW planes) so it never repeats quickly.
- **Reactions:** a new message sends a pulse in the app's colour racing along the edges from vertex to vertex and lingering as it fades; each waiting app lights one vertex in its colour until hovered; a flash lights all the edges.
- **Hover:** the cursor turns the hypercube (a drag in 4D).
- **Palettes:** AfterGlow green (the brand), cool, warm, grey.
- **Risk:** low to medium. 32 segment distances per cell is cheap on the GPU. The risk is hairline thinness, hence the thick glowing edges; the smooth mock will show that first.

## Eclipse

A total solar eclipse: a black disc, its corona streaming out in long radial streamers, over a sky in twilight on all sides. A slow cycle: the moon's edge slides across the sun (partial, the light dimming and cooling), totality (the corona blooms, stars and planets appear, a 360 degree glow on the horizon), then the diamond ring as the first light returns, and back.

- **Look:** very high contrast, which suits characters: a black disc, a bright corona made of polar noise streamers (long and soft at the poles, short at the equator), a thin bright ring at the edge, small beads of light at the moment of contact.
- **Brand fit:** the corona is the afterglow, light lingering around something dark.
- **Reactions:** a new message throws a prominence (a loop of light off the edge) in the app's colour that lingers and fades; each waiting app is a planet or star beside the sun, in its colour, until hovered; a flash is the diamond ring.
- **Palettes:** natural (silver corona, rose prominences), warm, cool.
- **Risk:** low. A disc, a radial noise field and a sky gradient; no fine detail. The smooth mock first, as always.

## Ideas from the owner, 2026-11-24

Judged against what we learned: big soft shapes with strong lighting work; many small parts, hairlines and hand-drawn line art don't. The waiting-app reaction (called "lanterns" in `common.js`: `{ type: "lanterns", items: [{ source, colour }] }`, the whole list on every change, `seenLantern(source)` when the cursor rests on one) already gives "one thing per waiting app, in its colour, until you look at it", so the notification ideas below map onto it directly. Ranked by how likely they are to work.

### 1. Sakura branch (likelihood: good, the best fit)

A dark branch reaching in from a corner, rim-lit by moonlight or the afterglow, with buds along it. A new message opens a blossom in the app's colour (a bloom: the petals swell out with a flash, then settle into a soft glow); every waiting app keeps its blossom open until you rest the cursor on it, then it drops a few petals and closes. A flash lights the whole branch.

- **Why it works:** two bold shapes. A thick, tapering branch with two or three forks (a rim-lit silhouette, like the swells in the cloud sea) and flowers eight to ten cells across, each five soft petals from a radial shape. Slow wind sway of the whole branch, like the jellyfish tentacles.
- **Why it might not:** a branch drawn as thin lines would look like cracks (line art failed before), so it must be thick and filled. Falling petals are small and many: keep them to a handful of big slow ones (three to four cells), or leave them out. Blossoms in app colours won't all be pink (WhatsApp green, Gmail red); that is the point, but a default pink for no-app idle buds keeps the sakura feel.
- **Palettes:** natural (pink on deep blue night), cool, warm, grey.
- **Risk:** low to medium. The smooth mock tells us at once whether the branch reads.

### 2. Clownfish and anemone (likelihood: medium, and only if the fish are big and few)

A large glowing anemone, a soft mass of swaying tentacles (the jellyfish tentacle maths, reused), as the clownfish's house. A new message sends a clownfish out of it: a bold silhouette in the app's colour with its three pale bands, swimming a slow loop and then back in or fading. Waiting apps keep one fish each near the anemone, in their colour, until you hover them (then the fish dives into the anemone); the more waiting apps, the more fish.

- **Why it might work:** it is the waiting-app reaction almost exactly, and the anemone is the same kind of soft glowing tentacle shape the jellyfish proved. Fish that are 25 to 35 cells long, at most six at a time, drawn as soft translucent shapes with a rim light, read as fish.
- **Why it might not:** our earlier fish (`wip/goldfish`, schools) failed because every fish was a cell or two and read as dust. Here they must stay big and few, never a school. Colour-coded silhouettes lose the clownfish's orange-and-white look; the bands as a lighter tint of the app's colour keep the reading.
- **Risk:** medium. The fish silhouette and its swimming curve need a good smooth mock first.

### 3. Wind grass, "Tsushima" (likelihood: good if we draw the wind, not the blades)

A field of tall grass at dusk with gusts of wind rolling across it in long bands, the grass leaning and springing back, light running over the field in waves like a wheat field or pampas grass in a storm.

- **Why it works:** the beauty is the large moving structure, the gust, which is exactly the kind of field of light we are good at. Leaning grass maps well onto characters that lean (`/ | \`) in density bands, and light and shade running across it reads from far away.
- **Why it might not:** individual blades are fine detail and turn to noise, so the field is a lit surface with directional streaks, never drawn blade by blade.
- **Reactions:** a new message sends a gust in the app's colour sweeping across and fading behind it; waiting apps could be fireflies or seed heads in their colour (keep them big and few).
- **Palettes:** dusk gold and silver pampas, cool moonlit, warm, grey.
- **Risk:** medium. The smooth mock (a gust passing over a lit field) decides it.

### 4. Samurai (likelihood: poor alone, possible inside the grass scene)

A lone figure drawn as a rim-lit silhouette: a wide hat, a long coat moving in the wind, a sword, standing on a ridge against the afterglow. Hand-drawn figures are where we have failed (the skyline, the cat scenes), so this only works as one big, simple, filled silhouette, a third of the screen tall, with the wind moving the cloth and the grass around it. A new message could glint the blade in the app's colour.

- **Plan:** build wind grass first. Add the figure only if the grass scene earns it, and judge the silhouette in the smooth mock before characters. If it doesn't read as a person at a glance, drop it and keep the grass.
- **Risk:** high.

### 5. Wind as a shared building block (likelihood: good, a tool more than a wallpaper)

"Wind stuff" on its own splits into what works and what does not. Works: wind shown through large things (grass, cloth and banners, water ripples, smoke or a ribbon). Doesn't: wind shown through small things (leaves, dust, particles), which turn to specks at our cell size.

- **Idea:** one shared gust function (a travelling band of wind over x and time) used by the sakura branch (sway), the wind grass (lean), the cloud sea and the shore (ripples), so the wallpapers move with one consistent wind and a notification can send a gust through any of them.

## More candidates (ranked when we get here)

A deep-sea jelly after the owner's glowy reference ([deep-sea-glow.md](deep-sea-glow.md)), storm clouds from above (lightning inside the cloud: a new message is a flash in the app's colour), rain on a still pond (a new message is a drop in the app's colour, the cursor is a finger in the water), ink in water (glowing plumes, needs a small fluid simulation), a manta ray gliding (one big translucent shape), a slowly turning spiral galaxy.
