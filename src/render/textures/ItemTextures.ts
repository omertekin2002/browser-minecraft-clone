import type { TexData } from './BlockTextures';

/**
 * Procedural 16×16 item sprites. Each sprite is ASCII pixel art ('.' is transparent) painted
 * with a palette, so one template (a pickaxe, a helmet, an ingot…) serves every material.
 * Heights come from brightness, which gives held/dropped items a slight bevel.
 */

type RGB = [number, number, number];
interface Mat { s: number; f: number; e?: number; sss?: number }
type PalEntry = number | [number, Mat];
type Pal = Record<string, PalEntry>;
export type ItemGen = (t: TexData, rng: () => number) => void;

const ROUGH: Mat = { s: 0.18, f: 0.04 };
const WOODM: Mat = { s: 0.22, f: 0.04 };
const STONEM: Mat = { s: 0.2, f: 0.04 };
const METAL: Mat = { s: 0.72, f: 1 };
const GOLDM: Mat = { s: 0.82, f: 1 };
const GEM: Mat = { s: 0.92, f: 0.17 };
const FOOD: Mat = { s: 0.35, f: 0.04, sss: 0.25 };
const GLOW: Mat = { s: 0.3, f: 0.04, e: 1 };

const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const toHex = (c: RGB) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
function mix(a: number, b: number, t: number): number {
  const A = hex(a), B = hex(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
function scale(a: number, f: number): number {
  const A = hex(a);
  return toHex([Math.min(255, A[0] * f), Math.min(255, A[1] * f), Math.min(255, A[2] * f)]);
}
/** Five shades (a darkest … e lightest) plus an outline 'o' derived from one base colour. */
function ramp(base: number, m: Mat = ROUGH, outline?: number): Pal {
  const o = outline ?? scale(base, 0.32);
  return {
    e: [mix(base, 0xffffff, 0.4), m], d: [mix(base, 0xffffff, 0.15), m], c: [base, m],
    b: [scale(base, 0.8), m], a: [scale(base, 0.62), m], o: [o, m],
  };
}
function withMat(p: Record<string, number>, m: Mat): Pal {
  const out: Pal = {};
  for (const k in p) out[k] = [p[k], m];
  return out;
}

function paint(t: TexData, rows: readonly string[], pal: Pal) {
  t.cutout = true;
  t.normalStrength = 0.55;
  for (let y = 0; y < 16; y++) {
    const r = rows[y];
    for (let x = 0; x < 16; x++) {
      const ch = r[x];
      if (ch === '.') { t.set(x, y, [0, 0, 0], 0); t.h(x, y, 0.3); continue; }
      const e = pal[ch];
      if (e === undefined) throw new Error(`Item sprite: no colour for '${ch}'`);
      const [c, m] = typeof e === 'number' ? [e, ROUGH] : e;
      const rgb = hex(c);
      t.set(x, y, rgb, 255);
      const lum = (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]) / 255;
      t.h(x, y, 0.4 + lum * 0.45);
      t.mat(x, y, m.s, m.f, m.sss ?? 0, m.e ?? 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const S = {
  stick: [
    '................',
    '................',
    '................',
    '............kkk.',
    '...........kHhk.',
    '..........kHhk..',
    '.........kHhk...',
    '........kHhk....',
    '.......kHhk.....',
    '......kHhk......',
    '.....kHhk.......',
    '....kHhk........',
    '...kHhk.........',
    '..kHhk..........',
    '..kkk...........',
    '................',
  ],
  pickaxe: [
    '................',
    '....oooooo......',
    '...obcdeeeoo....',
    '....oooabcddo...',
    '.......oo.abdo..',
    '........kHoacdo.',
    '.......kHhkoacdo',
    '......kHhk..oaco',
    '.....kHhk...oaco',
    '....kHhk....oabo',
    '...kHhk......oao',
    '..kHhk.......oo.',
    '.kHhk...........',
    '.kkk............',
    '................',
    '................',
  ],
  axe: [
    '................',
    '....ooo.........',
    '...oeedoo.......',
    '..oeeddddoo.kkk.',
    '..oedddcccbkHhk.',
    '..oddccccbkHhk..',
    '...occcbbkHhk...',
    '....obaokHhk....',
    '.....ookHhk.....',
    '......kHhk......',
    '.....kHhk.......',
    '....kHhk........',
    '...kHhk.........',
    '..kHhk..........',
    '..kkk...........',
    '................',
  ],
  shovel: [
    '................',
    '...........oo...',
    '..........oeeo..',
    '.........oedddo.',
    '........oeddccbo',
    '........odccbbao',
    '.........occbao.',
    '........kHobao..',
    '.......kHhkoo...',
    '......kHhk......',
    '.....kHhk.......',
    '....kHhk........',
    '...kHhk.........',
    '..kHhk..........',
    '..kkk...........',
    '................',
  ],
  hoe: [
    '................',
    '.....ooooooo....',
    '....oeeedddcoo..',
    '....oddcooocbao.',
    '.....ooo..kHoo..',
    '.........kHhk...',
    '........kHhk....',
    '.......kHhk.....',
    '......kHhk......',
    '.....kHhk.......',
    '....kHhk........',
    '...kHhk.........',
    '..kHhk..........',
    '..kkk...........',
    '................',
    '................',
  ],
  sword: [
    '..............oo',
    '.............oeo',
    '............oedo',
    '...........oedco',
    '..........oedco.',
    '.........oedco..',
    '........oedco...',
    '.......oedco....',
    '..oo..oedco.....',
    '..obooedco......',
    '...obbdco.......',
    '....obbo........',
    '...kHkobo.......',
    '..kHhk.oo.......',
    '.oHhk...........',
    '.ooo............',
  ],
  helmet: [
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...oeeedddcco...',
    '..oeddddcccbbo..',
    '..odccccccccbo..',
    '..odcoooooocbo..',
    '..odco....ocbo..',
    '..obbo....obao..',
    '..oooo....oooo..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '................',
    '..oooo....oooo..',
    '.oeedoooooodcco.',
    '.oedddddddddcbo.',
    '.odddccccccccbo.',
    '.oddoocccccoobo.',
    '.oooo.occcbo.oo.',
    '......odccbo....',
    '......odccbo....',
    '......odcbbo....',
    '......occbao....',
    '......oooooo....',
    '................',
    '................',
    '................',
  ],
  leggings: [
    '................',
    '................',
    '...oooooooooo...',
    '...oeedddccbo...',
    '...oddcccccbo...',
    '...oddcoocbbo...',
    '...odco..ocbo...',
    '...odco..ocbo...',
    '...odco..ocbo...',
    '...odco..obao...',
    '...obbo..obao...',
    '...oooo..oooo...',
    '................',
    '................',
    '................',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '..oooo....oooo..',
    '..oedo....oedo..',
    '..oddo....oddo..',
    '..oddo....oddo..',
    '..oddo....oddo..',
    '.oeddo....oddco.',
    '.oddcbo..obccbo.',
    '.oooooo..oooooo.',
    '................',
    '................',
    '................',
    '................',
  ],
  ingot: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ooooooo..',
    '.....ooeeeeedo..',
    '...ooeeeeddddo..',
    '.ooeeedddddcbo..',
    '.odddddddccbbo..',
    '.obbbbbbbbbbao..',
    '.obbbbbbbbbaoo..',
    '.oooooooooooo...',
    '................',
    '................',
    '................',
  ],
  nugget: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ooo......',
    '.....ooeedo.....',
    '....oeeddcbo....',
    '....odddcbbo....',
    '....odccbbao....',
    '.....oobbaoo....',
    '.......ooo......',
    '................',
    '................',
    '................',
  ],
  diamond: [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....oeedddco....',
    '...oeeddcccbo...',
    '..oeeddcccbbbo..',
    '..odddcccbbbao..',
    '...odcccbbbao...',
    '....ocbbbbao....',
    '.....obbbao.....',
    '......obao......',
    '.......oo.......',
    '................',
    '................',
    '................',
  ],
  emerald: [
    '................',
    '................',
    '.......oo.......',
    '......oedo......',
    '.....oeddco.....',
    '.....oedcco.....',
    '....oedcccbo....',
    '....oedccbbo....',
    '....odcccbbo....',
    '....odccbbao....',
    '.....occbao.....',
    '.....ocbbao.....',
    '......obao......',
    '.......oo.......',
    '................',
    '................',
  ],
  lapis: [
    '................',
    '................',
    '................',
    '................',
    '.......ooo......',
    '.....ooeedoo....',
    '....oeeddccbo...',
    '...oedddccbbo...',
    '...oddcdcbbao...',
    '....odcbbaao....',
    '....oobbaaoo....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  pile: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......e........',
    '......edc.......',
    '.....eddcb......',
    '....eddcdcb..d..',
    '...eddccdcbb.cb.',
    '..edcccbcbbabba.',
    '.edccbbcbbaabaa.',
    '.aabbaabaaaaaa..',
    '................',
    '................',
    '................',
  ],
  lump: [
    '................',
    '................',
    '................',
    '................',
    '......ooooo.....',
    '....ooeddcoo....',
    '...oeddcccbbo...',
    '...odccbbbbao...',
    '..odccbbbaaaao..',
    '..obbbbaaaaao...',
    '...oobaaaaoo....',
    '.....ooooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  raw: [
    '................',
    '................',
    '................',
    '................',
    '.....oooo.......',
    '....oeedoooo....',
    '...oeddcdddco...',
    '..oedcdcccbbo...',
    '..odccbccbbbao..',
    '..odcbbcbbaao...',
    '...obbabaao.....',
    '....ooooooo.....',
    '................',
    '................',
    '................',
    '................',
  ],
  flint: [
    '................',
    '................',
    '................',
    '........oo......',
    '.......oedo.....',
    '......oeddo.....',
    '.....oeddcbo....',
    '....oedccbbo....',
    '....odccbbao....',
    '...odcbbbaao....',
    '...obbbaao......',
    '...oooooo.......',
    '................',
    '................',
    '................',
    '................',
  ],
  ball: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....ooeeddoo....',
    '...oeeddddcbo...',
    '...oedddccbbo...',
    '...odddccbbao...',
    '...odccbbbaao...',
    '....oobbaaoo....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  string: [
    '................',
    '................',
    '............dd..',
    '...........d..d.',
    '..........d.....',
    '.........d......',
    '........dd......',
    '.......d..d.....',
    '......d....d....',
    '......d.....d...',
    '.....d......d...',
    '....d......d....',
    '...d.......d....',
    '..d.............',
    '................',
    '................',
  ],
  feather: [
    '................',
    '................',
    '...........ooo..',
    '..........oeedo.',
    '.........oeeddo.',
    '........oeedddo.',
    '.......oeeddcoo.',
    '......oeeddco...',
    '.....oeedcco....',
    '....oeedcco.....',
    '...oeddcoo......',
    '...oddco........',
    '..ok.oo.........',
    '.ok.............',
    '.o..............',
    '................',
  ],
  leather: [
    '................',
    '................',
    '................',
    '...oooo..oooo...',
    '..oeeddooddcco..',
    '..oeddddddccbo..',
    '...oddccccbbo...',
    '...odccccbbbo...',
    '...odccbbbbao...',
    '..odcccbbbbaao..',
    '..odccbbbbaaao..',
    '..obbboooobbao..',
    '...ooo....ooo...',
    '................',
    '................',
    '................',
  ],
  bone: [
    '................',
    '................',
    '...........oo...',
    '..........oeeoo.',
    '..........oeedeo',
    '.........oeeddo.',
    '........oeedoo..',
    '.......oeedo....',
    '......oeedo.....',
    '.....oeedo......',
    '..ooeedo........',
    '.oedeedo........',
    '.oeddoo.........',
    '..oddo..........',
    '...oo...........',
    '................',
  ],
  paper: [
    '................',
    '................',
    '................',
    '......oooooooooo',
    '.....oeeeeeeeedo',
    '....oeeeeeeeeddo',
    '...oeeeeeeeeddo.',
    '..oeeeeeeeeddo..',
    '.oeeeeeeeeddo...',
    '.oddddddddddo...',
    '.ooooooooooo....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  book: [
    '................',
    '................',
    '................',
    '.....ooooooooooo',
    '....oeeddddddcbo',
    '...oedddddddcbbo',
    '..odddddddddbbo.',
    '.odddddddddbbao.',
    '.obbbbbbbbbbao..',
    '.oPPPPPPPPPpao..',
    '.oPPPPPPPPpao...',
    '.ooooooooooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  seeds: [
    '................',
    '................',
    '................',
    '................',
    '.....oo.........',
    '....oedo...oo...',
    '....oddo..oedo..',
    '.....oo...oddo..',
    '...........oo...',
    '..oo...oo.......',
    '.oedo.oedo......',
    '.oddo.oddo...oo.',
    '..oo...oo...oedo',
    '............oddo',
    '.............oo.',
    '................',
  ],
  wheat: [
    '................',
    '..........oo....',
    '.........oeeo...',
    '....oo...oedo...',
    '...oeeo.oedco...',
    '...oedco.odo.oo.',
    '....odco.oco.oeo',
    '.....ocooco.oedo',
    '......gco.ggodo.',
    '.......gg.goo...',
    '........gGg.....',
    '........Gg......',
    '.......gG.......',
    '......gG........',
    '.....gG.........',
    '................',
  ],
  bowl: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...oooooooooo...',
    '..oSSsSSSsSSSo..',
    '.oSsSSSSsSSSSSo.',
    '.odSSSsSSSSSSbo.',
    '.odccccccccccbo.',
    '..odccccccccbo..',
    '...obbbbbbbbo...',
    '....oooooooo....',
    '................',
    '................',
    '................',
  ],
  stew: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...oooooooooo...',
    '..oSSsSTSsSSSo..',
    '.oSsTSSSsSSTSSo.',
    '.odSSSsSSTSSSbo.',
    '.odccccccccccbo.',
    '..odccccccccbo..',
    '...obbbbbbbbo...',
    '....oooooooo....',
    '................',
    '................',
    '................',
  ],
  apple: [
    '................',
    '................',
    '........k.......',
    '.......kGG......',
    '....ooo.kGGo....',
    '...oeedoooddoo..',
    '..oeeddddddccbo.',
    '..oedddddddcbbo.',
    '..odddddddccbbo.',
    '..odddddddcbbao.',
    '..odddddccbbbao.',
    '...odddccbbbao..',
    '....oddcbbbao...',
    '.....ooooooo....',
    '................',
    '................',
  ],
  bread: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......oooooo....',
    '....ooeeeddcoo..',
    '...oeeeddddccbo.',
    '..oeedddcddcbbo.',
    '..odddcddcdbbbo.',
    '..odddddcbbbbao.',
    '...obbbbbbbaao..',
    '....ooooooooo...',
    '................',
    '................',
    '................',
  ],
  cookie: [
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....oodedcoo....',
    '...oedkddkcco...',
    '...oddddcccbo...',
    '...okdddcckbo...',
    '...odccckbbbo...',
    '....oocbbbao....',
    '......oooo......',
    '................',
    '................',
    '................',
    '................',
  ],
  pie: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '....ooFFFFoo....',
    '...oFfFFfFFfo...',
    '..oFFFfFFFfFFo..',
    '..oeeeeeeeeddo..',
    '..oddddddddcbo..',
    '...obbbbbbbao...',
    '....oooooooo....',
    '................',
    '................',
    '................',
  ],
  chop: [
    '................',
    '................',
    '................',
    '................',
    '.......ooooo....',
    '.....ooFFFFFo...',
    '....oFFeeeddFo..',
    '...oFeeddddddo..',
    '...oFeddddddcbo.',
    '...oFdddddccbbo.',
    '...oFddddccbbao.',
    '....oddccbbbao..',
    '.....ooobbaao...',
    '........oooo....',
    '................',
    '................',
  ],
  steak: [
    '................',
    '................',
    '................',
    '................',
    '......oooooo....',
    '....ooeedddcoo..',
    '...oeddFddccbbo.',
    '..oeddFFdcccbbo.',
    '..odddFdccFbbao.',
    '..odccdcccFbbao.',
    '...odccbbbbaao..',
    '....oobbbaaoo...',
    '......oooooo....',
    '................',
    '................',
    '................',
  ],
  drumstick: [
    '................',
    '................',
    '................',
    '......oooo......',
    '....ooeeddoo....',
    '...oeeddddcco...',
    '...oedddcccbo...',
    '...oddccccbbo...',
    '...odccccbbao...',
    '....ocbbbbao....',
    '.....oobbaoo....',
    '.......oFo......',
    '......oFFo......',
    '......oFFFo.....',
    '.......ooo......',
    '................',
  ],
  fish: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ooooo....',
    '.oo..ooeeeddoo..',
    '.oeooeeeddddkdo.',
    '.oedoeddddddddo.',
    '.odcdddcccccbbo.',
    '.obooccbbbbbbo..',
    '.oo..ooooooo....',
    '................',
    '................',
    '................',
    '................',
  ],
  bucket: [
    '................',
    '................',
    '................',
    '...oooooooooo...',
    '..oeiiiiiiiido..',
    '..oediiiiiiddo..',
    '..oeddddddddco..',
    '...oedddddcco...',
    '...oeddddddco...',
    '...odddddccbo...',
    '....odddccbo....',
    '....occccbbo....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ],
  flint_and_steel: [
    '................',
    '................',
    '................',
    '...oooo.........',
    '..oeddco........',
    '..odooco........',
    '..odo.oo........',
    '..odo....oo.....',
    '..odco..oFFo....',
    '...ooo.oFFFFo...',
    '......oFFFFFo...',
    '.......oFFFo....',
    '........ooo.....',
    '................',
    '................',
    '................',
  ],
  shears: [
    '................',
    '................',
    '...oo...........',
    '..oeeo..........',
    '..oedeo.........',
    '...oedeo.....oo.',
    '....oedeo...oeo.',
    '.....oedeo.oedo.',
    '......oedeoedo..',
    '.......oeddeo...',
    '......ooodd.o...',
    '.....oRRooRRo...',
    '....oRooo.oRo...',
    '....oRRo...oo...',
    '.....oo.........',
    '................',
  ],
  compass: [
    '................',
    '................',
    '................',
    '......oooo......',
    '....oobbbboo....',
    '...obccccccbo...',
    '...obcWWWWcbo...',
    '..obcWWWWRWcbo..',
    '..obcWWWRWWcbo..',
    '..obcWWKWWWcbo..',
    '..obcWKWWWWcbo..',
    '...obcWWWWcbo...',
    '...obccccccbo...',
    '....oobbbboo....',
    '......oooo......',
    '................',
  ],
  clock: [
    '................',
    '................',
    '................',
    '......oooo......',
    '....oobbbboo....',
    '...obccccccbo...',
    '...obcSSYScbo...',
    '..obcSSSSYScbo..',
    '..obcSSSSSScbo..',
    '..obcNNNNNNcbo..',
    '..obcNNNNNNcbo..',
    '...obcNMNNcbo...',
    '...obccccccbo...',
    '....oobbbboo....',
    '......oooo......',
    '................',
  ],
  egg: [
    '................',
    '................',
    '................',
    '................',
    '.......ooo......',
    '......oeedo.....',
    '.....oeeddco....',
    '.....oedkdco....',
    '....oeddddcbo...',
    '....odddkdcbo...',
    '....oddccccbo...',
    '.....odccbbo....',
    '......oooooo....',
    '................',
    '................',
    '................',
  ],
  dye: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......oooo......',
    '.....oeeedo.....',
    '....oeedddco....',
    '...oeddddccbo...',
    '..oeddddccbbbo..',
    '..odddcccbbbao..',
    '...oobbbbbaoo...',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ],
  sac: [
    '................',
    '................',
    '................',
    '.......oo.......',
    '......oeeo......',
    '.....oeddco.....',
    '....oeddddco....',
    '....oddddcbo....',
    '....oddccbbo....',
    '.....occbbo.....',
    '......obbo......',
    '.....ooaaoo.....',
    '....oa.oo.ao....',
    '....o......o....',
    '................',
    '................',
  ],
  beans: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....ooo........',
    '....oeedo..ooo..',
    '...oedkdco.oedo.',
    '...odkddco.okco.',
    '....occbo..obco.',
    '.....ooo...oko..',
    '......oooo.oo...',
    '.....oedkdo.....',
    '.....obccbo.....',
    '......oooo......',
    '................',
  ],
  lantern: [
    '................',
    '.......oo.......',
    '......o..o......',
    '......o..o......',
    '.....oooooo.....',
    '....oddddddo....',
    '.....oYYYYo.....',
    '.....oYWWYo.....',
    '.....oYWWYo.....',
    '.....oYYYYo.....',
    '.....oYYYYo.....',
    '....oddddddo....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ],
} as const;

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

