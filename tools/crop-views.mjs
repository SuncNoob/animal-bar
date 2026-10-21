// Split 3-view character sheets (FRONT / RIGHT / BACK in one image) into front/right/back PNGs for Tripo multiview.
// The sheets are not in this repo: point ASSET_SRC at your own folder (the crop boxes below fit the original sheets).
// Crops avoid label text; masks paint over limbs/tails that spill across panels.
import sharp from 'sharp';
import fs from 'node:fs';
const SRC = process.env.ASSET_SRC || 'assets_src';
const JOBS = {
  dog:    { file: 'characters/player_dog_ge_Tpose_3views.png', y: [55, 765],
            front: { x: [15, 676], mask: [[652, 418, 676, 640]] }, right: { x: [664, 1110], mask: [[664, 300, 690, 418]] }, back: { x: [1105, 1765] } },
  rabbit: { file: 'characters/player_rabbit_mei_Tpose_3views.png', y: [20, 770],
            front: { x: [30, 705] }, right: { x: [710, 1100] }, back: { x: [1100, 1765] } },
  cat:    { file: 'characters/npc_cat_tuantuan_Tpose_3views.png', y: [55, 770],
            front: { x: [15, 678], mask: [[650, 415, 678, 640]] }, right: { x: [660, 1075], mask: [[660, 270, 692, 418]] }, back: { x: [1115, 1765] } },
  croc:   { file: 'characters/npc_croc_edazi_Tpose_3views.png', y: [35, 715],
            front: { x: [15, 706], mask: [[625, 480, 706, 650]] }, right: { x: [628, 1268], mask: [[628, 225, 712, 345]] }, back: { x: [1295, 1942] } },
  jibie:  { file: 'characters/jibie_Tpose_3views.png', y: [25, 765], // 鸡瘪
            front: { x: [15, 660] }, right: { x: [662, 1095] }, back: { x: [1100, 1765] } },
  jukebox:{ file: 'props/jukebox_3views.png', y: [20, 890],
            front: { x: [40, 575] }, right: { x: [630, 940] }, back: { x: [990, 1515] } },
};
const only = process.argv[2]; // node tools/crop-views.mjs jibie → just that one
for (const [name, j] of Object.entries(JOBS)) {
  if (only && name !== only) continue;
  const src = j.file.startsWith('/') ? j.file : `${SRC}/${j.file}`;
  const { data } = await sharp(src).extract({ left: 3, top: 3, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  const bg = { r: data[0], g: data[1], b: data[2], alpha: 1 };
  fs.mkdirSync(`asset-work/${name}`, { recursive: true });
  for (const view of ['front', 'right', 'back']) {
    const v = j[view]; const [x0, x1] = v.x; const [y0, y1] = j.y;
    const masks = (v.mask || []).map(([mx0, my0, mx1, my1]) => ({
      input: { create: { width: mx1 - mx0, height: my1 - my0, channels: 3, background: bg } }, left: mx0 - x0, top: my0 - y0,
    }));
    const cut = await sharp(src).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).composite(masks).png().toBuffer();
    const side = Math.max(x1 - x0, y1 - y0) + 40;
    // sharp runs resize before extend inside one pipeline, so pad first, then resize in a second pass
    const sq = await sharp(cut).extend({ top: Math.floor((side - (y1 - y0)) / 2), bottom: Math.ceil((side - (y1 - y0)) / 2), left: Math.floor((side - (x1 - x0)) / 2), right: Math.ceil((side - (x1 - x0)) / 2), background: bg }).png().toBuffer();
    await sharp(sq).resize(1024, 1024).png().toFile(`asset-work/${name}/${view}.png`);
  }
  console.log('ok', name);
}
