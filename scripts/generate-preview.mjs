// Dev-only: renders an INTERACTIVE standalone preview of the board using the
// REAL stylesheets (whose source selectors are plain class names) and a port of
// Tile.tsx's SVG. The bottom hand has working drag-to-reorder + sort, and the
// centre has the wall ring with a Draw button, all ported to vanilla JS, so the
// board can be tried by just opening the file. Not part of the app build.
// Run with: npm run preview:static

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = [
  'src/styles/global.css',
  'src/components/Board.module.css',
  'src/components/PlayerHand.module.css',
  'src/components/Wall.module.css',
  'src/App.module.css',
].map((p) => readFileSync(join(root, p), 'utf8')).join('\n');

const COL = {
  faceFill: '#F7F4EA', faceEdge: '#CFC8B4', faceInner: '#E7E1D0', ink: '#2A2A22', corner: '#6B6657',
  red: '#C2362B', green: '#2E7D32', greenDk: '#1B5E20', blue: '#225E9B', navy: '#1F3A5F',
  purple: '#6E4FA3', amber: '#BD8A18', back: '#1F6F5C', backEdge: '#15523F', backMotif: '#52A98F',
};
const CJK = "'Noto Serif SC','Songti SC','SimSun','STSong',serif";
const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const LAYOUTS = {
  1: [[27,37]], 2: [[27,21],[27,53]], 3: [[14,18],[27,37],[40,56]],
  4: [[16,21],[38,21],[16,53],[38,53]], 5: [[16,21],[38,21],[27,37],[16,53],[38,53]],
  6: [[16,19],[38,19],[16,37],[38,37],[16,55],[38,55]],
  7: [[14,16],[27,16],[40,16],[16,40],[38,40],[16,57],[38,57]],
  8: [[16,15],[16,30],[16,44],[16,59],[38,15],[38,30],[38,44],[38,59]],
  9: [[14,18],[27,18],[40,18],[14,37],[27,37],[40,37],[14,56],[27,56],[40,56]],
};
const g = (ch, x, y, s, f) => `<text x="${x}" y="${y}" font-family="${CJK}" font-size="${s}" fill="${f}" font-weight="500" text-anchor="middle" dominant-baseline="central">${ch}</text>`;
const corner = (t) => `<text x="9" y="12" font-family="sans-serif" font-size="11" font-weight="500" fill="${COL.corner}" text-anchor="middle" dominant-baseline="central">${t}</text>`;
const pip = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="4.9" fill="${COL.blue}"/><circle cx="${cx}" cy="${cy}" r="2.8" fill="${COL.faceFill}"/><circle cx="${cx}" cy="${cy}" r="1.4" fill="${COL.red}"/>`;
const stick = (cx, cy, c) => `<rect x="${cx-2.8}" y="${cy-8}" width="5.6" height="16" rx="2.8" fill="${c}"/><line x1="${cx-2.8}" y1="${cy-2.5}" x2="${cx+2.8}" y2="${cy-2.5}" stroke="${COL.greenDk}" stroke-width="0.9"/><line x1="${cx-2.8}" y1="${cy+2.5}" x2="${cx+2.8}" y2="${cy+2.5}" stroke="${COL.greenDk}" stroke-width="0.9"/>`;
const bird = () => `<ellipse cx="27" cy="42" rx="11" ry="8" fill="${COL.green}"/><circle cx="34" cy="31" r="6" fill="${COL.green}"/><path d="M39 30 L46 28 L40 34 Z" fill="${COL.amber}"/><circle cx="35.5" cy="30" r="1.4" fill="${COL.ink}"/><path d="M16 40 Q9 36 8 47 Q15 46 19 44 Z" fill="${COL.red}"/>`;
const badge = (n, c) => `<circle cx="12" cy="13" r="7" fill="${c}"/><text x="12" y="13" font-family="sans-serif" font-size="9" fill="#fff" font-weight="500" text-anchor="middle" dominant-baseline="central">${n}</text>`;
const WINDS = { east:['東','E'], south:['南','S'], west:['西','W'], north:['北','N'] };
const FLOWER = { plum:['梅',COL.red,1], orchid:['蘭',COL.purple,2], chrysanthemum:['菊',COL.amber,3], bamboo:['竹',COL.green,4] };
const SEASON = { spring:['春',COL.green,1], summer:['夏',COL.red,2], autumn:['秋',COL.amber,3], winter:['冬',COL.blue,4] };

function face(t) {
  if (t.category === 'suited') {
    if (t.suit === 'characters') return corner(String(t.value)) + g(NUM[t.value],27,28,22,COL.ink) + g('萬',27,56,21,COL.red);
    if (t.suit === 'circles') return LAYOUTS[t.value].map(([x,y]) => pip(x,y)).join('');
    if (t.value === 1) return bird();
    return LAYOUTS[t.value].map(([x,y]) => stick(x,y,(x===27&&[5,7,9].includes(t.value))?COL.red:COL.green)).join('');
  }
  if (t.category === 'wind') { const [ch,l]=WINDS[t.wind]; return corner(l)+g(ch,28,40,29,COL.navy); }
  if (t.category === 'dragon') {
    if (t.dragon==='red') return g('中',27,38,30,COL.red);
    if (t.dragon==='green') return g('發',27,38,28,COL.green);
    return `<rect x="13" y="15" width="28" height="44" rx="3" fill="none" stroke="${COL.blue}" stroke-width="1.6"/><rect x="16.5" y="18.5" width="21" height="37" rx="2" fill="none" stroke="${COL.blue}" stroke-width="0.8"/>`;
  }
  const m = t.category === 'flower' ? FLOWER[t.flower] : SEASON[t.season];
  return badge(m[2], m[1]) + g(m[0], 28, 41, 26, m[1]);
}
function tile(t, size = 40, faceDown = false) {
  const w = (size*54)/74;
  const body = faceDown
    ? `<rect x="1.5" y="1.5" width="51" height="71" rx="7" fill="${COL.back}" stroke="${COL.backEdge}" stroke-width="1.5"/><rect x="14" y="24" width="26" height="26" rx="4" fill="none" stroke="${COL.backMotif}" stroke-width="1.5" transform="rotate(45 27 37)"/>`
    : `<rect x="1.5" y="1.5" width="51" height="71" rx="7" fill="${COL.faceFill}" stroke="${COL.faceEdge}" stroke-width="1.5"/><rect x="5" y="5" width="44" height="64" rx="5" fill="none" stroke="${COL.faceInner}" stroke-width="1"/>${face(t)}`;
  return `<svg viewBox="0 0 54 74" width="${w}" height="${size}">${body}</svg>`;
}

const s = (suit, value) => ({ category:'suited', suit, value });
const w = (wind) => ({ category:'wind', wind });
const d = (dragon) => ({ category:'dragon', dragon });
const fl = (flower) => ({ category:'flower', flower });
const se = (season) => ({ category:'season', season });

const SUIT_ORDER = { bamboo:0, characters:1, circles:2 };
const WIND_ORDER = { east:0, south:1, west:2, north:3 };
const DRAGON_ORDER = { red:0, green:1, white:2 };
function sortVal(t) {
  if (t.category === 'suited') return 0 * 10000 + SUIT_ORDER[t.suit] * 100 + t.value;
  if (t.category === 'wind') return 1 * 10000 + WIND_ORDER[t.wind] * 100;
  if (t.category === 'dragon') return 2 * 10000 + DRAGON_ORDER[t.dragon] * 100;
  return 3 * 10000;
}

const players = [
  { name:'You (East)', wind:'E', score:38, current:true,
    hand:[s('bamboo',2),s('bamboo',3),s('bamboo',4),s('characters',5),s('characters',5),s('circles',2),s('circles',3),s('circles',4),w('east'),w('east'),d('red')],
    melds:[[s('circles',7),s('circles',7),s('circles',7)]], bonus:[fl('plum')] },
  { name:'Robot South', wind:'S', score:12, current:false,
    hand:[s('characters',1),s('characters',1),s('characters',1),s('circles',6),s('circles',6),s('bamboo',7),s('bamboo',8),s('bamboo',9),d('green'),d('green')],
    melds:[[s('bamboo',3),s('bamboo',4),s('bamboo',5)]], bonus:[se('spring')] },
  { name:'Robot West', wind:'W', score:25, current:false,
    hand:[s('circles',1),s('circles',2),s('circles',3),s('circles',5),s('circles',5),s('circles',5),s('characters',8),s('characters',8),w('west'),w('west'),w('west'),d('white'),d('white')],
    melds:[], bonus:[] },
  { name:'Robot North', wind:'N', score:50, current:false,
    hand:[s('bamboo',1),s('bamboo',1),s('characters',2),s('characters',3),s('characters',4),s('characters',6),s('characters',7),s('circles',8),s('circles',9),d('red')],
    melds:[[w('north'),w('north'),w('north'),w('north')]], bonus:[fl('orchid'),se('summer')] },
];
const discards = [s('characters',9),w('south'),s('bamboo',6),d('white'),s('circles',1),s('characters',3),w('north'),s('bamboo',5),s('circles',9),s('characters',4),d('green'),s('bamboo',2),s('circles',7),w('west')];

function staticHand(p, vertical) {
  return `<div class="hand ${vertical?'handVertical':''}">${p.hand.map(t => tile(t, 40, false)).join('')}</div>`;
}
function interactiveHand(p) {
  const slots = p.hand.map((t, i) =>
    `<div class="slot" data-tile data-id="t${i}" data-sort="${sortVal(t)}">${tile(t, 56, false)}</div>`).join('');
  return `<div class="wrap">
    <div class="toolbar"><button type="button" class="sortBtn" id="sortBtn">Sort</button><span class="hint">drag tiles to rearrange</span></div>
    <div class="row" id="handRow" role="list">${slots}</div>
  </div>`;
}
function meldsBlock(p, size) {
  if (!p.melds.length && !p.bonus.length) return '';
  const meldsHtml = p.melds.map(m => `<div class="meld">${m.map((t,i)=>tile(t,size-8, m.length===4&&(i===0||i===3))).join('')}</div>`).join('');
  const bonusHtml = p.bonus.length ? `<div class="bonus">${p.bonus.map(t=>tile(t,size-8,false)).join('')}</div>` : '';
  return `<div class="melds">${meldsHtml}${bonusHtml}</div>`;
}
function seatPanel(p, position) {
  const vertical = position==='left'||position==='right';
  const size = position==='bottom'?56:40;
  const hand = position==='bottom' ? interactiveHand(p) : staticHand(p, vertical);
  const exposed = meldsBlock(p, size);
  // Exposed melds sit towards the centre, so above the hand for bottom/top.
  const body = (position==='bottom' || position==='top') ? `${exposed}${hand}` : `${hand}${exposed}`;
  return `<section class="seat seat_${position} ${p.current?'seatActive':''}">
    <header class="seatHeader"><span class="windBadge">${p.wind}</span><span class="seatName">${p.name}</span><span class="seatScore">${p.score}</span></header>
    ${body}
  </section>`;
}

function scatteredDiscards() {
  // Absolute placement is done by the page script (layoutDiscards), matching the
  // React DiscardArea: a measured grid of non-overlapping cells, scattered.
  return discards.map((t, i) => `<div class="discardTile" data-id="d${i}">${tile(t, 46, false)}</div>`).join('');
}

const board = `<div class="app">
  <div class="toolbar"><span class="title">Mah Jong</span><div class="controls"><label>Players <select><option>4</option></select></label><label><input type="checkbox" checked> Reveal all hands</label></div></div>
  <div class="tableArea">
    <div class="board" data-players="4">
      <aside class="scorePanel">
        <div class="scoreHead"><span>Hand 3</span><span>East round</span></div>
        <ul class="scoreList">${players.map(p=>`<li><span>${p.name}</span><span>${p.score}</span></li>`).join('')}</ul>
        <span class="placeholderTag">Score panel — Module 2.5</span>
      </aside>
      <div class="slotTop">${seatPanel(players[2],'top')}</div>
      <div class="slotLeft">${seatPanel(players[3],'left')}</div>
      <div class="slotRight">${seatPanel(players[1],'right')}</div>
      <div class="slotCentre"><div class="centre">
        <div class="wallInfo"><span><strong id="liveCount">42</strong> in wall</span><span><strong>14</strong> dead</span><span class="turnInfo">You (East) · discarding · drawn clockwise ↻</span><button type="button" id="drawBtn" class="sortBtn">Draw</button></div>
        <div class="frame" id="wallFrame"><div class="inner"><div class="discardPool">${scatteredDiscards()}</div></div></div>
      </div></div>
      <div class="slotBottom">${seatPanel(players[0],'bottom')}<div class="placeholder actionBar">Action bar — Module 2.4</div></div>
    </div>
  </div>