const HANDLE: Pal = withMat({ k: 0x2a1c0e, h: 0x5e4122, H: 0x8a6337 }, WOODM);

const TOOL_MATS: Record<string, Pal> = {
  wooden: withMat({ o: 0x2e1f0c, a: 0x4f3818, b: 0x6d4f25, c: 0x8c6834, d: 0xa88147, e: 0xc39c5c }, WOODM),
  stone: withMat({ o: 0x232323, a: 0x474747, b: 0x5d5d5d, c: 0x737373, d: 0x8b8b8b, e: 0xa5a5a5 }, STONEM),
  iron: withMat({ o: 0x363636, a: 0x6b6b6b, b: 0x959595, c: 0xbdbdbd, d: 0xd8d8d8, e: 0xf2f2f2 }, METAL),
  golden: withMat({ o: 0x5c3b00, a: 0xae780c, b: 0xd49f19, c: 0xeec13a, d: 0xf9dc66, e: 0xfff4a8 }, GOLDM),
  diamond: withMat({ o: 0x0c3a37, a: 0x178a81, b: 0x27bdb1, c: 0x4addd0, d: 0x8cf0e6, e: 0xd4fffa }, GEM),
};

const ARMOR_MATS: Record<string, Pal> = {
  leather: withMat({ o: 0x2e1a0c, a: 0x6a3d1c, b: 0x87502a, c: 0xa0643a, d: 0xb77b4d, e: 0xcc9468 }, ROUGH),
  chainmail: withMat({ o: 0x2a2a2e, a: 0x4c4c55, b: 0x6c6c76, c: 0x8f8f99, d: 0xb5b5bf, e: 0xdcdce4 }, METAL),
  iron: TOOL_MATS.iron,
  golden: TOOL_MATS.golden,
  diamond: TOOL_MATS.diamond,
};

