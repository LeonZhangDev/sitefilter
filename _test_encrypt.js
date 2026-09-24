/* SiteFilter 备份加解密专项测试（WebCrypto PBKDF2 + AES-GCM）
   验证的是"密码学行为"，不是"按钮存在"：
   ① 加密产物自描述（fmt/iter/salt/iv/data 齐全），且明文里读不到原始数据
   ② 正确密码能还原出一模一样的数据
   ③ 错误密码必须失败（不能返回垃圾数据）
   ④ 每次导出的 salt / iv 都不同（同密码同数据 → 不同密文）
   ⑤ 篡改密文会被 AES-GCM 的完整性校验发现
   ⑥ 明文备份仍能正常识别（不把明文当加密件）

   做法：直接把 options.js 里那段加密实现抽出来在 Node 的 WebCrypto 下跑。
   Node 18+ 的 globalThis.crypto 就是 WebCrypto，与浏览器同源实现。
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = __dirname;
const js = fs.readFileSync(path.join(EXT, 'options.js'), 'utf8');

let pass = true;
const check = (name, cond) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) pass = false; };

/* ---------- 从 options.js 里剥出加密相关的函数源码 ---------- */
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('找不到函数 ' + name);
  // 从函数头开始做花括号配平，切出完整函数体
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('函数 ' + name + ' 花括号不配平');
  return src.slice(start, end);
}

const needed = ['b64enc', 'b64dec', 'deriveKey', 'encryptBackup', 'decryptBackup', 'isEncryptedBackup'];
let code = '';
needed.forEach(n => { code += sliceFn(js, n) + '\n'; });
// 依赖的常量
code += 'var ENC_FMT = ' + JSON.stringify('sitefilter-enc') + ';\n';
const iterM = js.match(/var ENC_ITER = (\d+);/);
if (!iterM) { console.log('FAIL 找不到 ENC_ITER 定义'); process.exit(1); }
code += 'var ENC_ITER = ' + iterM[1] + ';\n';
code += 'module.exports = { encryptBackup: encryptBackup, decryptBackup: decryptBackup, isEncryptedBackup: isEncryptedBackup, ENC_FMT: ENC_FMT, ENC_ITER: ENC_ITER, b64dec: b64dec };\n';

