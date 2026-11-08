/**
 * Story content and dialogue scripts. Original setting, no external IP.
 * Data only; the UI renders these lines with a typewriter effect.
 */

export const SPEAKERS = Object.freeze({
  wisp: { id: 'wisp', name: 'Wisp', color: '#8ef2e0' },
  sable: { id: 'sable', name: 'Sable', color: '#ffcf8a' },
  player: { id: 'player', name: 'Wayfarer', color: '#d9e6ff' },
  beacon: { id: 'beacon', name: 'The Beacon', color: '#ffe9a8' },
  sovereign: { id: 'sovereign', name: 'Vaelor', color: '#c6a8ff' },
});

/** @typedef {{speaker:string, text:string}} Line */

const ALTAR_LINES = Object.freeze([
  { speaker: 'wisp', text: 'Place them. It has been dark for so long.' },
  { speaker: 'sable', text: 'Whatever happens next — do not let go.' },
  { speaker: 'beacon', text: 'THE LIGHT REMEMBERS.' },
]);

/** @type {Record<string, Line[]>} */
export const DIALOGUES = Object.freeze({
  intro: Object.freeze([
    { speaker: 'wisp', text: 'You are awake. Good. I was beginning to think the sea had taken you.' },
    { speaker: 'wisp', text: 'This is Aetherfall. It used to glow so brightly that sailors called it the Lantern of the West.' },
    { speaker: 'wisp', text: 'Then the Beacon went dark. The Veil came crawling down out of the mountains, and the light went out of the world.' },
    { speaker: 'wisp', text: 'You carry a spark of the old light. I can feel it from here. Perhaps that is why the tide spared you.' },
    { speaker: 'wisp', text: 'Find Sable at Emberfall Camp, east along the shore. She is the last Keeper. She will know what to do.' },
  ]),
  sableIntro: Object.freeze([
    { speaker: 'sable', text: 'Well. The wisp chose a drowned rat.' },
    { speaker: 'sable', text: 'I am Sable. Last Keeper of the Beacon, though there is precious little left to keep.' },
    { speaker: 'sable', text: 'The Beacon was fed by three Aether Shards. When it failed, the shards scattered. The Veil took root around each one.' },
    { speaker: 'sable', text: 'Wardens guard them now. Creatures of smoke and old grief. You will need magic to put them down.' },
    { speaker: 'sable', text: 'Your spark is Ember. Crude, but it burns. Take the shards, and the light will teach you more.' },
    { speaker: 'sable', text: 'Whisperwood Grove to the west. Tidewreck Ruins along the eastern cliffs. Stormpeak, high in the north. Go.' },
    { speaker: 'sable', text: 'One more thing, before you wander off: prove you can carry the light, not just hold it. Fell three Veil beasts — call it the Trial of Embers. The Beacon remembers those who bled for it.' },
    { speaker: 'sable', text: 'And the wisp will tell you about the old Lantern Way. It is older than the Beacon and kinder than I am, so listen to it.' },
  ]),
  sableHint: Object.freeze([
    { speaker: 'sable', text: 'The shards will not come to you. Cut down the Warden, then claim what it guarded.' },
    { speaker: 'sable', text: 'Mind your mana. Aether is a river, not a well. Let it refill.' },
    { speaker: 'sable', text: 'If the Veil takes you, you will wake here. I will not carry you twice.' },
  ]),
  wispHint: Object.freeze([
    { speaker: 'wisp', text: 'The Wardens are old grief given teeth. Strike, then step away before they answer.' },
    { speaker: 'wisp', text: 'Motes of aether drift all over the isle. Let them fill you.' },
    { speaker: 'wisp', text: 'The shards sing louder the closer you get. Follow the light.' },
  ]),
  lanternWay: Object.freeze([
    { speaker: 'wisp', text: 'Old sailing lanterns lit the Lantern Way before the Beacon did. Their keepers are all ash now, but the light remembers the road.' },
    { speaker: 'wisp', text: 'Walk it with me, Wayfarer. If we wake eight of the old lanterns together, it will widen your lungs and steady your step.' },
  ]),
  lanternDone: Object.freeze([
    { speaker: 'wisp', text: 'Eight lanterns. The Lantern Way is awake again — do you feel it? Your breath comes easier. The road feels shorter.' },
  ]),
  sableFree: Object.freeze([
    { speaker: 'sable', text: 'The Beacon is burning and I am still here. I suppose that makes you the Keeper now.' },
    { speaker: 'sable', text: 'Go on. The isle is yours to wander. I will keep the fire.' },
  ]),
  beaconRest: Object.freeze([
    { speaker: 'beacon', text: 'THE LIGHT REMEMBERS. AND IT WILL REMEMBER YOU.' },
    { speaker: 'wisp', text: 'Every ship in the western sea just found its way home.' },
  ]),
  sableTrialPending: Object.freeze([
    { speaker: 'sable', text: 'The three shards are safe, but the Trial of Embers is not finished. Veil creatures are gathering outside camp. Finish the trial first.' },
  ]),
  sableReady: Object.freeze([
    { speaker: 'sable', text: 'The trials are done. Take the shards north to the Beacon, and be ready for whatever answers.' },
  ]),
  wispTrialPending: Object.freeze([
    { speaker: 'wisp', text: 'All three shards. First, finish the Trial of Embers against the Veil outside camp; then the Turning Veil will open.' },
  ]),
  wispReady: Object.freeze([
    { speaker: 'wisp', text: 'The trials are complete. The Beacon is waiting in the ring of stones to the north.' },
  ]),
  sableReturn: Object.freeze([
    { speaker: 'sable', text: 'All three. I can feel the Beacon stirring from here.' },
    { speaker: 'sable', text: 'Before you touch the altar, the Turning Veil still wants a fight. Fell five more Veil beasts on your way north. I am not particular about the manner.' },
    { speaker: 'sable', text: 'Go north, to the ring of stones. Place them, and do not let go.' },
  ]),
  grove: Object.freeze([
    { speaker: 'wisp', text: 'Frost. The shard remembers the first winter.' },
    { speaker: 'wisp', text: 'You can feel it in your hands now. And the sky will catch you when you leap.' },
  ]),
  ruins: Object.freeze([
    { speaker: 'wisp', text: 'Wind and storm. This one remembers the ships that never came home.' },
    { speaker: 'wisp', text: 'Run with the gale. Call the lightning. They are yours now.' },
  ]),
  peak: Object.freeze([
    { speaker: 'wisp', text: 'Aether. The last shard remembers the light itself.' },
    { speaker: 'wisp', text: 'Guard yourself. And when you are ready... burn.' },
  ]),
  allShards: Object.freeze([
    { speaker: 'wisp', text: 'That is all three. The Beacon is waiting. I can hear it humming.' },
    { speaker: 'wisp', text: 'The Turning Veil still waits between us and the stones. Let the old beasts spend themselves first.' },
    { speaker: 'wisp', text: 'North, Wayfarer. To the ring of stones.' },
  ]),
  altar: ALTAR_LINES,
  sovereignIntro: Object.freeze([
    ...ALTAR_LINES,
    { speaker: 'sovereign', text: 'And yet it forgets its keeper.' },
    { speaker: 'wisp', text: 'No. Not you. Not after all this time.' },
    { speaker: 'sovereign', text: 'Three little fires, carried across my isle by a drowned stranger. Did you think that made you a Keeper?' },
    { speaker: 'sovereign', text: 'I am Vaelor, the Veil Sovereign. I held the dark so this island would have something to fear. Put the shards down, and I will make your ending gentle.' },
    { speaker: 'player', text: 'The Beacon is not yours.' },
    { speaker: 'sovereign', text: 'Then come and take it.' },
  ]),
  sovereignVictory: Object.freeze([
    { speaker: 'sovereign', text: 'The light… was never mine to hold. I only… kept it company in the dark.' },
    { speaker: 'wisp', text: 'It is done. The Veil is breaking.' },
    { speaker: 'sable', text: 'You actually did it. I owe the wisp an apology.' },
    { speaker: 'beacon', text: 'THE LIGHT REMEMBERS. AND IT WILL REMEMBER YOU.' },
  ]),
  freeRoam: Object.freeze([
    { speaker: 'wisp', text: 'The Veil is thinning. The island is breathing again.' },
    { speaker: 'wisp', text: 'There are still corners of Aetherfall we have never seen. Shall we?' },
  ]),
});

/** Lines shown on the ending card, after the beacon is restored. */
export const ENDING_LINES = Object.freeze([
  'Vaelor came apart like a held breath, and the Veil broke with him.',
  'The Beacon woke, and Aetherfall burned gold again — a lantern for every lost ship in the western sea.',
  'Sable said the island would need a new Keeper.',
  'The wisp said it already had one.',
]);

/** Death card copy. */
export const DEATH_TEXT = Object.freeze({
  title: 'The Veil Takes You',
  body: 'You wake at Emberfall Camp, aching but alive.',
});

/** Shard dialogue lookup. */
export function dialogueForShard(shardId) {
  return DIALOGUES[shardId] ?? DIALOGUES.grove;
}

/** Build the ending stat rows. */
export function buildEndingStats({ playSeconds = 0, kills = 0, deaths = 0 } = {}) {
  const mins = Math.floor(playSeconds / 60);
  const secs = Math.floor(playSeconds % 60);
  return [
    ['Time on the isle', `${mins}:${String(secs).padStart(2, '0')}`],
    ['Veil creatures felled', String(kills)],
    ['Times reclaimed by the Veil', String(deaths)],
  ];
}
