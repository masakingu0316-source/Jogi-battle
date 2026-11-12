// 招待のQRコード（作る）と、読み取った文字から部屋コードを取り出す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../public/qr.js';
import { roomFromScan } from '../public/scan.js';

test('QRコード：招待リンクから、四隅の目印のあるQRができる', () => {
  const m = qrMatrix('https://jogi.example.workers.dev/?room=ABCDE');
  const n = m.length;
  assert.ok(n >= 21 && (n - 17) % 4 === 0, `大きさ ${n}`);
  // 左上・右上・左下の目印（7×7 の枠）
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let k = 0; k < 7; k++) {
      assert.equal(m[r][c + k], true); assert.equal(m[r + 6][c + k], true);
      assert.equal(m[r + k][c], true); assert.equal(m[r + k][c + 6], true);
    }
    assert.equal(m[r + 1][c + 1], false);
    assert.equal(m[r + 3][c + 3], true);
  }
  const svg = qrSvg('https://x.example/?room=ABCDE', { label: '部屋 ABCDE' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /aria-label="部屋 ABCDE"/);
});

test('読み取り：このサイトの招待リンク・部屋コードだけを受け付ける', () => {
  const origin = 'https://jogi.example.workers.dev';
  assert.deepEqual(roomFromScan(`${origin}/?room=AB12C`, origin), { code: 'AB12C' });
  assert.deepEqual(roomFromScan(`${origin}/?room=ab12c&x=1`, origin), { code: 'AB12C' });
  assert.deepEqual(roomFromScan('k7q2m', origin), { code: 'K7Q2M' });
  assert.ok(roomFromScan('https://evil.example/?room=AB12C', origin).error, 'ほかのサイト');
  assert.ok(roomFromScan(`${origin}/?room=ABC`, origin).error, '部屋コードが正しくない');
  assert.ok(roomFromScan('こんにちは', origin).error);
});