const sandbox = {
  module: { exports: {} },
  console, Date, Math, Object, Array, JSON, String, Number, Promise, Error,
  TextEncoder, TextDecoder,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  crypto: globalThis.crypto,
  Uint8Array, isFinite, parseInt,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const lib = sandbox.module.exports;

const SAMPLE = {
  schemaVersion: 4,
  settings: { enabled: true, sfw: true, keys: { next: 'j' } },
  rules: [
    { id: 'r1', type: 'actress', value: '三上悠亚', action: 'block', enabled: true, expr: '', expiresAt: 0 },
    { id: 'r2', type: 'tag', value: '巨乳', action: 'block', enabled: true, expr: '', expiresAt: 0 }
  ],
  seen: { 'ABC-001': 1700000000000 },
  discovered: { 'actress|新垣结衣': { v: '新垣结衣', type: 'actress', n: 3, first: 1, last: 2 } },
  learned: { at: 1, total: 2, items: [] },
  dismissedLearn: {}, profiles: [], activeProfile: '', expiredLog: []
};

(async () => {
  /* ============ ① 加密产物形状 ============ */
  const wrap = await lib.encryptBackup(SAMPLE, 'my-secret-pass');
  check('加密产物带自描述 fmt = sitefilter-enc', wrap.fmt === 'sitefilter-enc');
  check('加密产物带版本号 v', typeof wrap.v === 'number' && wrap.v >= 1);
  check('加密产物记录了算法名', /AES-GCM/.test(wrap.alg || '') && /PBKDF2/.test(wrap.alg || ''));
  check('加密产物记录了迭代次数', wrap.iter === lib.ENC_ITER && wrap.iter >= 100000);
  check('加密产物带 salt / iv / data（base64）',
    typeof wrap.salt === 'string' && typeof wrap.iv === 'string' && typeof wrap.data === 'string' &&
    wrap.salt.length > 0 && wrap.iv.length > 0 && wrap.data.length > 0);
  check('salt 为 16 字节、iv 为 12 字节',
    lib.b64dec(wrap.salt).length === 16 && lib.b64dec(wrap.iv).length === 12);

  /* ============ ② 明文里读不到原始数据 ============ */
  const raw = JSON.stringify(wrap);
  check('密文里读不到规则值（三上悠亚）', raw.indexOf('三上悠亚') === -1);
  check('密文里读不到标签值（巨乳）', raw.indexOf('巨乳') === -1);
  check('密文里读不到番号（ABC-001）', raw.indexOf('ABC-001') === -1);
  check('密文里读不到密码本身', raw.indexOf('my-secret-pass') === -1);
  // 但明文字段（fmt/iter/alg）应当可读 —— 这是有意为之，便于以后升级参数
  check('明文元数据保留（fmt/iter 可读）', raw.indexOf('sitefilter-enc') !== -1);

  /* ============ ③ 正确密码能完整还原 ============ */
  const back = await lib.decryptBackup(wrap, 'my-secret-pass');
  check('正确密码能解密', !!back && typeof back === 'object');
  check('还原出的数据与原始数据深度一致', JSON.stringify(back) === JSON.stringify(SAMPLE));
  check('还原后规则值正确', back.rules[0].value === '三上悠亚' && back.rules.length === 2);
  check('还原后新字段（learned/profiles）都在',
    !!back.learned && Array.isArray(back.profiles) && back.activeProfile === '');

  /* ============ ④ 错误密码必须失败 ============ */
  let wrongFailed = false;
  try {
    await lib.decryptBackup(wrap, 'wrong-pass');
  } catch (e) { wrongFailed = true; }
  check('错误密码解密失败（抛错，而非返回垃圾数据）', wrongFailed);

  let emptyFailed = false;
  try {
    await lib.decryptBackup(wrap, '');
  } catch (e) { emptyFailed = true; }
  check('空密码解密失败', emptyFailed);

  /* ============ ⑤ 每次导出的 salt/iv 都不同 ============ */
  const wrap2 = await lib.encryptBackup(SAMPLE, 'my-secret-pass');
  check('两次导出的 salt 不同', wrap2.salt !== wrap.salt);
  check('两次导出的 iv 不同', wrap2.iv !== wrap.iv);
  check('两次导出的密文不同（同密码同数据）', wrap2.data !== wrap.data);
  const back2 = await lib.decryptBackup(wrap2, 'my-secret-pass');
  check('第二份密文同样能还原', JSON.stringify(back2) === JSON.stringify(SAMPLE));

  /* ============ ⑥ 篡改密文会被完整性校验发现 ============ */
  const tampered = Object.assign({}, wrap);
  const buf = Buffer.from(wrap.data, 'base64');
  buf[5] = buf[5] ^ 0xff;               // 翻一个字节
  tampered.data = buf.toString('base64');
  let tamperFailed = false;
  try {
    await lib.decryptBackup(tampered, 'my-secret-pass');
  } catch (e) { tamperFailed = true; }
  check('篡改密文后解密失败（AES-GCM 完整性校验生效）', tamperFailed);

  // 篡改 iv 同样应当失败
  const tamperedIv = Object.assign({}, wrap);
  const ivBuf = Buffer.from(wrap.iv, 'base64');
  ivBuf[0] = ivBuf[0] ^ 0xff;
  tamperedIv.iv = ivBuf.toString('base64');
  let ivFailed = false;
  try { await lib.decryptBackup(tamperedIv, 'my-secret-pass'); } catch (e) { ivFailed = true; }
  check('篡改 iv 后解密失败', ivFailed);

  /* ============ ⑦ 识别函数：明文 / 加密不能互相误判 ============ */
  check('识别加密备份：加密产物 → true', lib.isEncryptedBackup(wrap) === true);
  check('识别加密备份：明文数据 → false', lib.isEncryptedBackup(SAMPLE) === false);
  check('识别加密备份：null / 字符串 → false',
    lib.isEncryptedBackup(null) === false && lib.isEncryptedBackup('x') === false);
  check('识别加密备份：只有 fmt 没有 data → false',
    lib.isEncryptedBackup({ fmt: 'sitefilter-enc' }) === false);

  /* ============ ⑧ 中文 / 特殊字符往返不乱码 ============ */
  const tricky = {
    rules: [{ id: 'x', type: 'actress', value: '深田えいみ / ゆあ', action: 'block' }],
    note: 'emoji 也要能过 🎬✨ 换行\n制表\t引号"撇号\'',
    n: 42
  };
  const tw = await lib.encryptBackup(tricky, '密码也可以是中文🔑');
  const tb = await lib.decryptBackup(tw, '密码也可以是中文🔑');
  check('中文 / 日文 / emoji / 换行往返不乱码', JSON.stringify(tb) === JSON.stringify(tricky));
  check('中文密码可用', !!tb && tb.n === 42);

  /* ============ ⑨ 空对象也能安全往返（不因边界值崩） ============ */
  const ew = await lib.encryptBackup({}, 'pass123456');
  const eb = await lib.decryptBackup(ew, 'pass123456');
  check('空对象也能往返', JSON.stringify(eb) === '{}');

  console.log(pass ? '\n加密备份测试全部通过 ✅' : '\n存在失败 ❌');
  process.exit(pass ? 0 : 1);
})().catch(e => {
  console.log('FAIL 测试自身抛错：' + (e && e.stack || e));
  process.exit(1);
});