const IRON = TOOL_MATS.iron;
const GOLD = TOOL_MATS.golden;

/** Dye colours (Minecraft's). */
export const DYE_RGB: Record<string, number> = {
  white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da, yellow: 0xfed83d, lime: 0x80c71f,
  pink: 0xf38baa, gray: 0x474f52, light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
  brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21,
};

// ---------------------------------------------------------------------------
// Generator table
// ---------------------------------------------------------------------------

const g = (rows: readonly string[], pal: Pal): ItemGen => (t) => paint(t, rows, pal);

export const ITEM_GENERATORS: Record<string, ItemGen> = {
  stick: g(S.stick, HANDLE),
  coal: g(S.lump, withMat({ o: 0x0a0a0a, a: 0x161616, b: 0x222222, c: 0x2e2e2e, d: 0x404040, e: 0x5e5e5e }, { s: 0.4, f: 0.04 })),
  charcoal: g(S.lump, withMat({ o: 0x0d0906, a: 0x1d140d, b: 0x2b1f15, c: 0x3a2a1d, d: 0x4d3a2a, e: 0x6a543f }, ROUGH)),
  raw_iron: g(S.raw, ramp(0xc9a58a)),
  raw_gold: g(S.raw, ramp(0xe0b32e, { s: 0.5, f: 0.6 })),
  iron_ingot: g(S.ingot, IRON),
  gold_ingot: g(S.ingot, GOLD),
  iron_nugget: g(S.nugget, IRON),
  gold_nugget: g(S.nugget, GOLD),
  diamond: g(S.diamond, TOOL_MATS.diamond),
  emerald: g(S.emerald, withMat({ o: 0x06361a, a: 0x0d7a37, b: 0x17a04a, c: 0x2fd46a, d: 0x7cf0a8, e: 0xd6ffe6 }, GEM)),
  lapis_lazuli: g(S.lapis, ramp(0x2350c4, { s: 0.6, f: 0.05 })),
  redstone: g(S.pile, ramp(0xd0180e, { s: 0.3, f: 0.04, e: 0.35 })),
  flint: g(S.flint, ramp(0x4a4a4a, { s: 0.55, f: 0.04 })),
  clay_ball: g(S.ball, ramp(0x9ea7b8, { s: 0.4, f: 0.04 })),
  brick: g(S.ingot, ramp(0xa04a2e)),
  glowstone_dust: g(S.pile, ramp(0xf2c64a, GLOW)),
  string: g(S.string, withMat({ d: 0xe6e6e6 }, ROUGH)),
  feather: g(S.feather, withMat({ o: 0x6a6a6a, e: 0xffffff, d: 0xe8e8e8, c: 0xcfcfcf, k: 0x8a8a8a }, ROUGH)),
  leather: g(S.leather, ARMOR_MATS.leather),
  bone: g(S.bone, withMat({ o: 0x6f6a5c, e: 0xfbf8ee, d: 0xe6e0cc }, ROUGH)),
  bone_meal: g(S.pile, ramp(0xf2f0e6)),
  gunpowder: g(S.pile, ramp(0x5c5c5c)),
  paper: g(S.paper, withMat({ o: 0x7d7a70, e: 0xf6f4ec, d: 0xd6d2c4 }, ROUGH)),
  book: g(S.book, { ...ramp(0x8a4a24), P: 0xf2eee0, p: 0xcfc8b4 }),
  sugar: g(S.pile, ramp(0xe8e6de, { s: 0.5, f: 0.04 })),
  wheat_seeds: g(S.seeds, withMat({ o: 0x2c3a10, e: 0x9ccc4a, d: 0x6c9a2a }, ROUGH)),
  wheat: g(S.wheat, withMat({ o: 0x5c4308, e: 0xf2da6a, d: 0xdcb43a, c: 0xb88d1e, g: 0x9a8a30, G: 0xc8b048 }, ROUGH)),
  bowl: g(S.bowl, { ...ramp(0x8a6036, WOODM), S: 0x4a3018, s: 0x3e2812 }),
  snowball: g(S.ball, withMat({ o: 0x9fb4c4, a: 0xb4c8d6, b: 0xcadbe6, c: 0xdce8f0, d: 0xeef5f9, e: 0xffffff }, { s: 0.4, f: 0.04, sss: 0.4 })),
  egg: g(S.egg, { ...ramp(0xe6d2a8), k: 0xb8a078 }),
  ink_sac: g(S.sac, ramp(0x2a2a36, { s: 0.6, f: 0.04 }, 0x08080c)),
  cocoa_beans: g(S.beans, { ...ramp(0x835432), k: 0x4a2c14 }),
  apple: g(S.apple, { ...ramp(0xd4201c, FOOD), k: 0x4a2e12, G: 0x3f9a2a }),
  golden_apple: g(S.apple, { ...GOLD, k: 0x4a2e12, G: 0x3f9a2a }),
  bread: g(S.bread, ramp(0xc08a3e, FOOD)),
  mushroom_stew: g(S.stew, { ...ramp(0x8a6036, WOODM), S: [0x9a6a3c, FOOD], s: [0x7a4e28, FOOD], T: [0xcfae7a, FOOD] }),
  cookie: g(S.cookie, { ...ramp(0xc88a44, FOOD), k: 0x4a2a12 }),
  pumpkin_pie: g(S.pie, { ...ramp(0xd8a060, FOOD), F: [0xe07818, FOOD], f: [0xb85a10, FOOD] }),
  porkchop: g(S.chop, { ...ramp(0xf08c8c, FOOD), F: [0xfff0e8, FOOD] }),
  cooked_porkchop: g(S.chop, { ...ramp(0xb07048, FOOD), F: [0xe8c8a0, FOOD] }),
  beef: g(S.steak, { ...ramp(0xc8303a, FOOD), F: [0xf6d8d0, FOOD] }),
  cooked_beef: g(S.steak, { ...ramp(0x7a4a2a, FOOD), F: [0xa87a54, FOOD] }),
  chicken: g(S.drumstick, { ...ramp(0xf2c0a8, FOOD), F: 0xf6f2e6 }),
  cooked_chicken: g(S.drumstick, { ...ramp(0xc07838, FOOD), F: 0xf6f2e6 }),
  cod: g(S.fish, { ...ramp(0x8a9a78, FOOD), k: 0x101010 }),
  cooked_cod: g(S.fish, { ...ramp(0xc8a070, FOOD), k: 0x101010 }),
  shears: g(S.shears, { ...IRON, R: 0xa02020 }),
  flint_and_steel: g(S.flint_and_steel, { ...IRON, F: 0x3e3e3e }),
  bucket: g(S.bucket, { ...IRON, i: 0x2c2c2c }),
  water_bucket: g(S.bucket, { ...IRON, i: [0x3a64d8, { s: 0.95, f: 0.02 }] }),
  lava_bucket: g(S.bucket, { ...IRON, i: [0xf07a18, GLOW] }),
  compass: (t) => drawCompass(t, Math.PI / 4),
  clock: (t) => drawClock(t, 0.25),
  lantern_item: g(S.lantern, { ...withMat({ o: 0x2a2a30, d: 0x5a5a66 }, METAL), Y: [0xffb640, GLOW], W: [0xfff4c0, GLOW] }),
  player_arm: (t, rng) => {
    // Skin with a short sleeve at the shoulder end (top rows).
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const sleeve = y < 5;
        const base = sleeve ? 0x2f9fa8 : 0xc8906a;
        const v = 0.92 + rng() * 0.12 - (x === 0 || x === 15 ? 0.08 : 0);
        t.set(x, y, hex(scale(base, v)), 255);
        t.h(x, y, 0.5 + rng() * 0.1);
        t.mat(x, y, sleeve ? 0.1 : 0.3, 0.04, sleeve ? 0 : 0.45, 0);
      }
    }
    t.normalStrength = 0.4;
  },
};