</div>`;

const script = `
const row = document.getElementById('handRow');
let drag = null;
const slots = () => Array.from(row.querySelectorAll('.slot'));
row.addEventListener('pointerdown', (e) => {
  const slot = e.target.closest('.slot');
  if (!slot) return;
  const items = slots();
  const rects = items.map((el) => el.getBoundingClientRect());
  const pitch = rects.length > 1 ? rects[1].left - rects[0].left : rects[0].width;
  drag = { slot, from: items.indexOf(slot), startX: e.clientX, pitch, dx: 0, target: items.indexOf(slot), items };
  slot.classList.add('dragging');
  slot.setPointerCapture(e.pointerId);
  e.preventDefault();
});
row.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.dx = e.clientX - drag.startX;
  drag.target = Math.max(0, Math.min(drag.items.length - 1, Math.round(drag.from + drag.dx / drag.pitch)));
  drag.items.forEach((el, i) => {
    let t = '';
    if (i === drag.from) t = 'translateX(' + drag.dx + 'px)';
    else if (drag.from < drag.target && i > drag.from && i <= drag.target) t = 'translateX(' + (-drag.pitch) + 'px)';
    else if (drag.target < drag.from && i >= drag.target && i < drag.from) t = 'translateX(' + drag.pitch + 'px)';
    el.style.transform = t;
  });
});
function endDrag() {
  if (!drag) return;
  const { slot, from, target, items } = drag;
  items.forEach((el) => { el.style.transform = ''; });
  slot.classList.remove('dragging');
  if (target !== from) {
    const ids = items.map((el) => el.dataset.id);
    const moved = ids.splice(from, 1)[0];
    ids.splice(target, 0, moved);
    ids.forEach((id) => row.appendChild(row.querySelector('.slot[data-id="' + id + '"]')));
  }
  drag = null;
}
row.addEventListener('pointerup', endDrag);
row.addEventListener('pointercancel', endDrag);
document.getElementById('sortBtn').addEventListener('click', () => {
  slots().sort((a, b) => Number(a.dataset.sort) - Number(b.dataset.sort)).forEach((el) => row.appendChild(el));
});

