// JARVIS Companion web app (ADR-0020 Revision: PWA first). All capture stays in page memory until the Owner exports.
import {verifyTask, TaskError, FORMAT} from './task.js';
import {encodeWav, peak} from './wav.js';

export const APP_VERSION = 'web-0.1.1';
const MAX_AUDIO_S = 30;
const MAX_VIDEO_S = 60;
const $ = id => document.getElementById(id);
const state = {task: null, item: null, pending: [], audio: null, video: null};

function showError(message) { $('error').textContent = message || ''; }

function done(taskId, label) {
  try { return Number(localStorage.getItem(`done:${taskId}:${label}`) || 0); } catch { return 0; }
}
function markDone(taskId, label, n) {
  try { localStorage.setItem(`done:${taskId}:${label}`, String(n)); } catch { /* progress display only */ }
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function utcStamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

async function addPending(name, blob, meta) {
  const bytes = await blob.arrayBuffer();
  const sidecar = {...meta, file: name, sha256: await sha256Hex(bytes), bytes: bytes.byteLength,
                   app_version: APP_VERSION, recorded_utc: new Date().toISOString()};
  const json = new Blob([JSON.stringify(sidecar, null, 2) + '\n'], {type: 'application/json'});
  state.pending.push({name, blob, sidecar: json});
  renderPending();
}

function renderPending() {
  const list = $('pending');
  list.replaceChildren(...state.pending.map(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name}（${Math.round(p.blob.size / 1024)} KB）`;
    return li;
  }));
  $('count').textContent = state.pending.length ? `${state.pending.length} 个` : '';
  $('export').disabled = $('clear').disabled = state.pending.length === 0;
}

// ---------- tasks ----------
async function loadTask(text) {
  try {
    state.task = await verifyTask(text);
    state.item = null;
  } catch (error) {
    state.task = null;
    const code = error instanceof TaskError ? error.message : 'UNKNOWN';
    const hint = {SIGNATURE: '签名不对，文件不是 JARVIS 生成的或被改过。', EXPIRED_OR_RANGE: '任务已过期。',
                  ED25519_UNSUPPORTED: '这个 iOS 版本不支持 Ed25519 验签（需要 iOS 17 以上）。'}[code];
    showError(hint || `任务文件无效（${code}）。`);
  }
  renderTask();
}

$('task-file').addEventListener('change', async event => {
  showError('');
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 65536) { showError('任务文件太大，已拒绝。'); return; }
  await loadTask(await file.text());
});

// Same-origin only (CSP connect-src 'self'); the signature, not the server, decides whether a task is accepted.
$('task-latest').addEventListener('click', async () => {
  showError('');
  let text;
  try {
    const reply = await fetch('tasks/latest.json', {cache: 'no-store'});
    if (!reply.ok) throw new Error();
    text = await reply.text();
  } catch { showError('现在加载不到任务（需要联网）。'); return; }
  if (text.length > 65536) { showError('任务文件太大，已拒绝。'); return; }
  await loadTask(text);
});

function renderTask() {
  const t = state.task;
  $('task-status').textContent = t ? `任务 ${t.taskId}，有效期到 ${t.expires.toLocaleString()}` : '还没有任务。';
  $('items').replaceChildren(...(t ? t.items : []).map(item => {
    const b = document.createElement('button');
    b.textContent = `${item.prompt_text}（${done(t.taskId, item.label)}/${item.count}）`;
    b.className = state.item === item ? 'active' : '';
    b.addEventListener('click', () => { state.item = item; renderTask(); renderRecord(); });
    return b;
  }));
  $('record-section').hidden = !(t && state.item);
}

function renderRecord() {
  const t = state.task, item = state.item;
  if (!t || !item) return;
  $('prompt').textContent = item.prompt_text;
  $('progress').textContent = `已录 ${done(t.taskId, item.label)} / ${item.count}`;
  $('record').disabled = done(t.taskId, item.label) >= item.count || state.audio !== null;
}

// ---------- audio: raw 48 kHz mono PCM16, no voice processing ----------
$('record').addEventListener('click', async () => {
  showError('');
  const t = state.task, item = state.item;
  let stream, context;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, sampleRate: FORMAT.sample_rate,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false}});
    context = new AudioContext({sampleRate: FORMAT.sample_rate});
    if (context.sampleRate !== FORMAT.sample_rate) throw new Error('RATE');
    await context.audioWorklet.addModule('capture-worklet.js');
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    context?.close();
    showError(error.message === 'RATE' ? '设备采样率不是 48 kHz，无法按任务格式录音。' : '无法打开麦克风（请在设置里允许）。');
    return;
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, 'jarvis-capture');
  const chunks = [];
  let frames = 0, maxPeak = 0;
  node.port.onmessage = ({data}) => {
    chunks.push(data);
    frames += data.length;
    const p = peak(data);
    maxPeak = Math.max(maxPeak, p);
    $('level').value = p;
    $('level-text').textContent = `音量峰值：${Math.round(maxPeak * 100)}%`;
    if (frames >= MAX_AUDIO_S * FORMAT.sample_rate) stopAudio();
  };
  source.connect(node);
  state.audio = {stream, context, chunks, t, item, started: performance.now(), get frames() { return frames; }, get peak() { return maxPeak; }};
  $('record').disabled = true;
  $('stop').disabled = false;
});

async function stopAudio() {
  const a = state.audio;
  if (!a) return;
  state.audio = null;
  a.stream.getTracks().forEach(track => track.stop());
  await a.context.close();
  $('stop').disabled = true;
  const n = done(a.t.taskId, a.item.label) + 1;
  const name = `${a.t.taskId}__${a.item.label}__${String(n).padStart(2, '0')}.wav`;
  const wav = new Blob([encodeWav(a.chunks, FORMAT.sample_rate)], {type: 'audio/wav'});
  await addPending(name, wav, {task_id: a.t.taskId, label: a.item.label, index: n, kind: 'RECORD_AUDIO',
    sample_rate: FORMAT.sample_rate, channels: 1, encoding: 'pcm_s16le', voice_processing: false,
    duration_ms: Math.round(a.frames / FORMAT.sample_rate * 1000), peak_percent: Math.round(a.peak * 100)});
  markDone(a.t.taskId, a.item.label, n);
  renderTask();
  renderRecord();
}
$('stop').addEventListener('click', stopAudio);

// ---------- video: manual, H.264 MP4 where the browser offers it ----------
async function openCamera(facingMode) {
  showError('');
  closeCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true,
      video: {facingMode, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}}});
    state.video = {stream, facingMode, recorder: null};
    $('preview').srcObject = stream;
    $('preview').hidden = $('video-record').hidden = $('video-stop').hidden = false;
    await $('preview').play();
  } catch { showError('无法打开摄像头（请在设置里允许）。'); }
}
function closeCamera() {
  state.video?.stream.getTracks().forEach(track => track.stop());
  state.video = null;
  $('preview').hidden = $('video-record').hidden = $('video-stop').hidden = true;
}
$('video-front').addEventListener('click', () => openCamera('user'));
$('video-back').addEventListener('click', () => openCamera('environment'));

$('video-record').addEventListener('click', () => {
  const v = state.video;
  if (!v) return;
  const type = ['video/mp4;codecs=avc1', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) { showError('这个浏览器不能录 MP4。'); return; }
  const parts = [];
  const recorder = new MediaRecorder(v.stream, {mimeType: type, videoBitsPerSecond: 4_000_000});
  const settings = v.stream.getVideoTracks()[0].getSettings();
  const started = performance.now();
  recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
  recorder.onstop = async () => {
    const blob = new Blob(parts, {type: 'video/mp4'});
    await addPending(`manual__video__${utcStamp()}.mp4`, blob, {kind: 'MANUAL_VIDEO', mime: type,
      width: settings.width, height: settings.height, frame_rate: settings.frameRate, camera: v.facingMode,
      duration_ms: Math.round(performance.now() - started)});
    closeCamera();
  };
  recorder.start(1000);
  v.recorder = recorder;
  v.timer = setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_VIDEO_S * 1000);
  $('video-record').disabled = true;
  $('video-stop').disabled = false;
});
$('video-stop').addEventListener('click', () => {
  const v = state.video;
  if (!v?.recorder) return;
  clearTimeout(v.timer);
  v.recorder.stop();
  $('video-record').disabled = false;
  $('video-stop').disabled = true;
});

// ---------- export through the share sheet ----------
$('export').addEventListener('click', async () => {
  showError('');
  const files = state.pending.flatMap(p => [new File([p.blob], p.name, {type: p.blob.type}),
    new File([p.sidecar], p.name.replace(/\.\w+$/, '.json'), {type: 'application/json'})]);
  try {
    if (navigator.canShare?.({files})) {
      await navigator.share({files, title: 'JARVIS 录制'});
    } else {
      for (const file of files) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
    }
    state.pending = [];
    renderPending();
  } catch (error) {
    if (error.name !== 'AbortError') showError('导出失败，文件还在列表里。');
  }
});
$('clear').addEventListener('click', () => {
  if (confirm('清空所有未导出的录制？')) { state.pending = []; renderPending(); }
});

$('version').textContent = APP_VERSION;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