for (const [mat, pal] of Object.entries(TOOL_MATS)) {
  for (const tool of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword'] as const) {
    ITEM_GENERATORS[`${mat}_${tool}`] = g(S[tool], { ...HANDLE, ...pal });
  }
}
for (const [mat, pal] of Object.entries(ARMOR_MATS)) {
  for (const piece of ['helmet', 'chestplate', 'leggings', 'boots'] as const) {
    ITEM_GENERATORS[`${mat}_${piece}`] = g(S[piece], pal);
  }
}
for (const [c, rgb] of Object.entries(DYE_RGB)) {
  if (c === 'black') ITEM_GENERATORS.black_dye = g(S.dye, ramp(rgb, ROUGH, 0x000000));
  else if (c === 'white') ITEM_GENERATORS.white_dye = g(S.dye, ramp(0xeef2f0, ROUGH, 0x7e8684));
  else ITEM_GENERATORS[`${c}_dye`] = g(S.dye, ramp(rgb));
}

// ---------------------------------------------------------------------------
// Animated items: the compass needle and the clock dial are redrawn as the game runs.
// ---------------------------------------------------------------------------

const COMPASS_BASE = S.compass.map((r) => r.replace(/[RK]/g, 'W'));
const COMPASS_PAL: Pal = { ...withMat({ o: 0x2a2a2a, b: 0x6a6a6a, c: 0x9a9a9a }, METAL), W: 0xe8e8e0 };
const CLOCK_BASE = S.clock.map((r) => r.replace(/[SYNM]/g, 'D'));
const CLOCK_PAL: Pal = { ...withMat({ o: 0x5c3b00, b: 0xae780c, c: 0xeec13a }, GOLDM), D: 0x1a2a5a };