const pool = document.querySelector('.discardPool');
const CELL_W = 62, CELL_H = 66, BBOX_W = 42, BBOX_H = 52;
function hf(str, salt) { let h = (2166136261 ^ salt) >>> 0; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return ((h >>> 0) % 100000) / 100000; }
function cellOrder(cols, rows) { const cells = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([c, r]); return cells.sort((a, b) => hf(a[0] + '-' + a[1], 7) - hf(b[0] + '-' + b[1], 7)); }
function layoutDiscards() {
  const w = pool.clientWidth, h = pool.clientHeight;
  if (!w || !h) return;
  const cols = Math.max(1, Math.floor(w / CELL_W)), rows = Math.max(1, Math.floor(h / CELL_H));
  const order = cellOrder(cols, rows);
  Array.from(pool.querySelectorAll('.discardTile')).forEach((el, i) => {
    const id = el.dataset.id;
    const cell = order[i % order.length] || [0, 0];
    const cw = w / cols, ch = h / rows;
    const maxJx = Math.max(0, (cw - BBOX_W) / 2), maxJy = Math.max(0, (ch - BBOX_H) / 2);
    el.style.left = ((cell[0] + 0.5) * cw + (hf(id, 1) * 2 - 1) * maxJx) + 'px';
    el.style.top = ((cell[1] + 0.5) * ch + (hf(id, 2) * 2 - 1) * maxJy) + 'px';
    el.style.setProperty('--rot', ((hf(id, 3) * 2 - 1) * 10) + 'deg');
  });
}
layoutDiscards();
new ResizeObserver(layoutDiscards).observe(pool);

