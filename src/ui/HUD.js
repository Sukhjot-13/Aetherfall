/**
 * HUD controller: vitals, spellbar, objective card, region/clock, shard count,
 * boss bar, form timer, interaction prompt and damage feedback.
 */

import * as THREE from 'three';
import { SPELLS, SPELL_ORDER } from '../gameplay/spellData.js';
import { spellStatus } from '../gameplay/powerState.js';
import { formatClock } from '../util/math.js';

export class HUD {
  /** @param {Document} [doc] */
  constructor(doc = document) {
    this.doc = doc;
    this.root = doc.getElementById('hud');
    this.els = {
      healthFill: doc.getElementById('health-fill'),
      healthValue: doc.getElementById('health-value'),
      manaFill: doc.getElementById('mana-fill'),
      manaValue: doc.getElementById('mana-value'),
      staminaFill: doc.getElementById('stamina-fill'),
      staminaValue: doc.getElementById('stamina-value'),
      region: doc.getElementById('region'),
      clock: doc.getElementById('clock'),
      objective: doc.getElementById('objective'),
      objectiveTitle: doc.getElementById('objective-title'),
      objectiveHint: doc.getElementById('objective-hint'),
      objectiveProgress: doc.getElementById('objective-progress'),
      shardCount: doc.getElementById('shard-count'),
      shardCounter: doc.getElementById('shard-counter'),
      crosshair: doc.getElementById('crosshair'),
      aimLock: doc.getElementById('aim-lock'),
      interact: doc.getElementById('interact'),
      interactText: doc.getElementById('interact-text'),
      spellbar: doc.getElementById('spellbar'),
      formBanner: doc.getElementById('form-banner'),
      formFill: doc.getElementById('form-fill'),
      formTimer: doc.getElementById('form-timer'),
      bossBar: doc.getElementById('boss-bar'),
      bossName: doc.getElementById('boss-name'),
      bossFill: doc.getElementById('boss-fill'),
      bossPhase: doc.getElementById('boss-phase'),
      bossPips: doc.getElementById('boss-pips'),
      bossPhaseName: doc.getElementById('boss-phase-name'),
      bossCard: doc.getElementById('boss-card'),
      bossCardKicker: doc.getElementById('boss-card-kicker'),
      bossCardName: doc.getElementById('boss-card-name'),
      bossCardTitle: doc.getElementById('boss-card-title'),
      fps: doc.getElementById('fps'),
      damageFlash: doc.getElementById('damage-flash'),
      shardGem: doc.querySelector('.shard-gem'),
      masterBadge: doc.getElementById('master-badge'),
    };

    this.spellEls = new Map();
    this._lockPoint = new THREE.Vector3();
    this._last = {};
    this._bossCardTimer = null;
    this._buildSpellbar();
  }

  /** Create one spell slot per spell in hotbar order. */
  _buildSpellbar() {
    if (!this.els.spellbar) return;
    this.els.spellbar.innerHTML = '';
    for (const id of SPELL_ORDER) {
      const spell = SPELLS[id];
      const el = this.doc.createElement('div');
      el.className = 'spell locked';
      el.dataset.spell = id;
      el.style.setProperty('--spell-color', spell.color);
      el.innerHTML = `
        <span class="spell-key">${spell.key}</span>
        <span class="spell-icon">${spell.icon}</span>
        <span class="spell-name">${spell.name}</span>
        <span class="spell-lock">✦</span>
        <span class="spell-cd"></span>
        <span class="spell-cd-text"></span>
      `;
      this.els.spellbar.appendChild(el);
      this.spellEls.set(id, {
        el,
        cd: el.querySelector('.spell-cd'),
        cdText: el.querySelector('.spell-cd-text'),
        lock: el.querySelector('.spell-lock'),
        state: '',
      });
    }
  }

  /** Show the HUD. */
  show() {
    this.els.shardCounter?.classList.remove('hidden');
    this.root?.classList.remove('hidden');
  }

  /** Hide the HUD. */
  hide() {
    this.root?.classList.add('hidden');
  }

  /** Toggle the first-person crosshair. */
  setCrosshair(visible) {
    this.els.crosshair?.classList.toggle('hidden', !visible);
  }