/** Compass with its needle turned `angle` radians clockwise from straight up. */
export function drawCompass(t: TexData, angle: number) {
  paint(t, COMPASS_BASE, COMPASS_PAL);
  const sx = Math.sin(angle), sy = -Math.cos(angle);
  for (let r = -2.6; r <= 3.2; r += 0.2) {
    const x = Math.floor(8 + sx * r), y = Math.floor(9 + sy * r);
    if (COMPASS_BASE[y]?.[x] !== 'W') continue;
    const c = r > 0.2 ? hex(0xd02020) : hex(0x404040);
    t.set(x, y, c, 255);
    t.h(x, y, 0.85);
    t.mat(x, y, 0.4, 0.04);
  }
}

/** Clock whose dial shows the sun at the top at noon and the moon at midnight (dayTime 0 = sunrise). */
export function drawClock(t: TexData, dayTime: number) {
  paint(t, CLOCK_BASE, CLOCK_PAL);
  const sun = (dayTime - 0.25) * Math.PI * 2;
  const sunX = 8 + Math.sin(sun) * 2.1, sunY = 9 - Math.cos(sun) * 2.1;
  const moonX = 8 - Math.sin(sun) * 2.1, moonY = 9 + Math.cos(sun) * 2.1;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (CLOCK_BASE[y][x] !== 'D') continue;
      const px = x + 0.5 - 8, py = y + 0.5 - 9;
      const day = px * Math.sin(sun) - py * Math.cos(sun) > -0.3;
      let c = day ? 0x4a8ad8 : 0x1a2a5a;
      if (Math.hypot(x + 0.5 - sunX, y + 0.5 - sunY) < 1.25) c = 0xfff080;
      else if (Math.hypot(x + 0.5 - moonX, y + 0.5 - moonY) < 1.1) c = 0xe8ecf4;
      t.set(x, y, hex(c), 255);
      t.mat(x, y, 0.5, 0.04, 0, c === 0xfff080 ? 0.4 : 0);
    }
  }
}

/** Validates every template at startup in development (catches malformed rows early). */
export function validateItemSprites(): string[] {
  const errors: string[] = [];
  for (const [name, rows] of Object.entries(S)) {
    if (rows.length !== 16) errors.push(`${name}: ${rows.length} rows`);
    rows.forEach((r, i) => { if (r.length !== 16) errors.push(`${name} row ${i}: ${r.length} chars`); });
  }
  return errors;
}