const frame = document.getElementById('wallFrame');
let live = 42;
const PITCH = 22, MARGIN = 16;
function perimeterSlots(w, h) {
  const slots = [], m = MARGIN;
  for (let x = m; x <= w - m; x += PITCH) slots.push({ x, y: m, vertical: false });
  for (let y = m + PITCH; y <= h - m; y += PITCH) slots.push({ x: w - m, y, vertical: true });
  for (let x = w - m - PITCH; x >= m; x -= PITCH) slots.push({ x, y: h - m, vertical: false });
  for (let y = h - m - PITCH; y >= m + PITCH; y -= PITCH) slots.push({ x: m, y, vertical: true });
  return slots;
}
function stackEl(s, isHead) {
  const d = document.createElement('div');
  d.className = 'stack';
  d.style.left = s.x + 'px'; d.style.top = s.y + 'px';
  d.style.transform = 'translate(-50%, -50%) rotate(' + (s.vertical ? 90 : 0) + 'deg)';
  const b2 = document.createElement('span'); b2.className = 'backTile back2';
  const b1 = document.createElement('span'); b1.className = 'backTile' + (isHead ? ' drawNext' : '');
  d.appendChild(b2); d.appendChild(b1);
  return d;
}
function layoutWall() {
  const w = frame.clientWidth, h = frame.clientHeight;
  frame.querySelectorAll('.stack, .drawArrow').forEach((e) => e.remove());
  if (!w || !h) return;
  const slots = perimeterSlots(w, h);
  const n = Math.min(slots.length, Math.ceil(live / 2));
  for (let i = 0; i < n; i++) frame.appendChild(stackEl(slots[i], i === 0));
  if (n > 0) {
    const a = document.createElement('span');
    a.className = 'drawArrow'; a.textContent = '↻';
    a.style.left = (slots[0].x + 14) + 'px'; a.style.top = Math.max(8, slots[0].y) + 'px';
    frame.appendChild(a);
  }
}
document.getElementById('drawBtn').addEventListener('click', () => {
  live = Math.max(0, live - 1);
  document.getElementById('liveCount').textContent = live;
  layoutWall();
});
layoutWall();
new ResizeObserver(layoutWall).observe(frame);
`;

const full = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${css}</style></head><body>${board}<script>${script}</script></body></html>`;
writeFileSync(join(root, 'preview.html'), full);
console.log('wrote interactive preview.html');