  /**
   * Project the soft-aim lock onto the screen and draw a bracket around it.
   * Passing a null/dead target hides the bracket.
   */
  updateAimLock(target, camera) {
    const el = this.els.aimLock;
    if (!el) return;
    if (!target || target.alive === false || !target.position || !camera) {
      el.classList.add('hidden');
      return;
    }
    this._lockPoint.set(
      target.position.x,
      target.position.y + (target.hitHeight ?? 1.1) * 0.7,
      target.position.z,
    );
    this._lockPoint.project(camera);
    const p = this._lockPoint;
    if (p.z > 1 || p.x < -1.08 || p.x > 1.08 || p.y < -1.08 || p.y > 1.08) {
      el.classList.add('hidden');
      return;
    }
    el.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
    el.classList.remove('hidden');
  }

  /** Show/hide the master-mode badge and its flight hint. */
  setMaster(on, flying = false) {
    const el = this.els.masterBadge;
    if (!el) return;
    el.classList.toggle('hidden', !on);
    el.classList.toggle('flying', Boolean(on && flying));
    const label = el.querySelector('.master-flight');
    if (label) label.textContent = flying ? 'FLYING' : 'F fly';
  }

  /** Quick crosshair kick when a spell leaves the staff. */
  pulseCast() {
    const el = this.els.crosshair;
    if (!el) return;
    el.classList.remove('cast');
    void el.offsetWidth;
    el.classList.add('cast');
  }

