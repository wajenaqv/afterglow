// Placeholder window until the wallpaper host lands (phase 1).
// The wordmark glows letter by letter, green to white and back (heywajih's
// logo colours): an afterglow in miniature. Colours live in style.css.

const WORD = "AfterGlow";
const mark = document.getElementById("mark");
const letters = [...WORD].map((ch) => {
  const s = document.createElement("span");
  s.textContent = ch;
  mark.append(s);
  return s;
});

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (!still) {
  let i = 0;
  setInterval(() => {
    const s = letters[i];
    s.classList.add("lit");
    setTimeout(() => s.classList.remove("lit"), 450);
    i = (i + 1) % letters.length;
  }, 260);
}
