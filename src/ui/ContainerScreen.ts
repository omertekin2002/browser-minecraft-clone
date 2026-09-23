import { Menu, Slot } from '../game/Menu';
import { ITEMS, ItemStack, CREATIVE_TABS, CATEGORY_NAMES, Category, itemByName, ARMOR_PIECES } from '../world/items';
import { RECIPES, Recipe, recipeFits, recipeLayout, recipeIngredients, ingredientName } from '../world/recipes';
import { itemIcon } from './icons';

export interface ScreenHost {
  /** Throws items out of the window into the world. */
  drop(s: ItemStack): void;
}

type CreativeTab = Category | 'search' | 'inventory';

const TAB_ICONS: Record<CreativeTab, string> = {
  building: 'bricks', colored: 'cyan_wool', natural: 'grass_block', functional: 'crafting_table',
  tools: 'iron_pickaxe', combat: 'golden_sword', food: 'apple', ingredients: 'iron_ingot', search: 'compass', inventory: 'chest',
};
const TAB_ORDER: CreativeTab[] = ['building', 'colored', 'natural', 'functional', 'tools', 'combat', 'food', 'ingredients', 'search', 'inventory'];
const ARMOR_GHOSTS = ARMOR_PIECES.map((p) => `leather_${p}`);

/** Order of items in the creative inventory (used to sort the recipe book). */
const ITEM_ORDER = new Map<number, number>();
TAB_ORDER.forEach((t) => { if (t in CREATIVE_TABS) CREATIVE_TABS[t as Category].forEach((id) => ITEM_ORDER.set(id, ITEM_ORDER.size)); });

const BOOK_KEY = 'voxelcraft:recipeBook';

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

/**
 * DOM front end for container menus: the survival inventory, crafting table, furnace, chests and
 * the creative inventory, with a Minecraft-style recipe book.
 */
export class ContainerScreen {
  private menu: Menu | null = null;
  private title = '';
  private slotEls = new Map<number, HTMLElement>();
  private paletteEl: HTMLElement | null = null;
  private cursorEl: HTMLElement;
  private tipEl: HTMLElement;
  private hover = -1;
  private hoverPalette = 0;
  private drag: { button: number; start: number; slots: Set<number> } | null = null;
  private lastClick = { t: 0, i: -1 };
  private mouse = { x: 0, y: 0 };
  private tab: CreativeTab = 'building';
  private search = '';
  private bookOpen = true;
  private bookCraftable = false;
  private bookSearch = '';
  private bookEls: Array<[Recipe, HTMLElement]> = [];
  private ghost: Recipe | null = null;
  private playerCanvas: HTMLCanvasElement | null = null;

