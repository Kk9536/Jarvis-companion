// Signed task files from JARVIS (ADR-0020). Same format as research/companion_task.py:
// {"manifest_b64": base64(manifest UTF-8 bytes), "sig": base64(Ed25519 signature over exactly those bytes)}.
export const PUBLIC_KEY_B64 = 'LL8qWyJpXTzyk7x+llJAh5W2aPkQzNSDMR09DKj/5p0=';
export const FORMAT = {container: 'wav', encoding: 'pcm_s16le', sample_rate: 48000, channels: 1, voice_processing: false};
const LABEL = /^[a-z][a-z0-9_]{1,31}$/;
const TASK_ID = /^[0-9a-f]{16}$/;
const KEYS = ['expires_utc', 'format', 'issued_utc', 'items', 'kind', 'task_id', 'v'];

export class TaskError extends Error {}

function strictB64(text) {
  if (typeof text !== 'string' || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new TaskError('BASE64');
  const bin = atob(text);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function sameKeys(object, keys) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort());
}

export async function verifyTask(fileText, publicKeyB64 = PUBLIC_KEY_B64, now = new Date(), subtle = globalThis.crypto.subtle) {
  let outer;
  try { outer = JSON.parse(fileText); } catch { throw new TaskError('TASK_JSON'); }
  if (!sameKeys(outer, ['manifest_b64', 'sig'])) throw new TaskError('TASK_FIELDS');
  const raw = strictB64(outer.manifest_b64), sig = strictB64(outer.sig), pub = strictB64(publicKeyB64);
  let ok = false;
  try {
    const key = await subtle.importKey('raw', pub, {name: 'Ed25519'}, false, ['verify']);
    ok = await subtle.verify({name: 'Ed25519'}, key, sig, raw);
  } catch { throw new TaskError('ED25519_UNSUPPORTED'); }
  if (!ok) throw new TaskError('SIGNATURE');
  let m;
  try { m = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)); } catch { throw new TaskError('FIELDS'); }
  if (!sameKeys(m, KEYS)) throw new TaskError('FIELDS');
  if (m.v !== 1 || m.kind !== 'RECORD_AUDIO' || !sameKeys(m.format, Object.keys(FORMAT)) ||
      Object.entries(FORMAT).some(([k, v]) => m.format[k] !== v)) throw new TaskError('KIND_OR_FORMAT');
  if (typeof m.task_id !== 'string' || !TASK_ID.test(m.task_id)) throw new TaskError('TASK_ID');
  const issued = Date.parse(m.issued_utc), expires = Date.parse(m.expires_utc);
  if (!(issued < expires) || expires > issued + 30 * 86400e3 || !(expires > now.getTime())) throw new TaskError('EXPIRED_OR_RANGE');
  if (!Array.isArray(m.items) || m.items.length < 1 || m.items.length > 20) throw new TaskError('ITEMS');
  const seen = new Set();
  for (const item of m.items) {
    if (!sameKeys(item, ['count', 'label', 'prompt_text'])) throw new TaskError('ITEM_FIELDS');
    if (typeof item.label !== 'string' || !LABEL.test(item.label) || seen.has(item.label) ||
        typeof item.prompt_text !== 'string' || item.prompt_text.length < 1 || item.prompt_text.length > 120 ||
        !Number.isInteger(item.count) || item.count < 1 || item.count > 50) throw new TaskError('ITEM_VALUE');
    seen.add(item.label);
  }
  return {taskId: m.task_id, expires: new Date(expires), items: m.items.map(i => ({...i}))};
}
