// LRC → [{ t, text, sub?, end }] for the jukebox (shared with tools/).
// Translated LRCs come in two layouts:
//  A) the translation shares the original's timestamp:  [01:00]原文  [01:00]译文
//  B) staggered — the translation carries the NEXT line's timestamp:  [00:03]原文  [00:06]译文  [00:06]下一句原文 …
// B is recognised by which side of the equal-timestamp pairs is the Chinese translation: in A the second line is, in B the first.

// credits / title lines are not lyrics
const CREDIT = /^(作词|作曲|编曲|制作人|监制|词|曲|混音|录音|母带|和声|配唱|吉他|贝斯|鼓|弦乐|Programmed|Producer|Produced|Lyric|Composer|Composed|Written|Arranger)[^:：]{0,12}[:：]|Studio|Mastering|录音室|混音室|工程师|^以下歌词翻译/i;
const KANA = /[぀-ヿ]/;
// a Chinese translation line: hanzi, no kana / hangul, hardly any Latin (the originals are Japanese, English, Korean…)
const isZh = (s) => /[\u4e00-\u9fff]/.test(s) && !KANA.test(s) && !/[\uac00-\ud7af]/.test(s) && (s.match(/[A-Za-z]/g) || []).length < 4;
const same = (a, b) => Math.abs(a - b) < 0.05;
const isLyric = (e) => e.text && !CREDIT.test(e.text) && !(e.t < 6 && / - /.test(e.text));

export function parseLrc(txt, duration) {
  const rows = []; // file order, blanks kept (they hold the alternation in layout B)
  for (const line of txt.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; if (!stamps.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) rows.push({ t: +m[1] * 60 + parseFloat(m[2]), text });
  }
  let a = 0, b = 0;
  for (let i = 0; i + 1 < rows.length; i++) {
    const p = rows[i], q = rows[i + 1]; if (!same(p.t, q.t) || !p.text || !q.text) continue;
    if (!isZh(p.text) && isZh(q.text)) a++; else if (isZh(p.text) && !isZh(q.text)) b++;
  }
  let out = [];
  if (b >= 3 && b > a) {
    // B: originals and translations alternate in file order; the translations sit on the parity that starts the equal pairs
    let p0 = 0, p1 = 0; for (let i = 0; i + 1 < rows.length; i++) if (same(rows[i].t, rows[i + 1].t)) (i % 2 ? p1++ : p0++);
    const tp = p1 >= p0 ? 1 : 0;
    rows.forEach((r, i) => {
      const last = out[out.length - 1];
      if (i % 2 === tp && last) { if (!last.sub && r.text) last.sub = r.text; last.endT = r.t; } else out.push({ t: r.t, text: r.text });
    });
    out = out.filter(isLyric).sort((x, y) => x.t - y.t);
  } else {
    // A (or no translation at all): merge lines that share a timestamp, original first
    const keep = rows.map((r, order) => ({ ...r, order })).filter(isLyric).sort((x, y) => x.t - y.t || x.order - y.order);
    for (const r of keep) { const prev = out[out.length - 1]; if (prev && same(prev.t, r.t)) { if (!prev.sub) prev.sub = r.text; continue; } out.push({ t: r.t, text: r.text }); }
  }
  out.forEach((e, i) => { e.end = out[i + 1]?.t ?? e.endT ?? duration; delete e.endT; });
  return out;
}

// LRC text with the translations left out (originals only)
export function originalsOnly(txt, duration) {
  const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  return parseLrc(txt, duration).map((e) => `[${mmss(e.t)}]${e.text}`).join('\n') + '\n';
}
