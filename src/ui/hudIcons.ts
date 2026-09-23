/** 9×9 pixel icons for the survival HUD (hearts, hunger, armor, air), generated as data URLs. */

const SPRITES: Record<string, string[]> = {
  heart: [
    '.oo...oo.',
    'oRRo.oRRo',
    'oRWRoRRRo',
    'oRRRRRRRo',
    '.oRRRRRo.',
    '..oRRRo..',
    '...oRo...',
    '....o....',
    '.........',
  ],
  food: [
    '.....ooo.',
    '....oMMMo',
    '...oMMWMo',
    '...oMMMMo',
    '..oBoMMo.',
    '.oBo.oo..',
    'oBBo.....',
    'oBo......',
    '.o.......',
  ],
  armor: [
    '.oo...oo.',
    'oAAoooAAo',
    'oAWAAAAAo',
    '.oAAAAAo.',
    '.oAAAAAo.',
    '.oAAAAAo.',
    '.oAAAAAo.',
    '..ooooo..',
    '.........',
  ],
  bubble: [
    '..ooooo..',
    '.oWWBBBo.',
    'oWWBBBBBo',
    'oWBBBBBBo',
    'oBBBBBBBo',
    'oBBBBBBBo',
    '.oBBBBBo.',
    '..ooooo..',
    '.........',
  ],
};

const FULL: Record<string, Record<string, string>> = {
  heart: { o: '#1c0404', R: '#e3262a', W: '#ffc4c4' },
  food: { o: '#241406', M: '#b8662e', W: '#e8a068', B: '#f2ead8' },
  armor: { o: '#1c1c1c', A: '#d8d8d8', W: '#ffffff' },
  bubble: { o: '#0c2a5c', W: '#e6f6ff', B: '#4aa8f0' },
};
const EMPTY: Record<string, Record<string, string>> = {
  heart: { o: '#1c0404', R: '#3a1a1a', W: '#4a2424' },
  food: { o: '#241406', M: '#3a2a1c', W: '#4a3624', B: '#4a4438' },
  armor: { o: '#1c1c1c', A: '#3c3c3c', W: '#4a4a4a' },
  bubble: { o: '#0c2a5c', W: '#6a8ab0', B: '#4a6a90' },
};

const cache = new Map<string, string>();

/** Icon for a HUD bar: fill 2 = full, 1 = half (left half filled), 0 = empty. */
export function hudIcon(kind: 'heart' | 'food' | 'armor' | 'bubble', fill: number, variant = ''): string {
  const key = `${kind}:${fill}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 9;
  const ctx = c.getContext('2d')!;
  const rows = SPRITES[kind];
  const full = { ...FULL[kind] };
  if (variant === 'poison') Object.assign(full, { R: '#8a9a1c', W: '#d8e87a' });
  if (variant === 'hunger') Object.assign(full, { M: '#6a8a2a', W: '#a8c86a' });
  if (variant === 'regen') Object.assign(full, { R: '#ff4a6a', W: '#ffe0e8' });
  // Food icons fill from the right, everything else from the left.
  const flip = kind === 'food';
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const inFill = fill === 2 || (fill === 1 && (flip ? x >= 4 : x <= 4));
      ctx.fillStyle = (inFill ? full : EMPTY[kind])[ch] ?? '#000';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