  constructor(private root: HTMLElement, private host: ScreenHost) {
    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'cursor-stack';
    this.tipEl = document.createElement('div');
    this.tipEl.id = 'item-tip';
    document.body.append(this.cursorEl, this.tipEl);
    try { this.bookOpen = localStorage.getItem(BOOK_KEY) !== '0'; } catch { /* ignore */ }

    root.addEventListener('mousedown', (e) => this.onDown(e));
    root.addEventListener('mousemove', (e) => this.onMove(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('dragstart', (e) => e.preventDefault());
    root.addEventListener('dblclick', (e) => e.preventDefault());
    window.addEventListener('mouseup', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen() {
    return this.menu !== null;
  }

  get current(): Menu | null {
    return this.menu;
  }

  open(menu: Menu, title: string) {
    this.menu = menu;
    this.title = title;
    this.ghost = null;
    this.drag = null;
    this.hover = -1;
    this.build();
    this.render();
  }

  close() {
    this.menu = null;
    this.root.innerHTML = '';
    this.cursorEl.style.display = 'none';
    this.tipEl.style.display = 'none';
    this.slotEls.clear();
    this.bookEls = [];
  }

  // ---------------------------------------------------------------------------
  // Building
  // ---------------------------------------------------------------------------

  private slotEl(i: number, extra = ''): HTMLElement {
    const el = document.createElement('div');
    el.className = `islot ${extra}`.trim();
    el.dataset.i = String(i);
    el.innerHTML = '<img class="ghost" alt=""/><img class="icon" alt=""/><span class="cnt"></span><div class="dur"><i></i></div>';
    this.slotEls.set(i, el);
    return el;
  }

  private groupEls(group: Slot['group'], cls = ''): HTMLElement[] {
    const m = this.menu!;
    return m.slots.map((s, i) => (s.group === group ? this.slotEl(i, cls) : null)).filter((e): e is HTMLElement => !!e);
  }

  private grid(cols: number, els: HTMLElement[], cls = ''): HTMLElement {
    const g = document.createElement('div');
    g.className = `sgrid ${cls}`.trim();
    g.style.setProperty('--cols', String(cols));
    g.append(...els);
    return g;
  }

  private el(tag: string, cls: string, html = ''): HTMLElement {
    const e = document.createElement(tag);
    e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  private build() {
    const m = this.menu!;
    this.root.innerHTML = '';
    this.slotEls.clear();
    this.bookEls = [];
    this.paletteEl = null;
    this.playerCanvas = null;

    const wrap = this.el('div', 'inv-wrap');
    const panel = this.el('div', `inv-panel kind-${m.kind}`);

    if (m.kind === 'creative') {
      this.buildCreative(panel);
    } else {
      panel.append(this.el('div', 'inv-title', esc(this.title)));
      const top = this.el('div', 'inv-top');
      if (m.kind === 'inventory') {
        const armor = this.grid(1, this.groupEls('armor', 'armor'), 'armor-col');
        this.playerCanvas = document.createElement('canvas');
        this.playerCanvas.className = 'player-preview';
        this.playerCanvas.width = 32;
        this.playerCanvas.height = 64;
        const box = this.el('div', 'player-box');
        box.append(this.playerCanvas);
        top.append(armor, box, this.craftArea(2));
      } else if (m.kind === 'crafting') {
        top.append(this.craftArea(3));
      } else if (m.kind === 'furnace') {
        const col = this.el('div', 'furnace-col');
        col.append(this.slotEl(m.slotIndex('input', 0)), this.el('div', 'flame', '<i></i>'), this.slotEl(m.slotIndex('fuel', 1)));
        const arrow = this.el('div', 'arrow progress', '<i></i>');
        top.append(col, arrow, this.el('div', 'result-wrap'));
        top.lastElementChild!.append(this.slotEl(m.slotIndex('output', 2), 'big'));
        top.classList.add('furnace-top');
      } else if (m.kind === 'chest') {
        top.append(this.grid(9, this.groupEls('container')));
      }
      panel.append(top);
      panel.append(this.el('div', 'inv-label', 'Inventory'));
      panel.append(this.grid(9, this.groupEls('main')));
      panel.append(this.grid(9, this.groupEls('hotbar'), 'hotbar-row'));
    }
    panel.append(this.el('div', 'inv-hint', m.kind === 'creative'
      ? '<b>Click</b> to hotbar · <b>Right-click</b> pick up stack · <b>1–9</b> hover to slot · <b>E</b> close'
      : '<b>Shift-click</b> move · <b>Right-click</b> split · <b>Drag</b> spread · <b>Q</b> drop · <b>E</b> close'));

    if (m.gridW) wrap.append(this.buildBook());
    wrap.append(panel);
    this.root.append(wrap);
  }

  private craftArea(w: number): HTMLElement {
    const area = this.el('div', 'craft-area');
    const head = this.el('div', 'craft-head');
    head.append(this.el('span', 'inv-label', 'Crafting'));
    const btn = this.el('button', 'book-btn', `<img alt="" src="${itemIcon(itemByName('book')!.id)}"/>`) as HTMLButtonElement;
    btn.title = 'Recipe Book';
    btn.addEventListener('click', () => {
      this.bookOpen = !this.bookOpen;
      try { localStorage.setItem(BOOK_KEY, this.bookOpen ? '1' : '0'); } catch { /* ignore */ }
      this.root.querySelector('.recipe-book')?.classList.toggle('hidden', !this.bookOpen);
    });
    head.append(btn);
    const row = this.el('div', 'craft-row');
    row.append(this.grid(w, this.groupEls('grid'), 'craft-grid'), this.el('div', 'arrow'), this.el('div', 'result-wrap'));
    row.lastElementChild!.append(this.slotEl(this.menu!.slotIndex('result', 0), 'big'));
    area.append(head, row);
    return area;
  }

  private buildCreative(panel: HTMLElement) {
    const m = this.menu!;
    const tabs = this.el('div', 'ctabs');
    for (const t of TAB_ORDER) {
      const b = this.el('button', `ctab${t === this.tab ? ' on' : ''}`, `<img alt="" src="${itemIcon(itemByName(TAB_ICONS[t])!.id)}"/>`);
      b.title = t === 'search' ? 'Search Items' : t === 'inventory' ? 'Survival Inventory' : CATEGORY_NAMES[t];
      b.addEventListener('click', () => { this.tab = t; this.build(); this.render(); });
      tabs.append(b);
    }
    panel.append(tabs);
    const title = this.tab === 'search' ? 'Search Items' : this.tab === 'inventory' ? 'Survival Inventory' : CATEGORY_NAMES[this.tab];
    panel.append(this.el('div', 'inv-title', esc(title)));

    if (this.tab === 'inventory') {
      const top = this.el('div', 'inv-top');
      this.playerCanvas = document.createElement('canvas');
      this.playerCanvas.className = 'player-preview';
      this.playerCanvas.width = 32;
      this.playerCanvas.height = 64;
      const box = this.el('div', 'player-box');
      box.append(this.playerCanvas);
      const trash = this.el('div', 'trash-wrap', '<span class="inv-label">Destroy Item</span>');
      trash.append(this.slotEl(m.slotIndex('trash', 0), 'trash'));
      top.append(this.grid(1, this.groupEls('armor', 'armor'), 'armor-col'), box, trash);
      panel.append(top);
      panel.append(this.grid(9, this.groupEls('main')));
    } else {
      if (this.tab === 'search') {
        const input = document.createElement('input');
        input.className = 'field csearch';
        input.placeholder = 'Search items…';
        input.spellcheck = false;
        input.value = this.search;
        input.addEventListener('input', () => { this.search = input.value; this.fillPalette(); this.render(); });
        panel.append(input);
        setTimeout(() => input.focus(), 0);
      }
      this.paletteEl = this.el('div', 'sgrid palette');
      this.paletteEl.style.setProperty('--cols', '9');
      panel.append(this.paletteEl);
      this.fillPalette();
    }
    const bottom = this.el('div', 'creative-bottom');
    bottom.append(this.grid(9, this.groupEls('hotbar'), 'hotbar-row'));
    if (this.tab !== 'inventory') bottom.append(this.slotEl(m.slotIndex('trash', 0), 'trash'));
    panel.append(bottom);
  }

  private fillPalette() {
    const el = this.paletteEl;
    if (!el) return;
    let ids: number[];
    if (this.tab === 'search') {
      const q = this.search.trim().toLowerCase();
      ids = TAB_ORDER.filter((t): t is Category => t in CREATIVE_TABS).flatMap((t) => CREATIVE_TABS[t]);
      if (q) ids = ids.filter((id) => ITEMS[id].displayName.toLowerCase().includes(q) || ITEMS[id].name.includes(q.replace(/ /g, '_')));
    } else {
      ids = CREATIVE_TABS[this.tab as Category] ?? [];
    }
    el.innerHTML = ids.map((id) => `<div class="islot pal" data-p="${id}"><img class="icon" alt="" src="${itemIcon(id)}"/></div>`).join('');
    const rows = Math.max(5, Math.ceil(ids.length / 9));
    const pad = rows * 9 - ids.length;
    el.insertAdjacentHTML('beforeend', '<div class="islot pal empty"></div>'.repeat(pad));
  }

  private buildBook(): HTMLElement {
    const m = this.menu!;
    const book = this.el('div', `recipe-book${this.bookOpen ? '' : ' hidden'}`);
    book.append(this.el('div', 'inv-title', 'Recipe Book'));
    const search = document.createElement('input');
    search.className = 'field rb-search';
    search.placeholder = 'Search recipes…';
    search.spellcheck = false;
    search.value = this.bookSearch;
    search.addEventListener('input', () => { this.bookSearch = search.value; this.renderBook(); });
    const toggle = this.el('label', 'rb-toggle', `<input type="checkbox"${this.bookCraftable ? ' checked' : ''}/> Craftable only`);
    toggle.querySelector('input')!.addEventListener('change', (e) => { this.bookCraftable = (e.target as HTMLInputElement).checked; this.renderBook(); });
    const list = this.el('div', 'rb-grid');
    const recipes = RECIPES.filter((r) => recipeFits(r, m.gridW));
    recipes.sort((a, b) => (ITEM_ORDER.get(a.result.id) ?? 9999) - (ITEM_ORDER.get(b.result.id) ?? 9999) || a.id - b.id);
    for (const r of recipes) {
      const e = this.el('div', 'rb-item', `<img alt="" src="${itemIcon(r.result.id)}"/>${r.result.count > 1 ? `<span class="cnt">${r.result.count}</span>` : ''}`);
      e.dataset.r = String(r.id);
      list.append(e);
      this.bookEls.push([r, e]);
    }
    book.append(search, toggle, list);
    return book;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private setIcon(img: HTMLImageElement, id: number | null) {
    const src = id ? itemIcon(id) : '';
    if (img.getAttribute('src') !== src) {
      if (src) img.setAttribute('src', src); else img.removeAttribute('src');
    }
    img.style.visibility = id ? 'visible' : 'hidden';
  }

  private renderStack(el: HTMLElement, s: ItemStack | null) {
    this.setIcon(el.querySelector('img.icon') as HTMLImageElement, s ? s.id : null);
    const cnt = el.querySelector('.cnt') as HTMLElement;
    const t = s && s.count > 1 ? String(s.count) : '';
    if (cnt.textContent !== t) cnt.textContent = t;
    const dur = el.querySelector('.dur') as HTMLElement;
    const d = s && ITEMS[s.id];
    if (d && d.durability > 0 && s!.damage) {
      const f = Math.max(0, 1 - s!.damage / d.durability);
      dur.style.display = 'block';
      const bar = dur.firstElementChild as HTMLElement;
      bar.style.width = `${Math.round(f * 100)}%`;
      bar.style.background = `hsl(${Math.round(f * 120)}, 90%, 50%)`;
    } else dur.style.display = 'none';
  }

  render() {
    const m = this.menu;
    if (!m) return;
    const dragging = this.drag && this.drag.slots.size > 1 ? this.drag.slots : null;
    const t = performance.now() / 1000;
    const ghostCells = this.ghost ? recipeLayout(this.ghost, m.gridW) : null;
    for (const [i, el] of this.slotEls) {
      const slot = m.slots[i];
      this.renderStack(el, slot.get());
      el.classList.toggle('dragged', !!dragging?.has(i));
      el.classList.toggle('hover', i === this.hover);
      // Ghosts: recipe-book preview in the grid, faint armor outlines in empty armor slots.
      const ghost = el.querySelector('img.ghost') as HTMLImageElement;
      let gid: number | null = null;
      if (!slot.get()) {
        if (slot.group === 'grid' && ghostCells?.[slot.index]) {
          const opts = ghostCells[slot.index]!;
          gid = opts[Math.floor(t) % opts.length];
        } else if (slot.group === 'result' && this.ghost) gid = this.ghost.result.id;
        else if (slot.group === 'armor') gid = itemByName(ARMOR_GHOSTS[slot.index])!.id;
      }
      this.setIcon(ghost, gid);
      ghost.classList.toggle('armor-ghost', slot.group === 'armor');
    }
    // Cursor stack
    const c = m.carried;
    if (c) {
      this.cursorEl.style.display = 'block';
      this.cursorEl.innerHTML = `<img alt="" src="${itemIcon(c.id)}"/>${c.count > 1 ? `<span class="cnt">${c.count}</span>` : ''}`;
      this.moveCursor();
    } else this.cursorEl.style.display = 'none';
    if (this.furnaceBars()) { /* updated */ }
    this.renderBook();
    this.renderPlayer();
    this.renderTip();
  }

  private furnaceBars(): boolean {
    const f = this.menu?.furnace;
    if (!f) return false;
    const flame = this.root.querySelector('.flame i') as HTMLElement | null;
    const arrow = this.root.querySelector('.arrow.progress i') as HTMLElement | null;
    if (flame) flame.style.height = `${f.burnMax > 0 ? Math.round((f.burn / f.burnMax) * 100) : 0}%`;
    if (arrow) arrow.style.width = `${f.cookMax > 0 ? Math.round((f.cook / f.cookMax) * 100) : 0}%`;
    return true;
  }

  private renderBook() {
    const m = this.menu;
    if (!m || !this.bookEls.length) return;
    const q = this.bookSearch.trim().toLowerCase();
    for (const [r, el] of this.bookEls) {
      const craftable = m.canCraft(r);
      const name = ITEMS[r.result.id].displayName.toLowerCase();
      const show = (!q || name.includes(q)) && (!this.bookCraftable || craftable);
      el.classList.toggle('hidden', !show);
      el.classList.toggle('craftable', craftable);
      el.classList.toggle('selected', r === this.ghost);
    }
  }

  /** A little figure in the inventory wearing the equipped armor. */
  private renderPlayer() {
    const cv = this.playerCanvas;
    if (!cv || !this.menu) return;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 64);
    const R = (c: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const armor = this.menu.slots.filter((s) => s.group === 'armor').map((s) => s.get());
    const mat = (i: number) => {
      const s = armor[i];
      if (!s) return null;
      const n = ITEMS[s.id].name;
      return n.startsWith('leather') ? ['#8a5230', '#6a3d1c'] : n.startsWith('chainmail') ? ['#8f8f99', '#5c5c66']
        : n.startsWith('iron') ? ['#d6d6d6', '#9a9a9a'] : n.startsWith('golden') ? ['#f2c83a', '#b8870e'] : ['#58e0d2', '#1f9a90'];
    };
    // Base body
    R('#c8906a', 12, 2, 8, 8); R('#6a4228', 12, 2, 8, 2); R('#fff', 13, 6, 2, 1); R('#fff', 17, 6, 2, 1);
    R('#3c5ab4', 14, 6, 1, 1); R('#3c5ab4', 18, 6, 1, 1);
    R('#2f9fa8', 12, 10, 8, 12); R('#c8906a', 8, 10, 4, 12); R('#c8906a', 20, 10, 4, 12);
    R('#2f9fa8', 8, 10, 4, 4); R('#2f9fa8', 20, 10, 4, 4);
    R('#3b3b8f', 12, 22, 4, 12); R('#35357f', 16, 22, 4, 12); R('#555', 12, 32, 8, 2);
    const h = mat(0), c = mat(1), l = mat(2), b = mat(3);
    if (h) { R(h[0], 11, 1, 10, 3); R(h[1], 11, 4, 1, 5); R(h[1], 20, 4, 1, 5); }
    if (c) { R(c[0], 11, 10, 10, 11); R(c[1], 7, 10, 5, 5); R(c[1], 20, 10, 5, 5); R(c[1], 11, 20, 10, 1); }
    if (l) { R(l[0], 12, 21, 8, 3); R(l[1], 12, 24, 3, 7); R(l[1], 17, 24, 3, 7); }
    if (b) { R(b[0], 11, 30, 4, 4); R(b[0], 17, 30, 4, 4); }
  }

  private renderTip() {
    const m = this.menu;
    const tip = this.tipEl;
    let s: ItemStack | null = null;
    let extra = '';
    if (m && !m.carried) {
      if (this.hover >= 0) s = m.slots[this.hover]?.get() ?? null;
      else if (this.hoverPalette) s = { id: this.hoverPalette, count: 1 };
      const rid = (document.elementFromPoint(this.mouse.x, this.mouse.y) as HTMLElement | null)?.closest<HTMLElement>('.rb-item')?.dataset.r;
      if (!s && rid !== undefined) {
        const r = RECIPES[Number(rid)];
        s = r.result;
        const parts = new Map<string, number>();
        for (const ing of recipeIngredients(r)) { const n = ingredientName(ing); parts.set(n, (parts.get(n) ?? 0) + 1); }
        extra = `<div class="tip-sub">${[...parts].map(([n, k]) => `${k}× ${esc(n)}`).join('<br/>')}</div>`
          + (m.canCraft(r) ? '<div class="tip-hint">Click to fill · Shift-click for max</div>' : '<div class="tip-hint bad">Missing ingredients</div>');
      }
    }
    if (!s) { tip.style.display = 'none'; return; }
    tip.innerHTML = tooltipHTML(s) + extra;
    tip.style.display = 'block';
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = this.mouse.x + 14, y = this.mouse.y - 10;
    if (x + w > innerWidth - 4) x = this.mouse.x - w - 14;
    if (y + h > innerHeight - 4) y = innerHeight - h - 4;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  }

  private moveCursor() {
    this.cursorEl.style.left = `${this.mouse.x}px`;
    this.cursorEl.style.top = `${this.mouse.y}px`;
  }

  /** Per-frame refresh while open (furnace progress, animated ghosts). */
  tick() {
    if (!this.menu) return;
    if (this.menu.furnace) this.render();
    else if (this.ghost) this.render();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private slotAt(target: EventTarget | null): number {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('.islot[data-i]');
    return el ? Number(el.dataset.i) : -1;
  }

  private onDown(e: MouseEvent) {
    const m = this.menu;
    if (!m) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, label, button')) return;
    e.preventDefault();
    const rb = t.closest<HTMLElement>('.rb-item');
    if (rb) {
      const r = RECIPES[Number(rb.dataset.r)];
      if (e.button === 0 && m.fillRecipe(r, e.shiftKey)) this.ghost = null;
      else this.ghost = this.ghost === r ? null : r;
      this.render();
      return;
    }
    const pal = t.closest<HTMLElement>('.islot[data-p]');
    if (pal) {
      m.clickPalette(Number(pal.dataset.p), e.button === 2 || e.button === 1 ? 1 : 0, e.shiftKey || e.button === 1);
      this.render();
      return;
    }
    const i = this.slotAt(t);
    if (i < 0) {
      if (!t.closest('.inv-panel, .recipe-book') && m.carried) m.dropCarried(e.button === 0);
      this.render();
      return;
    }
    const slot = m.slots[i];
    if (slot.group === 'grid') this.ghost = null;
    if (e.button === 1) {
      // Middle click: clone a full stack (creative).
      const s = slot.get();
      if (m.kind === 'creative' && s && !m.carried) m.carried = { id: s.id, count: ITEMS[s.id].maxStack };
      this.render();
      return;
    }
    const button = e.button === 2 ? 1 : 0;
    if (e.shiftKey) {
      m.quickMove(i);
      this.render();
      return;
    }
    const now = performance.now();
    if (button === 0 && m.carried && this.lastClick.i === i && now - this.lastClick.t < 300) {
      m.collect();
      this.lastClick.t = 0;
      this.render();
      return;
    }
    if (m.carried && m.canDragInto(i)) {
      this.drag = { button, start: i, slots: new Set([i]) };
      return;
    }
    m.click(i, button);
    this.lastClick = { t: now, i };
    this.render();
  }

  private onMove(e: MouseEvent) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    const m = this.menu;
    if (!m) return;
    const i = this.slotAt(e.target);
    const pal = (e.target as HTMLElement).closest?.<HTMLElement>('.islot[data-p]');
    this.hoverPalette = pal ? Number(pal.dataset.p) : 0;
    if (this.drag && i >= 0 && !this.drag.slots.has(i) && m.canDragInto(i)) {
      const c = m.carried!;
      if (this.drag.button === 1 ? this.drag.slots.size < c.count : this.drag.slots.size < c.count) this.drag.slots.add(i);
    }
    if (i !== this.hover) {
      this.hover = i;
      this.render();
    } else {
      if (m.carried) this.moveCursor();
      this.renderTip();
    }
  }

  private onUp(e: MouseEvent) {
    const m = this.menu;
    const d = this.drag;
    if (!m || !d) return;
    this.drag = null;
    if (d.slots.size > 1) m.distribute([...d.slots], d.button);
    else {
      m.click(d.start, d.button);
      this.lastClick = { t: performance.now(), i: d.start };
    }
    this.render();
    void e;
  }

  private onKey(e: KeyboardEvent) {
    const m = this.menu;
    if (!m || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const h = Number(digit[1]) - 1;
      if (this.hover >= 0) m.swapWithHotbar(this.hover, h);
      else if (this.hoverPalette) m.paletteToHotbar(this.hoverPalette, h);
      this.render();
    } else if (e.code === 'KeyQ' && this.hover >= 0) {
      const s = m.dropFrom(this.hover, e.ctrlKey || e.metaKey);
      if (s) this.host.drop(s);
      this.render();
    }
  }
}

/** Tooltip body for a stack: name (by rarity), durability, food and armor stats. */
export function tooltipHTML(s: ItemStack): string {
  const d = ITEMS[s.id];
  if (!d) return '';
  const lines = [`<div class="tip-name r${d.rarity}">${esc(d.displayName)}</div>`];
  if (d.food) lines.push(`<div class="tip-sub">Restores ${d.food.hunger} hunger</div>`);
  if (d.armor) lines.push(`<div class="tip-stat">+${d.armor.defense} Armor${d.armor.toughness ? `, +${d.armor.toughness} Toughness` : ''}</div>`);
  if (d.tool && d.tool.type !== 'shears' && d.tool.type !== 'hoe') {
    lines.push(`<div class="tip-sub">${d.tool.type === 'sword' ? 'Cuts webs and plants' : `Mining speed ×${d.tool.speed}`}</div>`);
  }
  if (d.durability > 0) lines.push(`<div class="tip-sub">Durability: ${d.durability - (s.damage ?? 0)} / ${d.durability}</div>`);
  return lines.join('');
}
