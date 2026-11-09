import { decodeCharacterPng } from '../../../core/src/assets/pngDecoder.js';
import type { CharacterDirectionSprites } from '../../../core/src/assets/types.js';
import type { AgentStateStore } from '../agentStateStore.js';
import type { AgentState } from '../types.js';
import type { FigureLayers } from './compose.js';
import { composeFigure, loadFigureLayers } from './compose.js';

/**
 * Each named agent's own figure (compose.ts), cached per seed. A surface
 * enables figures by pointing at its assets root; without that (or without
 * the layer files) no figure is ever sent and agents keep the shared palette
 * characters.
 */
let layers: FigureLayers | null = null;
const cache = new Map<string, CharacterDirectionSprites>();

export function configureFigures(assetsRoot: string): void {
  try {
    layers = loadFigureLayers(assetsRoot);
    cache.clear();
    if (!layers) console.log('[Figures] No figure layers under', assetsRoot);
  } catch (err) {
    layers = null;
    console.warn('[Figures] Could not load figure layers:', err);
  }
}

export function figureSprites(seed: string): CharacterDirectionSprites | null {
  if (!layers) return null;
  let sprites = cache.get(seed);
  if (!sprites) {
    sprites = decodeCharacterPng(composeFigure(layers, seed));
    cache.set(seed, sprites);
  }
  return sprites;
}

/**
 * Lock a figure the first time an agent is seen with a name: the name becomes
 * its seed for good (a later rename keeps the figure). Returns true when a
 * seed was minted, so the caller persists. Broadcasts the figure either way
 * when one was minted.
 */
export function mintFigure(store: AgentStateStore, id: number, agent: AgentState): boolean {
  if (agent.figureSeed || !agent.sessionName || !layers) return false;
  agent.figureSeed = agent.sessionName;
  const sprites = figureSprites(agent.figureSeed);
  if (sprites) store.broadcast({ type: 'agentFigure', id, seed: agent.figureSeed, sprites });
  return true;
}
