# Cosy Tile Pattern Maker (v1)

**Live:** [https://smile-tile.vercel.app](https://smile-tile.vercel.app)
Sister apps (header, open in a new tab): [Cosy Vector Sketchpad](https://cosy-vector-sketchpad.vercel.app) and [Cosy Pattern Checker](https://cosy-pattern-checker.vercel.app).

Static web app – open `index.html` (or host the folder on GitHub Pages). No build step, no server code.

- `index.html`, `style.css`, `app.js` – the app
- `samples.js` / `samples/` – built-in kawaii snowman, snowflake, star motifs
- `vendor/` – jsPDF 2.5.2 + svg2pdf.js 2.9.0 (MIT, vendored) for vector PDF export
- Fredoka font loads from Google Fonts; falls back to Arial Rounded / system rounded fonts offline.

Repeat modes: Square (straight), Diamond half-brick (rows offset ½ tile), Diamond half-drop (columns offset ½ tile).
Offset modes export either a "straight repeat" double tile (T×2T or 2T×T, repeats on a plain grid anywhere)
or the single T×T unit (for print sites with a half-drop / half-brick setting).
Projects autosave in the browser and can be saved/opened as .json.
