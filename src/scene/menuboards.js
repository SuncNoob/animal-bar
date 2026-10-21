// Everything with lettering over the bar is drawn here, in the player's language:
//  - boardsCanvas(): the six painted drink boards under the beam (six side by side, each ~0.48 wide per 1 high;
//    furniture.js slices the strip), wall numbers 1–6 left to right
//  - signCanvas(): the shop sign on the north wall
import MENU from '../data/menu.json';
import { isEn, L } from '../i18n.js';

const BW = 256, BH = 536;

export function boardsCanvas() {
  const boards = MENU.wallBoards;
  const c = document.createElement('canvas'); c.width = BW * boards.length; c.height = BH;
  const g = c.getContext('2d');
  const font = (w, px) => `${w} ${px}px ${isEn ? 'system-ui,sans-serif' : '"PingFang SC","Noto Sans SC",system-ui,sans-serif'}`;
  boards.forEach((b, i) => {
    g.save(); g.translate(i * BW, 0);
    // painted plank: flat colour, a darker brush band, a few lighter streaks
    g.fillStyle = b.bg; g.fillRect(0, 0, BW, BH);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, BH * 0.62, BW, BH * 0.38);
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 10;
    for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(-10, 40 + k * 110); g.lineTo(BW + 10, 10 + k * 110); g.stroke(); }
    g.strokeStyle = b.ink; g.lineWidth = 6; g.strokeRect(12, 12, BW - 24, BH - 24);
    // number badge
    g.fillStyle = b.ink; g.beginPath(); g.arc(BW / 2, 62, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = b.bg; g.font = font(900, 44); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(b.no), BW / 2, 64);
    g.font = '64px system-ui,sans-serif'; g.fillText(b.emoji, BW / 2, 160);
    // the style, as big as it fits, tilted like a hand-painted sign
    g.save(); g.translate(BW / 2, 278); g.rotate(-0.06);
    const name = isEn ? b.name_en.toUpperCase() : b.name, words = name.split(' ');
    const lines = isEn && words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : [name];
    let px = isEn ? 52 : 56; g.font = font(900, px);
    while (px > 24 && Math.max(...lines.map((l) => g.measureText(l).width)) > BW - 44) { px -= 2; g.font = font(900, px); }
    g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.45)'; g.fillStyle = b.ink;
    lines.forEach((l, k) => { const y = (k - (lines.length - 1) / 2) * px * 1.05; g.strokeText(l, 0, y); g.fillText(l, 0, y); });
    g.restore();
    g.fillStyle = b.ink; g.font = font(800, 34); g.fillText(`${b.abv}%`, BW / 2, 400);
    g.font = isEn ? 'italic 600 22px Georgia,serif' : font(600, 24); g.fillText(isEn ? b.tag_en : b.tag, BW / 2, 452);
    g.restore();
  });
  return c;
}

// the sign on the north wall: the bar's name, hand-lettered on a transparent background
export function signCanvas() {
  const c = document.createElement('canvas'); c.width = 400; c.height = 560;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const lines = L(['动物', '酒馆'], ['ANIMAL', 'BAR']), px = isEn ? 104 : 168;
  g.font = isEn ? `900 ${px}px system-ui,sans-serif` : `900 ${px}px "PingFang SC","Noto Sans SC",serif`;
  lines.forEach((t, k) => {
    const y = c.height / 2 + (k - 0.5) * px * 1.15;
    g.lineWidth = 18; g.strokeStyle = '#5a2a08'; g.strokeText(t, c.width / 2, y);
    g.fillStyle = '#ffd27a'; g.fillText(t, c.width / 2, y);
  });
  g.font = '64px system-ui,sans-serif'; g.fillText('🍺', c.width / 2, c.height - 50);
  return c;
}
