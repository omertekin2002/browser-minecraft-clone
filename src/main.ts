import './styles.css';
import { Game } from './game/Game';

function showError(msg: string) {
  const el = document.getElementById('error')!;
  el.textContent = msg;
  el.classList.remove('hidden');
}

window.addEventListener('error', (e) => {
  if (e.message && /WebGL|Shader|Program|EXT_/.test(e.message)) showError(e.message);
});

try {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  new Game(canvas);
} catch (e) {
  console.error(e);
  showError(`Voxelcraft could not start.\n\n${(e as Error).message}\n\nA browser with WebGL2 and float render targets is required (recent Chrome, Edge, Firefox or Safari).`);
}
