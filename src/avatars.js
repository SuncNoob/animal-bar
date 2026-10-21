import { L } from './i18n.js';
// The playable guests: one place for what differs per avatar (name, portrait, how tall the name tag / dizzy stars sit).
// label: name-tag height · head: dizzy-stars height · view: the wardrobe preview camera's framing height
export const AVATARS = {
  dog_ge:        { name: L('狗哥', 'Brother Dog'), portrait: 'dog', label: 1.35, head: 1.15, view: 1.2, emoji: '🐶' },
  rabbit_mei:    { name: L('兔妹', 'Bunny Mei'), portrait: 'rabbit', label: 1.55, head: 1.35, view: 1.35, emoji: '🐰' },
  chicken_jibie: { name: L('鸡瘪', 'Chick Punk'), portrait: 'chicken', label: 1.35, head: 1.15, view: 1.2, emoji: '🐥' },
};
export const avatarInfo = (k) => AVATARS[k] || AVATARS.dog_ge;
