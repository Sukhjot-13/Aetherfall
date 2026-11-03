/**
 * Entry point. Boots the game and surfaces fatal errors on the loading screen
 * instead of leaving the player staring at a blank canvas.
 */

import { Game } from './core/Game.js';
import './style.css';

const canvas = document.getElementById('scene');
const game = new Game({ canvas });

// Handy for debugging from the console.
window.aetherfall = game;

game.boot().catch((error) => {
  console.error('[Aetherfall] failed to start', error);
  const loading = document.getElementById('loading');
  const text = document.getElementById('loading-text');
  const fill = document.getElementById('loading-fill');
  loading?.classList.remove('hidden');
  if (fill) fill.style.width = '100%';
  if (fill) fill.style.background = '#ff6b5e';
  if (text) {
    text.textContent = `The isle failed to form: ${error?.message ?? error}`;
    text.style.color = '#ff9a8a';
  }
});
