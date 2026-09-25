const $ = id => document.getElementById(id);

async function load() {
  const [deviceData, jobData] = await Promise.all([
    fetch('/api/devices').then(r => r.json()),
    fetch('/api/jobs').then(r => r.json()),
  ]);
  const devices = deviceData.devices || [];
  $('devices').innerHTML = devices.map(d => `<div class="device"><strong>${escapeHtml(d.name || d.id)}</strong><br><small>${escapeHtml(d.id)} · ${escapeHtml(d.state || '')}${d.error ? ` · ${escapeHtml(d.error)}` : ''}</small></div>`).join('') || 'No devices found.';
  $('device').innerHTML = devices.filter(d => d.state !== 'unavailable').map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || d.id)} (${escapeHtml(d.platform)})</option>`).join('');
  $('jobs').innerHTML = (jobData.jobs || []).map(j => `<div class="device"><strong>${escapeHtml(j.status)}</strong> · ${escapeHtml(j.deviceId)}<br><small>${escapeHtml(j.runAt)}</small></div>`).join('') || 'No jobs.';
}

$('refresh').onclick = load;
$('run').onclick = async () => {
  $('result').textContent = 'Running…';
  try {
    const actions = JSON.parse($('actions').value);
    const response = await fetch('/api/run', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({deviceId:$('device').value,actions})});
    const body = await response.json();
    $('result').textContent = JSON.stringify(body, null, 2);
  } catch (e) {
    $('result').textContent = e.message;
  }
};

function escapeHtml(value='') { return String(value).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c])); }
load();
