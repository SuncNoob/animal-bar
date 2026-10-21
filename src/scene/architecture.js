import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hutongBrick, flagstone, roofTiles, woodPlanks } from './tex.js';
import { LAYOUT as L } from '../layout.js';

// Hutong courtyard shell: paving, grey-brick walls with tiled copings, the bar's tiled roof,
// the red lacquered door with studs, the orange sign, the deck, and neighbours' roofs beyond the walls.

const shadow = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
const std = (o) => new THREE.MeshStandardMaterial(o);

// A gabled tile coping running along a wall top, with round tile ends (瓦当) on both eaves.
// Built along local X around the origin, then placed/rotated onto the wall.
function wallCap(parent, mats, { a, b, y, width = 0.95, along = 'x', ends }) {
  const len = Math.abs(b - a), mid = (a + b) / 2;
  const half = width / 2, rise = 0.28, slopeLen = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  const g = new THREE.Group();
  if (along === 'x') g.position.set(mid, 0, ends.z); else { g.rotation.y = Math.PI / 2; g.position.set(ends.x, 0, mid); }
  parent.add(g);
  for (const s of [1, -1]) {
    const geo = new THREE.PlaneGeometry(len, slopeLen);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.2, uv.getY(i) * slopeLen / 1.2);
    const m = shadow(new THREE.Mesh(geo, mats.roof));
    m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2 + ang, s > 0 ? 0 : Math.PI, 0); // ridge high, eave low on each side
    m.position.set(0, y + rise / 2, s * half / 2);
    g.add(m);
  }
  const ridge = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 10), mats.ridge));
  ridge.rotation.z = Math.PI / 2; ridge.position.set(0, y + rise + 0.03, 0); g.add(ridge);
  const n = Math.floor(len / 0.17);
  const disc = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), mats.ridge, n * 2);
  const o = new THREE.Object3D(); let k = 0;
  for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
    o.position.set(-len / 2 + (i + 0.5) * (len / n), y + 0.02, s * (half + 0.01)); o.rotation.set(Math.PI / 2, 0, 0); o.updateMatrix(); disc.setMatrixAt(k++, o.matrix);
  }
  g.add(disc);
}