  /** Crosshair hit marker. */
  flashHit() {
    const el = this.els.crosshair;
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  /** Write text only when it changed (avoids needless layout). */
  _text(el, value) {
    if (!el) return;
    if (el.textContent !== value) el.textContent = value;
  }

  /** Scale a bar fill horizontally. */
  _bar(el, ratio) {
    if (!el) return;
    el.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
  }

  /**
   * Per-frame HUD refresh.
   * @param {object} state
   */
  update(state) {
    const { powers, quest, region, clock, fps, formActive, formRemaining, formDuration, boss, interact } = state;

    if (powers) {
      this._bar(this.els.healthFill, powers.health / powers.maxHealth);
      this._bar(this.els.manaFill, powers.mana / powers.maxMana);
      this._bar(this.els.staminaFill, powers.stamina / powers.maxStamina);
      this._text(this.els.healthValue, String(Math.ceil(powers.health)));
      this._text(this.els.manaValue, String(Math.floor(powers.mana)));
      this._text(this.els.staminaValue, String(Math.floor(powers.stamina)));
    }

    if (region && region !== this._last.region) {
      this._text(this.els.region, region);
      this._last.region = region;
    }
    if (clock !== undefined) this._text(this.els.clock, formatClock(clock));

    if (quest) {
      const objective = state.objective ?? null;
      if (objective) {
        if (objective.title !== this._last.objectiveTitle) {
          this._text(this.els.objectiveTitle, objective.title);
          this._text(this.els.objectiveHint, objective.hint);
          this._last.objectiveTitle = objective.title;
          this._pulseObjective();
        }
        this._text(this.els.objectiveHint, objective.hint);
        this._text(this.els.objectiveProgress, objective.progress ?? '');
      }
      const count = quest.shards.length;
      this._text(this.els.shardCount, String(count));
      if (count !== this._last.shardCount) {
        if (count > (this._last.shardCount ?? 0)) {
          this.els.shardGem?.animate(
            [{ transform: 'scale(1)' }, { transform: 'scale(2.1)' }, { transform: 'scale(1)' }],
            { duration: 700, easing: 'ease-out' },
          );
        }
        this._last.shardCount = count;
      }
    }

    this._updateSpells(powers);

    if (formActive) {
      this.els.formBanner?.classList.remove('hidden');
      const ratio = formDuration > 0 ? formRemaining / formDuration : 0;
      this._bar(this.els.formFill, ratio);
      this._text(this.els.formTimer, formRemaining.toFixed(1));
      this.doc.body.classList.add('in-form');
    } else {
      this.els.formBanner?.classList.add('hidden');
      this.doc.body.classList.remove('in-form');
    }

    const isFinalBoss = Boolean(boss?.phase);
    this.doc.body.classList.toggle('boss-fight', isFinalBoss);
    if (boss) {
      this.els.bossBar?.classList.remove('hidden');
      this.els.bossBar?.classList.toggle('final-boss', isFinalBoss);
      this.els.bossBar?.classList.toggle('enraged', Boolean(boss.enraged));
      this._text(this.els.bossName, boss.name);
      this._bar(this.els.bossFill, boss.health / boss.maxHealth);
      this.els.bossPhase?.classList.toggle('hidden', !isFinalBoss);
      this.els.bossPips?.classList.toggle('hidden', !isFinalBoss);
      this.els.bossPhaseName?.classList.toggle('hidden', !isFinalBoss);
      if (isFinalBoss) {
        const count = boss.phaseCount ?? 3;
        this._text(this.els.bossPhase, `Phase ${boss.phase} / ${count}`);
        this._text(this.els.bossPhaseName, boss.phaseName ?? '');
        this._setBossPips(boss.phase, count);
      }
    } else {
      this.els.bossBar?.classList.add('hidden');
    }

    if (interact) {
      this.els.interact?.classList.remove('hidden');
      this._text(this.els.interactText, interact);
    } else {
      this.els.interact?.classList.add('hidden');
    }

    if (fps !== undefined) {
      this.els.fps?.classList.toggle('hidden', !state.showFps);
      if (state.showFps) this._text(this.els.fps, `${Math.round(fps)} fps`);
    }
  }

  /** Refresh cooldown/ready visuals for each slot. */
  _updateSpells(powers) {
    if (!powers) return;
    for (const id of SPELL_ORDER) {
      const entry = this.spellEls.get(id);
      if (!entry) continue;
      const spell = SPELLS[id];
      const status = spellStatus(powers, id);
      let state = 'locked';
      if (status.unlocked) state = status.cooldown > 0 ? 'cooling' : status.affordable ? 'ready' : 'dry';

      if (entry.state !== state) {
        entry.el.classList.toggle('locked', state === 'locked');
        entry.el.classList.toggle('ready', state === 'ready');
        entry.el.classList.toggle('dry', state === 'dry');
        entry.el.classList.toggle('cooling', state === 'cooling');
        entry.lock.style.opacity = state === 'locked' ? '0.9' : '0';
        entry.state = state;
      }

      if (status.unlocked && status.cooldown > 0) {
        const pct = (status.cooldown / spell.cooldown) * 100;
        entry.cd.style.setProperty('--cd', `${Math.min(100, pct)}%`);
        this._text(entry.cdText, status.cooldown.toFixed(1));
      } else if (entry.cdText.textContent) {
        this._text(entry.cdText, '');
        entry.cd.style.setProperty('--cd', '0%');
      }
    }
  }

  /** Flash a spell slot when it is cast. */
  flashSpell(id) {
    const entry = this.spellEls.get(id);
    if (!entry) return;
    entry.el.classList.add('casting');
    setTimeout(() => entry.el.classList.remove('casting'), 180);
  }

  /** Highlight newly unlocked spells. */
  markNew(ids) {
    for (const id of ids) {
      const entry = this.spellEls.get(id);
      if (!entry) continue;
      entry.el.classList.remove('new');
      void entry.el.offsetWidth;
      entry.el.classList.add('new');
    }
  }

  /** Light the phase pips for the final boss. */
  _setBossPips(phase, count) {
    const pips = this.els.bossPips;
    if (!pips) return;
    while (pips.children.length < count) {
      const pip = this.doc.createElement('span');
      pip.className = 'boss-pip';
      pips.appendChild(pip);
    }
    while (pips.children.length > count) pips.lastElementChild?.remove();
    [...pips.children].forEach((pip, index) => {
      const step = index + 1;
      pip.classList.toggle('lit', step <= phase);
      pip.classList.toggle('current', step === phase);
    });
  }

  /**
   * Big centred name card for the boss intro and phase breaks.
   * @param {{kicker?:string, name:string, title?:string}} data
   * @param {number} [duration]
   */
  showBossCard({ kicker = '', name = '', title = '' } = {}, duration = 3200) {
    const card = this.els.bossCard;
    if (!card) return;
    this._text(this.els.bossCardKicker, kicker);
    this._text(this.els.bossCardName, name);
    this._text(this.els.bossCardTitle, title);
    card.classList.remove('hidden', 'show');
    void card.offsetWidth;
    card.classList.add('show');
    if (this._bossCardTimer) clearTimeout(this._bossCardTimer);
    this._bossCardTimer = setTimeout(() => {
      card.classList.add('hidden');
      card.classList.remove('show');
      this._bossCardTimer = null;
    }, duration);
  }

  /** Remove the boss name card immediately. */
  hideBossCard() {
    if (this._bossCardTimer) clearTimeout(this._bossCardTimer);
    this._bossCardTimer = null;
    this.els.bossCard?.classList.add('hidden');
    this.els.bossCard?.classList.remove('show');
  }

  /** Pulse the objective card. */
  _pulseObjective() {
    const el = this.els.objective;
    if (!el) return;
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  /** Red edge flash when the player is hit. */
  flashDamage() {
    const el = this.els.damageFlash;
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  /** Toggle cinematic letterboxing. */
  setCinematic(active) {
    this.doc.body.classList.toggle('cinematic', Boolean(active));
  }
}
