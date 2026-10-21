# Assets and licences

The code is MIT (see `LICENSE`). Non-code assets:

| Files | What | Made with | Licence |
| --- | --- | --- | --- |
| `public/models/*.glb` | the five animals (dog, rabbit, chicken, cat, croc) and the jukebox, with their animation clips | original character sheets drawn with an image generator from our own prompts, turned into rigged, animated models with [Tripo](https://www.tripo3d.ai) (`tools/crop-views.mjs`, `tools/tripo-char.sh`) | CC BY 4.0 |
| `public/assets/portraits/*.webp` | the same characters' portraits | rendered from the models | CC BY 4.0 |
| `public/music/*.m4a` | 院子晚风 / 湖边蹦迪 / 银杏华尔兹 | synthesised by `tools/make-music.py` | CC0 |
| everything else you see (yard, lagoon, plants, furniture, signs, drink boards, textures) | | generated in code at runtime | MIT, with the code |

Credit for CC BY 4.0: "Animal Bar characters by SuncNoob and contributors (CC BY 4.0)".

## Adding your own music

Put an audio file in `public/music/`, add it to `src/data/songs.json` (lyrics optional: `public/music/<id>.lrc`).
Only add music you have the rights to play publicly; commercial songs are not part of this repository.

## Not included

This game started as a fan project for a real bar. Its name, logo, menu photos, drink descriptions and the
songs played there belong to their owners and are not in this repository; the drinks here are generic
craft-beer styles and the music is our own.
