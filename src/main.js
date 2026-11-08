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

// Headless screenshot mode: ?shot=title|spawn|forest|hero|frontier
const shot = new URLSearchParams(location.search).get('shot');
if (shot) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      try {
        const g = window.aetherfall;
        if (!g?.state) { document.title = 'SHOT:not-ready'; return; }
        if (shot === 'title') {
          document.title = `SHOT:title-ready:${g.state}`;
        } else {
          // Jump straight into gameplay for framing.
          g._startNewGame?.();
          if (shot === 'spawn') {
            g.player?.teleport?.(58, 0, 430, 0.6);
            g.cameraRig?.snap?.();
          } else if (shot === 'forest') {
            g.player?.teleport?.(-240, 0, 110, -0.4);
            g.cameraRig?.snap?.();
          } else if (shot === 'hero') {
            g.player?.teleport?.(58, 0, 430, 3.1);
            g.cameraRig?.setMode?.('third');
            g.cameraRig?.snap?.();
          } else if (shot === 'frontier') {
            g.player?.teleport?.(-940, 0, -620, 0.8);
            g.cameraRig?.snap?.();
          }
          document.title = `SHOT:${shot}-ready:${g.state}`;
        }
      } catch (e) {
        document.title = `SHOT:error:${e.message}`;
      }
    }, 4500);
  });
}

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
