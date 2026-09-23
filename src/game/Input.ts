/** Keyboard / mouse state with per-frame edge detection and pointer lock. */
export class Input {
  readonly keys = new Set<string>();
  readonly pressed = new Set<string>();
  readonly buttons = new Set<number>();
  readonly clicked = new Set<number>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;
  /** When false, game keys are ignored (menus open). */
  enabled = true;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'F3' || e.code === 'F1' || e.code === 'F2' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.buttons.clear();
        this.keys.clear();
      }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    const c = this.canvas as unknown as { requestPointerLock: (o?: object) => Promise<void> | void };
    const attempt = (opts?: object): Promise<void> => {
      try {
        const r = opts ? c.requestPointerLock(opts) : c.requestPointerLock();
        return r && typeof (r as Promise<void>).then === 'function' ? (r as Promise<void>) : Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    };
    // Raw (unaccelerated) mouse input where supported, plain pointer lock otherwise.
    attempt({ unadjustedMovement: true }).catch((e: { name?: string }) => {
      if (e && e.name === 'NotSupportedError') attempt().catch(() => { /* refused: the game falls back to pause */ });
    });
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.enabled && this.keys.has(code);
  }

  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pressed.clear();
    this.clicked.clear();
  }
}