export function buildArchitecture(scene, { wordmarkTex }) {
  const G = new THREE.Group(); G.name = 'architecture'; scene.add(G);
  const brick = hutongBrick({ repeat: [1, 1] });
  const stone = flagstone({ repeat: [1, 1] });
  const roof = roofTiles();
  const mats = {
    brick: std({ map: brick.map, normalMap: brick.normalMap, roughnessMap: brick.roughnessMap, roughness: 1, color: 0xd8d4cc }),
    plinth: std({ color: 0x77736c, roughness: 0.95, map: stone.map, normalMap: stone.normalMap }),
    roof: std({ map: roof.map, normalMap: roof.normalMap, roughness: 0.85, color: 0x8a8d93, side: THREE.DoubleSide }),
    ridge: std({ color: 0x45484d, roughness: 0.8 }),
    redLacquer: new THREE.MeshPhysicalMaterial({ color: 0x8f2418, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.35 }),
    gold: std({ color: 0xc9a248, metalness: 0.85, roughness: 0.35 }),
    darkWood: std({ color: 0x4a2f1d, roughness: 0.7 }),
    teal: std({ color: 0x245e63, roughness: 0.6 }),
    stoneLight: std({ color: 0x9b968d, roughness: 0.9 }),
  };
  const brickWall = (w, h, d) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv, nrm = geo.attributes.normal;
    for (let i = 0; i < uv.count; i++) { // world-scaled UVs: 1 texture tile = 1.2m
      const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
      const sx = nx > 0.5 ? d : w, sy = ny > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * sx / 1.2, uv.getY(i) * sy / 1.2);
    }
    return shadow(new THREE.Mesh(geo, mats.brick));
  };

  // ---- paving: one big plane with world-scaled UVs (1 tile = 4m)
  // paving stops where the deck starts so the two never z-fight; 1 texture tile ≈ 2.4 m
  const pw = L.walls.eastX - L.walls.westX + 0.4, pd = L.yard.z1 - L.walls.northZ + 0.2, pcz = (L.yard.z1 + L.walls.northZ - 0.2) / 2;
  for (const t of [stone.map, stone.normalMap, stone.roughnessMap]) t.repeat.set(pw / 2.4, pd / 2.4);
  const pav = shadow(new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), std({ map: stone.map, normalMap: stone.normalMap, roughnessMap: stone.roughnessMap, normalScale: new THREE.Vector2(0.7, 0.7), color: 0xb9b7b3 })), false);
  pav.rotation.x = -Math.PI / 2; pav.position.set(0, 0, pcz); G.add(pav);
  const under = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.5, pd), mats.plinth); under.position.set(0, -0.26, pcz); G.add(under);

  // ---- walls: north (behind the bar), west (door + sign), east
  // side walls stop 0.6 m short of the deck's end so the deck corners open onto the lagoon bank
  const W = L.walls, H = W.height, nLen = W.eastX - W.westX + W.thick, sz0 = W.northZ - W.thick / 2, sz1 = L.deck.z1 - 0.6, sLen = sz1 - sz0, sMid = (sz0 + sz1) / 2;
  const north = brickWall(nLen, H, W.thick); north.position.set(0, H / 2, W.northZ); G.add(north);
  const west = brickWall(W.thick, H, sLen); west.position.set(W.westX, H / 2, sMid); G.add(west);
  const east = brickWall(W.thick, H, sLen); east.position.set(W.eastX, H / 2, sMid); G.add(east);
  // stone plinth course along the wall feet
  for (const [w, d, x, z] of [[nLen, 0.62, 0, W.northZ + 0.05], [0.62, sLen, W.westX + 0.05, sMid], [0.62, sLen, W.eastX - 0.05, sMid]]) {
    const p = shadow(new THREE.Mesh(new RoundedBoxGeometry(w, 0.45, d, 2, 0.03), mats.plinth)); p.position.set(x, 0.22, z); G.add(p);
  }
  wallCap(G, mats, { a: -nLen / 2 - 0.3, b: nLen / 2 + 0.3, y: H, along: 'x', ends: { z: W.northZ } });
  wallCap(G, mats, { a: sz0, b: sz1, y: H, along: 'z', ends: { x: W.westX } });
  wallCap(G, mats, { a: sz0, b: sz1, y: H, along: 'z', ends: { x: W.eastX } });
  // the side walls end at the deck in a brick pier with a tiled cap, not a sliced-off wall
  for (const x of [W.westX, W.eastX]) {
    const pier = brickWall(W.thick + 0.16, H + 0.42, 0.62); pier.position.set(x, (H + 0.42) / 2, sz1 - 0.31); G.add(pier);
    const pb = shadow(new THREE.Mesh(new RoundedBoxGeometry(W.thick + 0.3, 0.5, 0.76, 2, 0.03), mats.plinth)); pb.position.set(x, 0.25, sz1 - 0.31); G.add(pb);
    const cap = shadow(new THREE.Mesh(new THREE.BoxGeometry(W.thick + 0.36, 0.1, 0.82), mats.ridge)); cap.position.set(x, H + 0.47, sz1 - 0.31); G.add(cap);
    const hip = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.32, 4, 1), mats.roof)); hip.rotation.y = Math.PI / 4; hip.scale.set(1, 1, 1.05); hip.position.set(x, H + 0.68, sz1 - 0.31); G.add(hip);
    const knob = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mats.ridge)); knob.position.set(x, H + 0.86, sz1 - 0.31); G.add(knob);
  }

  // ---- red door on the west wall (z = -3) with studs, knockers, stone drums and a little tiled porch roof
  const door = new THREE.Group(); door.position.set(W.westX + W.thick / 2 + 0.03, 0, L.door.z); door.rotation.y = Math.PI / 2; G.add(door);
  const frameM = mats.redLacquer;
  for (const s of [-1, 1]) { const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.7, 0.22), frameM)); post.position.set(s * 1.05, 1.35, 0.02); door.add(post); }
  const lintel = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.26, 0.26), frameM)); lintel.position.set(0, 2.78, 0.03); door.add(lintel);
  for (const s of [-1, 1]) { // 门簪 hexagonal pegs on the lintel
    const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 6), mats.gold); peg.rotation.x = Math.PI / 2; peg.position.set(s * 0.45, 2.78, 0.2); door.add(peg);
  }
  const studs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 10, 8), mats.gold, 50); let si = 0; const o = new THREE.Object3D();
  for (const s of [-1, 1]) {
    const leaf = shadow(new THREE.Mesh(new RoundedBoxGeometry(0.95, 2.45, 0.08, 2, 0.015), mats.redLacquer)); leaf.position.set(s * 0.48, 1.25, 0.04); door.add(leaf);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { o.position.set(s * 0.48 + (c - 2) * 0.16, 0.55 + r * 0.33, 0.09); o.updateMatrix(); studs.setMatrixAt(si++, o.matrix); }
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 6), mats.gold); plate.rotation.x = Math.PI / 2; plate.position.set(s * 0.13, 1.3, 0.1); door.add(plate);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 20), mats.gold); ring.position.set(s * 0.13, 1.22, 0.115); door.add(ring);
    const drum = shadow(new THREE.Group()); drum.position.set(s * 1.35, 0, 0.35); door.add(drum); // 门墩
    const base = shadow(new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.42, 0.6, 2, 0.03), mats.stoneLight)); base.position.y = 0.21; drum.add(base);
    const cyl = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.22, 20), mats.stoneLight)); cyl.rotation.z = Math.PI / 2; cyl.position.y = 0.66; drum.add(cyl);
  }
  door.add(studs);
  // a little tiled porch roof (门楼), tucked under the wall's coping: tile slope + 瓦当 along its eave, rafter ends, painted beam
  const porch = new THREE.Group(); porch.position.set(0, 2.98, 0); door.add(porch);
  const PW = 2.9, PD = 0.95, PR = 0.3, pSlope = Math.hypot(PD, PR), pAng = Math.atan2(PR, PD);
  const pGeo = new THREE.PlaneGeometry(PW, pSlope); { const uv = pGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * PW / 1.2, uv.getY(i) * pSlope / 1.2); }
  const pr = shadow(new THREE.Mesh(pGeo, mats.roof)); pr.rotation.x = -Math.PI / 2 + pAng; pr.position.set(0, PR / 2, PD / 2 + 0.02); porch.add(pr);
  const pUnder = new THREE.Mesh(new THREE.PlaneGeometry(PW, pSlope), mats.darkWood); pUnder.rotation.x = Math.PI / 2 + pAng; pUnder.position.set(0, PR / 2 - 0.035, PD / 2 + 0.02); porch.add(pUnder);
  const pRidge = shadow(new THREE.Mesh(new THREE.BoxGeometry(PW + 0.1, 0.12, 0.14), mats.ridge)); pRidge.position.set(0, PR + 0.04, 0.06); porch.add(pRidge);
  const nD = Math.floor(PW / 0.18), pDisc = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), mats.ridge, nD), pRaf = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 0.22), mats.redLacquer, nD);
  for (let i = 0; i < nD; i++) { const px = -PW / 2 + (i + 0.5) * PW / nD; o.position.set(px, 0.02, PD + 0.03); o.rotation.set(Math.PI / 2, 0, 0); o.updateMatrix(); pDisc.setMatrixAt(i, o.matrix); o.position.set(px, -0.07, PD - 0.12); o.rotation.set(0, 0, 0); o.updateMatrix(); pRaf.setMatrixAt(i, o.matrix); }
  porch.add(pDisc, pRaf);
  const beam = shadow(new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.2, 0.16), mats.teal)); beam.position.set(0, -0.2, 0.62); porch.add(beam);
  for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.17), std({ color: 0xd9772a })); st.position.set(s * 0.8, -0.2, 0.63); porch.add(st); }
  for (const s of [-1, 1]) { const br = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.36, 0.6), mats.redLacquer)); br.position.set(s * 1.32, -0.12, 0.32); porch.add(br); } // brackets back to the wall

  // ---- shop sign board (west wall, z = -7) with two gooseneck lamps
  const sign = new THREE.Group(); sign.position.set(L.sign.x, L.sign.y, W.northZ + W.thick / 2 + 0.06); G.add(sign);
  const boardTex = woodPlanks({ planks: 4, tone: [214, 120, 46], vertical: false });
  // the wordmark is the vertical 跳/海 calligraphy (4:5), so the board is tall
  const SW = 1.6, SH = 1.95;
  const board = shadow(new THREE.Mesh(new RoundedBoxGeometry(SW, SH, 0.1, 3, 0.04), std({ map: boardTex.map, normalMap: boardTex.normalMap, roughness: 0.7 })));
  sign.add(board);
  if (wordmarkTex) {
    const wh = SH - 0.2, ww = wh * (wordmarkTex.image ? wordmarkTex.image.width / wordmarkTex.image.height : 0.8);
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), new THREE.MeshStandardMaterial({ map: wordmarkTex, transparent: true, roughness: 0.6 }));
    wm.position.z = 0.056; sign.add(wm);
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.015, 6, 12, Math.PI / 2), std({ color: 0x222222, metalness: 0.6, roughness: 0.4 }));
    arm.position.set(s * 0.55, SH / 2 + 0.06, 0.1); arm.rotation.set(0, Math.PI / 2, Math.PI); sign.add(arm);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 12, 1, true), std({ color: 0x222222, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })); shade.position.set(s * 0.55, SH / 2 + 0.09, 0.33); shade.rotation.x = Math.PI * 0.75; sign.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff1c8 })); bulb.position.set(s * 0.55, SH / 2 + 0.05, 0.36); sign.add(bulb);
  }
  const signLight = new THREE.SpotLight(0xffc27a, 6, 4, 0.9, 0.6, 1.5); signLight.position.set(L.sign.x, L.sign.y + 1, W.northZ + 0.9); signLight.target.position.set(L.sign.x, L.sign.y - 0.1, W.northZ); G.add(signLight, signLight.target);

  // ---- deck: individual planks with gaps + a fascia beam over the water
  const deckWood = woodPlanks({ planks: 1, tone: [168, 112, 66] });
  const plankGeo = new RoundedBoxGeometry(1, 0.08, 0.2, 1, 0.012);
  const deckMat = std({ map: deckWood.map, normalMap: deckWood.normalMap, roughness: 0.75 });
  const D = L.deck, nPl = Math.round((D.z1 - D.z0) / 0.205); const planks = new THREE.InstancedMesh(plankGeo, deckMat, nPl * 6); let pi = 0; const col = new THREE.Color();
  for (let r = 0; r < nPl; r++) {
    let x = D.x0 + (r % 2) * 1.6 - 1.6 * (r % 2 ? 0.5 : 0);
    while (x < D.x1) {
      const len = Math.min(3.2 + (r * 7 % 3) * 0.6, D.x1 - x); if (pi >= nPl * 6) break;
      o.position.set(x + len / 2, -0.04, D.z0 + r * 0.205 + 0.1); o.scale.set(len - 0.02, 1, 1); o.rotation.set(0, 0, 0); o.updateMatrix(); planks.setMatrixAt(pi, o.matrix);
      col.setHSL(0.07, 0.45, 0.42 + ((pi * 37) % 10) / 100); planks.setColorAt(pi, col); pi++; x += len;
    }
  }
  planks.count = pi; shadow(planks, false, true); G.add(planks);
  const fascia = shadow(new THREE.Mesh(new THREE.BoxGeometry(D.x1 - D.x0 + 0.2, 0.3, 0.16), mats.darkWood)); fascia.position.set(0, -0.2, D.z1 + 0.08); G.add(fascia);
  // stone landings at both deck corners: the step from the boardwalk onto the bank
  for (const s of [-1, 1]) {
    const slab = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.95, 0.32, 1.0, 2, 0.05), mats.stoneLight));
    slab.position.set(s * 8.85, -0.155, 5.42); G.add(slab);
    const step = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.22, 0.5, 2, 0.04), mats.stoneLight));
    step.position.set(s * 9.55, -0.2, 6.0); step.rotation.y = s * 0.2; G.add(step);
  }
  const deckBed = new THREE.Mesh(new THREE.BoxGeometry(D.x1 - D.x0, 0.3, D.z1 - D.z0), mats.darkWood); deckBed.position.set(0, -0.24, (D.z0 + D.z1) / 2); G.add(deckBed);

  // ---- ground outside the courtyard walls (seen from the lagoon bank now that the deck corners are open);
  // it meets the lagoon module's terrain at z = 5.6 and sits just under the paving inside the walls
  {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#5f6a3f'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = Math.random(); g.fillStyle = v < 0.5 ? 'rgba(120,135,70,.35)' : v < 0.8 ? 'rgba(70,60,40,.25)' : 'rgba(170,160,110,.2)'; g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 1 + Math.random() * 3); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 7); t.colorSpace = THREE.SRGBColorSpace;
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(42, 20), std({ map: t, roughness: 1 }));
    outside.rotation.x = -Math.PI / 2; outside.position.set(0, -0.02, 5.6 - 10); outside.receiveShadow = true; G.add(outside);
  }

  // ---- neighbours beyond the walls: grey-brick hutong houses with tiled gable roofs, ridges with curled ends,
  // 瓦当 tile ends along the eaves, painted rafter ends, brick gables, lattice windows (some lit), AC units, chimneys
  // and TV aerials. Everything is merged per material (+ two instanced sets), so all six houses cost ~10 draw calls.
  buildNeighbours(G, { brick: mats.brick, plinth: mats.plinth, ridge: mats.ridge, roofTex: roof });

  return { group: G, mats };
}

