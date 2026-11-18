# Images

## Fischer's portrait

`fischer.webp` (the avatar beside the board), `fischer-wide.webp` (the same
picture cut wider, for the opponent chooser and the game-over card) and
`fischer-192.png` (the page icon) are made from one photograph:

> **Schaker Bobby Fisher aan bord (archief)** — Fischer at the board.
> Photo collection Anefo, Nationaal Archief, The Hague, item 924-7362
> (archive photograph, filed 15 July 1971).
> Licence: **CC0 1.0** (public domain dedication).
> <https://commons.wikimedia.org/wiki/File:Schaker_Bobby_Fisher_aan_bord_(archief),_Bestanddeelnr_924-7362.jpg>

The original is black and white. It was coloured for this project, region by
region: a face-parsing model marked skin, hair, lips and clothing, brightness
and position separated shirt, tie and suit, and each region's grey values
were mapped through its own colour ramp (skin tones, brown hair, a navy suit,
a white shirt, a deep blue backdrop), followed by a light edge-preserving
smoothing. Nothing was drawn in or changed in the picture itself, but the
colours are a reconstruction, not a record: nobody noted what he wore that day.

## Chess pieces

`pieces/*.svg` are the "cburnett" set drawn by Colin M.L. Burnett for
Wikipedia, which he released under the GFDL, the BSD licence and the GPL.
