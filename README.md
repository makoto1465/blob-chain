# Blob Chain

Blob Chain is a small browser game inspired by falling color-chain puzzles. Drop pairs of blobs, connect four or more of the same color, and set up chain reactions for bigger scores.

## Play locally

Open `index.html` in a browser, or run a tiny local server from this folder:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Then visit `http://127.0.0.1:4173`.

## Controls

- Left / Right: move
- Up / Z / X: rotate
- Down: soft drop
- Space: hard drop
- P: pause
- Enter: start or retry

## Deploy

This project is static HTML, CSS, and JavaScript. Vercel can deploy it directly from the repository root.
