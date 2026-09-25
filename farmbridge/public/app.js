const $ = id => document.getElementById(id);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function json(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const post = (url, body) => json(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;

async function load() {
  try {
    const [deviceData, jobData, accountData, mediaData, reelData] = await Promise.all([
      json('/api/devices'), json('/api/jobs'), json('/api/accounts'), json('/api/media'), json('/api/reels'),
    ]);
    const devices = deviceData.devices || [];
    const accounts = accountData.accounts || [];
    const media = mediaData.media || [];
    const reels = reelData.reels || [];
    $('devices').innerHTML = devices.map(d => `<div class="device"><strong>${escapeHtml(d.name || d.id)}</strong><br><small>${escapeHtml(d.id)} · ${escapeHtml(d.state || '')}${d.error ? ` · ${escapeHtml(d.error)}` : ''}</small></div>`).join('') || 'No devices found.';
    const available = devices.filter(d => d.state !== 'unavailable' && d.state !== 'unauthorized');
    $('device').innerHTML = available.map(d => option(d.id, `${d.name || d.id} (${d.platform})`)).join('');
    $('account-device').innerHTML = available.map(d => option(d.id, `${d.name || d.id} (${d.platform})`)).join('');
    $('accounts').innerHTML = accounts.map(a => `<div class="device"><strong>${escapeHtml(a.name)}</strong><br><small>${escapeHtml(a.deviceId)} · ${escapeHtml(a.appId)}</small></div>`).join('') || 'No profiles yet.';
    $('media').innerHTML = media.map(m => `<div class="device">${escapeHtml(m.name)} <small>(${(m.size / 1048576).toFixed(1)} MB)</small></div>`).join('') || 'No videos yet.';
    $('reel-account').innerHTML = accounts.map(a => option(a.id, `${a.name} (${a.platform})`)).join('');
    $('reel-media').innerHTML = media.map(m => option(m.id, m.name)).join('');
    $('reels').innerHTML = reels.map(r => `<div class="device"><strong>${escapeHtml(r.status)}</strong> · ${escapeHtml(media.find(m => m.id === r.mediaId)?.name || 'missing video')}<br><small>${escapeHtml(accounts.find(a => a.id === r.accountId)?.name || 'missing profile')}${r.scheduledAt ? ` · ${escapeHtml(new Date(r.scheduledAt).toLocaleString())}` : ''}</small>${r.caption ? `<p>${escapeHtml(r.caption)}</p>` : ''}${r.lastError ? `<p class="bad">${escapeHtml(r.lastError)}</p>` : ''}${['draft', 'scheduled', 'failed'].includes(r.status) ? `<br><button data-prepare="${r.id}">Prepare now</button>` : ''}${r.status === 'needs_ios_import' ? `<br><button data-ios-import="${r.id}">Video imported — open app</button>` : ''}</div>`).join('') || 'No Reels yet.';
    $('jobs').innerHTML = (jobData.jobs || []).map(j => `<div class="device"><strong>${escapeHtml(j.status)}</strong> · ${escapeHtml(j.deviceId)}<br><small>${escapeHtml(j.runAt)}</small></div>`).join('') || 'No device workflows.';
  } catch (error) { $('result').textContent = error.message; }
}

async function perform(work) {
  $('result').textContent = 'Working…';
  try { await work(); $('result').textContent = 'Done.'; await load(); }
  catch (error) { $('result').textContent = error.message; }
}

$('refresh').onclick = load;
$('upload').onclick = () => perform(async () => {
  const file = $('video-file').files[0];
  if (!file) throw new Error('Choose a video first');
  await json(`/api/media/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
  $('video-file').value = '';
});
$('add-account').onclick = () => perform(() => post('/api/accounts', { name: $('account-name').value, deviceId: $('account-device').value, appId: $('account-app').value }));
$('add-reel').onclick = () => perform(async () => {
  const scheduledAt = $('reel-time').value ? new Date($('reel-time').value).toISOString() : null;
  await post('/api/reels', { accountId: $('reel-account').value, mediaId: $('reel-media').value, caption: $('reel-caption').value, scheduledAt });
  $('reel-caption').value = '';
});
$('reels').onclick = event => {
  const id = event.target.closest('[data-prepare]')?.dataset.prepare;
  if (id) perform(() => post(`/api/reels/${id}/prepare`, {}));
  const iosId = event.target.closest('[data-ios-import]')?.dataset.iosImport;
  if (iosId) perform(() => post(`/api/reels/${iosId}/confirm-ios-import`, {}));
};
$('run').onclick = () => perform(async () => {
  const response = await post('/api/run', { deviceId: $('device').value, actions: JSON.parse($('actions').value) });
  $('result').textContent = JSON.stringify(response, null, 2);
});

load();
