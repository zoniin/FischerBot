# Images

## Fischer's portrait

`fischer.webp` (the figure on a transparent ground, to stand directly on the
page above the board), `fischer-wide.webp` (the same bust on a dark ground,
for the opponent chooser and the game-over card) and `fischer-192.png` (the
page icon) all come from one picture.

**Where it is from.** It is the portrait the owner of this project asked for:
an avatar of Fischer from a TikTok post — a mock chess-site screen in which
the portrait says "Stockfish will not save you". Who made the portrait,
and under what terms, is not known to us; it is used here at the owner's
decision. If it is your work and you would like to be credited, or would like
it removed, please open an issue on this repository.

**What was done to it.** The only copy was the one in a phone screenshot,
about 70 pixels wide and in black and white, so it was rebuilt:

1. enlarged four times with Real-ESRGAN;
2. the face sharpened with GFPGAN (a face-restoration network — it fills in
   detail the small original does not contain, so the eyes and mouth are the
   network's reading of a blur, not a record);
3. coloured region by region: a face-parsing model marked skin, hair, brows,
   eyes and lips, brightness and position found the shirt and the tie, and
   each region's grey values were mapped through its own colour ramp;
4. the suit — black on a black background in the original, and so invisible —
   given a plain dark outline.

## Chess pieces

`pieces/*.svg` are the "cburnett" set drawn by Colin M.L. Burnett for
Wikipedia, which he released under the GFDL, the BSD licence and the GPL.
They are used here under the BSD licence; `pieces/LICENSE.txt` carries his
copyright notice and its terms, and is served with them.
