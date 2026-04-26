import { api } from './api.js';
import { toast, confirmDialog, attachRipple, copyToClipboard, formatMac, formatDate } from './ui.js';

const devicesContainer = document.getElementById('devices-container');
const directLinksContainer = document.getElementById('direct-links-tbody');
const addDeviceBtn = document.getElementById('add-device-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addDeviceForm = document.getElementById('add-device-form');
const modal = document.getElementById('add-device-modal');

let currentDevices = [];

async function refresh() {
  try {
    currentDevices = await api.listDevices();
    renderDevices(currentDevices);
    renderDirectLinks(currentDevices);
    pollStatus();
  } catch (err) {
    console.error(err);
    toast('Erreur lors du chargement des appareils', 'error');
  }
}

function renderDevices(devices) {
  if (devices.length === 0) {
    devicesContainer.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-laptop" aria-hidden="true"></i>
        <p>Aucun appareil. Ajoutez votre premier appareil.</p>
      </div>`;
    return;
  }

  devicesContainer.innerHTML = '';
  for (const device of devices) {
    const card = document.createElement('article');
    card.className = 'device-card';
    card.dataset.deviceId = device.id;
    card.innerHTML = `
      <div class="device-header">
        <h3 class="device-name">
          <span class="status-dot" data-status="unknown" aria-hidden="true"></span>
          <span></span>
        </h3>
        <div class="device-actions">
          <button class="icon-btn" data-action="history" aria-label="Historique">
            <i class="fas fa-history" aria-hidden="true"></i>
          </button>
          <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
            <i class="fas fa-trash-alt" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="device-mac"></div>
      <div class="device-desc"></div>
      <button class="glass-button wake-button" data-action="wake" aria-label="Réveiller ${device.name}">
        <i class="fas fa-power-off" aria-hidden="true"></i>
      </button>
      <div class="history-panel" hidden></div>`;

    card.querySelector('.device-name span:last-child').textContent = device.name;
    card.querySelector('.device-mac').textContent = formatMac(device.mac);
    card.querySelector('.device-desc').textContent = device.description || '';

    const wakeBtn = card.querySelector('[data-action="wake"]');
    attachRipple(wakeBtn);
    wakeBtn.addEventListener('click', () => wakeDevice(device, wakeBtn));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteDevice(device));
    card.querySelector('[data-action="history"]').addEventListener('click', () => toggleHistory(card, device));

    devicesContainer.appendChild(card);
  }
}

function renderDirectLinks(devices) {
  if (devices.length === 0) {
    directLinksContainer.innerHTML = `
      <tr><td colspan="3" style="text-align:center;padding:20px;">Aucun appareil configuré</td></tr>`;
    return;
  }
  directLinksContainer.innerHTML = '';
  for (const device of devices) {
    const url = `${window.location.origin}/wake/${encodeURIComponent(device.name)}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td></td>
      <td class="link-cell"><a target="_blank" rel="noopener"></a></td>
      <td><button class="copy-button" aria-label="Copier le lien"><i class="fas fa-copy" aria-hidden="true"></i> Copier</button></td>`;
    tr.querySelector('td:first-child').textContent = device.name;
    const a = tr.querySelector('a');
    a.href = url;
    a.textContent = url;
    tr.querySelector('.copy-button').addEventListener('click', async (e) => {
      try {
        await copyToClipboard(url);
        toast('Lien copié', 'success', 2000);
        const icon = e.currentTarget.querySelector('i');
        const original = icon.className;
        icon.className = 'fas fa-check';
        setTimeout(() => { icon.className = original; }, 1500);
      } catch {
        toast('Erreur de copie', 'error');
      }
    });
    directLinksContainer.appendChild(tr);
  }
}

async function wakeDevice(device, button) {
  const icon = button.querySelector('i');
  const originalClass = icon.className;
  button.disabled = true;
  icon.className = 'fas fa-spinner fa-spin';
  button.classList.add('wake-sending');

  try {
    await api.wakeDevice(device.mac);
    icon.className = 'fas fa-check';
    button.classList.remove('wake-sending');
    button.classList.add('wake-success');
    toast(`Réveil envoyé à ${device.name}`, 'success');
    setTimeout(() => {
      icon.className = originalClass;
      button.classList.remove('wake-success');
      button.disabled = false;
    }, 3000);
  } catch (err) {
    icon.className = 'fas fa-exclamation-circle';
    button.classList.remove('wake-sending');
    button.classList.add('wake-error');
    toast(err.message || 'Erreur lors du réveil', 'error');
    setTimeout(() => {
      icon.className = originalClass;
      button.classList.remove('wake-error');
      button.disabled = false;
    }, 3000);
  }
}

async function deleteDevice(device) {
  const ok = await confirmDialog(`Supprimer l'appareil "${device.name}" ?`);
  if (!ok) return;
  try {
    await api.deleteDevice(device.mac);
    toast('Appareil supprimé', 'success');
    refresh();
  } catch (err) {
    toast(err.message || 'Erreur de suppression', 'error');
  }
}

async function toggleHistory(card, device) {
  const panel = card.querySelector('.history-panel');
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = '<p>Chargement…</p>';
  try {
    const history = await api.getHistory(device.id);
    if (history.length === 0) {
      panel.innerHTML = '<p>Aucun réveil enregistré.</p>';
      return;
    }
    const ul = document.createElement('ul');
    for (const h of history) {
      const li = document.createElement('li');
      const status = h.success ? '✓' : '✗';
      const ping = h.ping_confirmed === 1 ? ' (online)' : h.ping_confirmed === 0 ? ' (no ping)' : '';
      li.innerHTML = `<span class="${h.success ? 'ok' : 'ko'}">${status}</span><span></span>`;
      li.querySelector('span:last-child').textContent = `${formatDate(h.triggered_at)}${ping}`;
      ul.appendChild(li);
    }
    panel.innerHTML = '';
    panel.appendChild(ul);
  } catch (err) {
    panel.innerHTML = `<p class="ko">Erreur: ${err.message}</p>`;
  }
}

async function pollStatus() {
  try {
    const statuses = await api.getStatus();
    for (const { id, online } of statuses) {
      const card = devicesContainer.querySelector(`[data-device-id="${id}"]`);
      if (!card) continue;
      const dot = card.querySelector('.status-dot');
      dot.classList.remove('online', 'offline');
      if (online === true) dot.classList.add('online');
      else if (online === false) dot.classList.add('offline');
    }
  } catch {
    /* silencieux: la home doit fonctionner même si /api/status échoue */
  }
}

function openModal() { modal.classList.add('open'); document.getElementById('device-name').focus(); }
function closeModal() { modal.classList.remove('open'); addDeviceForm.reset(); }

addDeviceBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelAddBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) closeModal(); });

addDeviceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('device-name').value.trim();
  const mac = document.getElementById('device-mac').value.trim();
  const description = document.getElementById('device-description').value.trim();
  try {
    await api.createDevice({ name, mac, description });
    toast('Appareil ajouté', 'success');
    closeModal();
    refresh();
  } catch (err) {
    toast(err.message || 'Erreur lors de l\'ajout', 'error');
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

refresh();
setInterval(pollStatus, 30_000);