// ---------------------------------------------------------------------------------------------------------------
function latticeTexture(lit) { // 步步锦-style window lattice on paper (lit) or dark glass
  const c = document.createElement('canvas'); c.width = 128; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = lit ? '#ffcf86' : '#262a31'; g.fillRect(0, 0, 128, 160);
  if (lit) { const gr = g.createRadialGradient(64, 90, 10, 64, 90, 110); gr.addColorStop(0, 'rgba(255,240,200,.9)'); gr.addColorStop(1, 'rgba(240,150,60,.0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 160); }
  else { g.fillStyle = 'rgba(160,170,190,.18)'; g.beginPath(); g.moveTo(10, 150); g.lineTo(60, 10); g.lineTo(80, 10); g.lineTo(30, 150); g.fill(); }
  g.strokeStyle = '#4a2416'; g.lineCap = 'square';
  g.lineWidth = 10; g.strokeRect(5, 5, 118, 150);                       // frame
  g.lineWidth = 4; for (const [x0, y0, x1, y1] of [[22, 20, 106, 140], [40, 38, 88, 122]]) g.strokeRect(x0, y0, x1 - x0, y1 - y0); // nested 步步锦
  g.beginPath(); for (const x of [22, 64, 106]) { g.moveTo(x, 5); g.lineTo(x, 20); g.moveTo(x, 140); g.lineTo(x, 155); }
  for (const y of [38, 80, 122]) { g.moveTo(5, y); g.lineTo(22, y); g.moveTo(106, y); g.lineTo(123, y); } g.moveTo(64, 38); g.lineTo(64, 122); g.moveTo(40, 80); g.lineTo(88, 80); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function boxUV(geo, w, h, d, tile) { // world-scaled UVs (1 texture tile = `tile` metres)
  const uv = geo.attributes.uv, nrm = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) { const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)); uv.setXY(i, uv.getX(i) * (nx > 0.5 ? d : w) / tile, uv.getY(i) * (ny > 0.5 ? d : h) / tile); }
  return geo;
}
function buildNeighbours(G, { brick, plinth, ridge, roofTex }) {
  const buckets = new Map(); // material → geometries (already in world space)
  const put = (mat, geo, m4) => { geo = geo.index ? geo.toNonIndexed() : geo; geo.applyMatrix4(m4); for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k); (buckets.get(mat) || buckets.set(mat, []).get(mat)).push(geo); };
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex.map, normalMap: roofTex.normalMap, color: 0x8d9096, roughness: 0.88, side: THREE.DoubleSide });
  const soffit = new THREE.MeshStandardMaterial({ color: 0x3b2a20, roughness: 0.9, side: THREE.DoubleSide });
  const redWood = new THREE.MeshStandardMaterial({ color: 0x7a2a1c, roughness: 0.6 });
  const tealPaint = new THREE.MeshStandardMaterial({ color: 0x2c5f62, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 });
  const acWhite = new THREE.MeshStandardMaterial({ color: 0xd9d7cf, roughness: 0.7 });
  const litTex = latticeTexture(true), darkTex = latticeTexture(false);
  const winLit = new THREE.MeshStandardMaterial({ map: litTex, emissiveMap: litTex, emissive: new THREE.Color(1.0, 0.72, 0.42), emissiveIntensity: 1.25, roughness: 0.8 });
  const winDark = new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.35, metalness: 0.1 });
  const discs = [], rafters = [];

  // (x, z) centre, w along the ridge, d deep, h eave height; rotY turns the front (local +z) toward the courtyard
  const house = (x, z, w, d, h, rotY, { lit = [0, 1], ac = false, chimney = false, aerial = false } = {}) => {
    const base = new THREE.Matrix4().compose(P.set(x, 0, z), Q.setFromEuler(E.set(0, rotY, 0)), S1);
    const at = (px, py, pz, rx = 0, ry = 0, rz = 0) => M4.compose(P.set(px, py, pz), Q.setFromEuler(E.set(rx, ry, rz)), S1).premultiply(base);
    // walls + plinth course
    put(brick, boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 1.2), at(0, h / 2, 0));
    put(plinth, boxUV(new THREE.BoxGeometry(w + 0.12, 0.55, d + 0.12), w + 0.12, 0.55, d + 0.12, 1.2), at(0, 0.27, 0));
    // gable roof, ridge along local x: two tile planes from the ridge to eaves that overhang the walls
    const over = 0.5, ox = 0.35, rise = d * 0.36, half = d / 2 + over, eave = h - 0.18, slope = Math.hypot(half, rise + 0.18), ang = Math.atan2(rise + 0.18, half), len = w + ox * 2;
    for (const s of [1, -1]) {
      const pg = new THREE.PlaneGeometry(len, slope); const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.3, uv.getY(i) * slope / 1.3);
      put(roofMat, pg, at(0, eave + (rise + 0.18) / 2, s * half / 2, s * (-Math.PI / 2 + ang), s > 0 ? 0 : Math.PI, 0)); // tiles up
      put(soffit, new THREE.PlaneGeometry(len, slope), at(0, eave + (rise + 0.18) / 2 - 0.04, s * half / 2, s * (Math.PI / 2 + ang), s > 0 ? 0 : Math.PI, 0)); // dark underside
      // 瓦当 along this eave + rafter ends under the front eave
      const n = Math.floor(len / 0.19);
      for (let i = 0; i < n; i++) discs.push(at(-len / 2 + (i + 0.5) * len / n, eave + 0.03, s * (half + 0.01), Math.PI / 2, 0, 0).clone());
      if (s > 0) for (let i = 0; i < Math.floor(w / 0.32); i++) rafters.push(at(-w / 2 + 0.16 + i * 0.32, eave - 0.1, d / 2 + 0.16, 0, 0, 0).clone());
    }
    // ridge with curled ends (蝎子尾)
    const ry = eave + rise + 0.18;
    put(ridge, new THREE.BoxGeometry(len + 0.1, 0.24, 0.3), at(0, ry + 0.06, 0));
    put(ridge, new THREE.BoxGeometry(len - 0.2, 0.08, 0.36), at(0, ry - 0.06, 0));
    for (const sx of [-1, 1]) {
      put(ridge, new THREE.BoxGeometry(0.36, 0.16, 0.26), at(sx * (len / 2 + 0.08), ry + 0.2, 0, 0, 0, sx * -0.65));
      put(ridge, new THREE.SphereGeometry(0.1, 8, 6), at(sx * (len / 2 + 0.2), ry + 0.33, 0));
      // brick gable end filling the triangle between the eaves and the ridge
      const sh = new THREE.Shape(); sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(0, rise + 0.1); sh.closePath();
      const gg = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }); const guv = gg.attributes.uv; for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) / 1.2, guv.getY(i) / 1.2);
      put(brick, gg, at(sx * (w / 2 - 0.15) + (sx > 0 ? -0.15 : 0.15) * 0, eave - 0.02, 0, 0, Math.PI / 2, 0).multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.15)));
    }
    // front facade: a row of lattice windows in the band that shows above the courtyard wall, a lintel band
    put(tealPaint, new THREE.BoxGeometry(w - 0.3, 0.16, 0.06), at(0, eave - 0.24, d / 2 + 0.03));
    const nW = Math.max(2, Math.floor(w / 2.1));
    for (let i = 0; i < nW; i++) {
      const wx = -w / 2 + (i + 0.5) * w / nW, wc = eave - 1.0, isLit = lit.includes(i); // high enough to show over the courtyard wall
      put(isLit ? winLit : winDark, new THREE.PlaneGeometry(0.95, 1.1), at(wx, wc, d / 2 + 0.035));
      put(redWood, new THREE.BoxGeometry(1.15, 0.1, 0.12), at(wx, wc + 0.62, d / 2 + 0.06));   // head
      put(redWood, new THREE.BoxGeometry(1.15, 0.1, 0.16), at(wx, wc - 0.63, d / 2 + 0.08));   // sill
      for (const sx of [-1, 1]) put(redWood, new THREE.BoxGeometry(0.09, 1.3, 0.1), at(wx + sx * 0.53, wc, d / 2 + 0.05));
    }
    if (ac) { // an outdoor AC unit hung under a window, with its pipe
      const ax = -w / 2 + 0.5 * w / nW + 0.9;
      put(acWhite, new THREE.BoxGeometry(0.78, 0.52, 0.28), at(ax, eave - 2.05, d / 2 + 0.18));
      put(metal, new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), at(ax - 0.12, eave - 2.05, d / 2 + 0.33, Math.PI / 2, 0, 0));
      put(metal, new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), at(ax + 0.32, eave - 1.6, d / 2 + 0.1));
      for (const sx of [-1, 1]) put(metal, new THREE.BoxGeometry(0.03, 0.03, 0.34), at(ax + sx * 0.3, eave - 2.33, d / 2 + 0.17));
    }
    if (chimney) { const cx = w * 0.28; put(brick, boxUV(new THREE.BoxGeometry(0.42, 1.0, 0.42), 0.42, 1.0, 0.42, 1.2), at(cx, ry - 0.1, -0.35)); put(ridge, new THREE.BoxGeometry(0.56, 0.08, 0.56), at(cx, ry + 0.44, -0.35)); }
    if (aerial) { // an old TV aerial on a mast
      const axx = -w * 0.3; put(metal, new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), at(axx, ry + 0.8, 0.1));
      for (let k = 0; k < 4; k++) put(metal, new THREE.CylinderGeometry(0.012, 0.012, 0.9 - k * 0.15, 5), at(axx, ry + 1.0 + k * 0.17, 0.1, 0, 0, Math.PI / 2));
    }
  };
  // north, behind the bar and the sign; west and east beyond the side walls (fronts face the courtyard)
  house(-4.95, -10.4, 7.6, 5, 4.6, 0, { lit: [1, 3], ac: true, aerial: true }); // a narrow alley before the next house: ridges don't collide
  house(4.5, -10.2, 9, 5.5, 5.0, 0, { lit: [0, 2], chimney: true });
  house(-12, -3.2, 7, 5, 4.4, Math.PI / 2, { lit: [1], ac: true });
  house(-12.2, -10.5, 6, 5, 4.0, Math.PI / 2, { lit: [0], chimney: true });
  house(12, -3.5, 8, 5, 4.8, -Math.PI / 2, { lit: [0, 2], aerial: true });
  house(12.4, -10.8, 6, 5, 4.2, -Math.PI / 2, { lit: [1], ac: true });

  const NG = new THREE.Group(); NG.name = 'neighbours'; G.add(NG);
  for (const [mat, geos] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.castShadow = mat !== winLit && mat !== winDark; m.receiveShadow = true; NG.add(m);
  }
  const discGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 10), di = new THREE.InstancedMesh(discGeo, ridge, discs.length);
  discs.forEach((m, i) => di.setMatrixAt(i, m)); NG.add(di);
  const rafGeo = new THREE.BoxGeometry(0.12, 0.12, 0.34), ri = new THREE.InstancedMesh(rafGeo, redWood, rafters.length);
  rafters.forEach((m, i) => { ri.setMatrixAt(i, m); }); NG.add(ri);
}

