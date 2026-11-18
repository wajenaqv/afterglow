// Placeholder window until the wallpaper host lands (phase 1).
// The word glows letter by letter and fades, an afterglow in miniature.

const WORD = "afterglow";
const mark = document.getElementById("mark");
const letters = [...WORD].map((ch) => {
  const s = document.createElement("span");
  s.textContent = ch;
  mark.append(s);
  return s;
});

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

function light(i) {
  const s = letters[i];
  s.style.color = "#fff";
  s.style.textShadow = "0 0 12px var(--glow), 0 0 28px var(--glow)";
  setTimeout(() => {
    s.style.color = "";
    s.style.textShadow = "0 0 4px var(--glow)";
  }, 500);
}

if (!still) {
  let i = 0;
  setInterval(() => {
    light(i);
    i = (i + 1) % letters.length;
  }, 260);
}
