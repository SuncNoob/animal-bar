// Single source of truth for the compact courtyard layout (metres, Y up, courtyard floor y = 0).
// North (−z) is the bar wall, south (+z) is the deck and the pool. Every scene module reads from here.

export const WATER_Y = -0.35;

export const LAYOUT = {
  WATER_Y,
  // inner faces of the courtyard walls; the deck starts where the yard ends (z1)
  yard: { x0: -8.3, x1: 8.3, z0: -6.6, z1: 4.0 },
  walls: { northZ: -6.85, westX: -8.6, eastX: 8.6, height: 3.4, thick: 0.5 },
  deck: { x0: -8.3, x1: 8.3, z0: 4.0, z1: 5.6 },
  // "海": a big irregular lagoon south of the deck. The outline is a closed Catmull-Rom loop through
  // these (x, z) points; its north edge runs straight under the deck edge (z = 5.9) between x = -8 and 8.
  sea: {
    outline: [[-8.0, 5.9], [-11.5, 6.6], [-14.5, 9.5], [-15.5, 14.0], [-13.5, 19.0], [-9.0, 22.5], [-3.0, 24.0],
      [3.0, 23.5], [8.5, 22.8], [13.0, 19.5], [15.0, 14.5], [14.0, 9.5], [11.5, 6.7], [8.0, 5.9]],
    island: { x: -1.5, z: 16.5, r: 2.0 }, // rocky islet to swim around (not walkable)
    floorY: -1.8, shelfY: -0.9,            // deep middle, shallow shelf near the shore
    shoreBounds: { x0: -21, x1: 21, z0: 5.6, z1: 31 }, // natural ground around the lagoon fills this box
  },
  // stone steps into the water: step i top at topY - i*drop, spanning z0+i*depth .. z0+(i+1)*depth
  stairs: { x0: 4.0, x1: 6.4, z0: 5.8, depth: 0.75, steps: 4, topY: -0.1, drop: 0.35 },
  bar: { x0: -1.6, x1: 7.4, z0: -4.6, z1: -3.6, top: 1.1, cabinetZ: -6.35, roofFrontZ: -3.4 },
  door: { z: -4.9, halfWidth: 1.1 }, // red door on the west wall
  sign: { x: -5.0, y: 2.22 },        // shop sign on the north wall, left of the bar
  spots: { jukebox: [0, -1.2], cat: [-1.7, -2.1], croc: [5.9, -1.5] }, // jukebox: dead centre of the yard
  barStools: [-0.9, 0.9, 2.7, 4.5],  // x positions, in front of the counter
  barStoolZ: -2.95,
  tables: [[-5.6, -2.6], [-5.6, 0.5], [5.0, 1.7]], // round tables, radius 0.75, stools at 1.05
  tableR: 0.75, stoolRing: 1.05,
  lounge: { x: -7.95, z0: -3.4, z1: 1.5 },          // cushioned bench along the west wall
  bike: [-4.5, -6.0],               // parked under the shop sign, clear of the pot and of the ivy at the wall's foot (reaches z −6.33)
  trees: { hero: [-7.0, 2.7], second: [7.4, 3.0] },
  pots: [[-7.9, -6.2], [-1.9, -6.25], [7.9, -0.6], [7.9, 1.0], [-7.95, 4.2], [3.5, 5.25]], // deck corners stay clear: they lead onto the lagoon bank
  counterPots: [[-1.3, -4.1], [7.1, -4.1]], // on the bar top (y = 1.1), no collider
  // keep-out zones for wall decoration (ivy etc.)
  keepOut: { doorZ: [-6.2, -3.6], signX: [-6.8, -3.2], signY: [1.15, 3.3] },
  // central walking/bumping arena: keep blockers out
  arena: { x0: -4.5, x1: 3.5, z0: -1.8, z1: 3.8 },
};
