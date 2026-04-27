import { api } from './api.js';
import {
  toast,
  confirmDialog,
  attachRipple,
  copyToClipboard,
  formatMac,
  formatDate,
} from './ui.js';

const devicesContainer = document.getElementById('devices-container');
const directLinksContainer = document.getElementById('direct-links-tbody');
const addDeviceBtn = document.getElementById('add-device-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addDeviceForm = document.getElementById('add-device-form');
const modal = document.getElementById('add-device-modal');
const modalTitle = document.getElementById('modal-title');
const submitDeviceBtn = document.getElementById('submit-device-btn');
const searchInput = document.getElementById('search-input');

let currentDevices = [];
let searchTerm = '';

async function refresh() {
  try {
    currentDevices = await api.listDevices();
    renderAll();
    pollStatus();
  } catch (err) {
    console.error(err);
    toast('Erreur lors du chargement des appareils', 'error');
  }
}

function filteredDevices() {
  if (!searchTerm) return currentDevices;
  const q = searchTerm.toLowerCase();
  return currentDevices.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      (d.host || '').toLowerCase().includes(q) ||
      (d.description || '').toLowerCase().includes(q) ||
      d.mac.toLowerCase().includes(q)
  );
}

function renderAll() {
  const list = filteredDevices();
  renderDevices(list);
  renderDirectLinks(list);
}

function renderDevices(devices) {
  if (devices.length === 0) {
    devicesContainer.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-laptop" aria-hidden="true"></i>
        <p>${currentDevices.length === 0 ? 'Aucun appareil. Ajoutez votre premier appareil.' : 'Aucun résultat.'}</p>
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
          <span class="status-dot" data-status="unknown" aria-hidden="true" title="Cliquer pour rafraîchir"></span>
          <span></span>
        </h3>
        <div class="device-actions">
          <button class="icon-btn" data-action="edit" aria-label="Modifier">
            <i class="fas fa-pen" aria-hidden="true"></i>
          </button>
          <button class="icon-btn" data-action="history" aria-label="Historique">
            <i class="fas fa-history" aria-hidden="true"></i>
          </button>
          <button class="icon-btn danger" data-action="delete" aria-label="Supprimer">
            <i class="fas fa-trash-alt" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="device-mac"></div>
      <div class="device-host"></div>
      <div class="device-desc"></div>
      <div class="device-tags"></div>
      <button class="glass-button wake-button" data-action="wake">
        <i class="fas fa-power-off" aria-hidden="true"></i>
      </button>
      <div class="history-panel" hidden></div>`;

    card.querySelector('.device-name span:last-child').textContent = device.name;
    card.querySelector('.device-mac').textContent = formatMac(device.mac);
    card.querySelector('.device-host').textContent = device.host || '';
    card.querySelector('.device-desc').textContent = device.description || '';
    const tagsContainer = card.querySelector('.device-tags');
    if (device.tags && device.tags.length) {
      for (const t of device.tags) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        if (t.color) chip.style.setProperty('--tag-color', t.color);
        chip.textContent = t.name;
        tagsContainer.appendChild(chip);
      }
    }

    const wakeBtn = card.querySelector('[data-action="wake"]');
    wakeBtn.setAttribute('aria-label', `Réveiller ${device.name}`);
    attachRipple(wakeBtn);
    wakeBtn.addEventListener('click', () => wakeDevice(device, wakeBtn));
    card
      .querySelector('[data-action="edit"]')
      .addEventListener('click', () => openEditModal(device));
    card
      .querySelector('[data-action="delete"]')
      .addEventListener('click', () => deleteDevice(device));
    card
      .querySelector('[data-action="history"]')
      .addEventListener('click', () => toggleHistory(card, device));
    card
      .querySelector('.status-dot')
      .addEventListener('click', () => refreshDeviceStatus(device, card));

    devicesContainer.appendChild(card);
  }
}

function renderDirectLinks(devices) {
  if (devices.length === 0) {
    directLinksContainer.innerHTML = `
      <tr><td colspan="3" class="empty-row">Aucun appareil configuré</td></tr>`;
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
        setTimeout(() => {
          icon.className = original;
        }, 1500);
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

async function refreshDeviceStatus(device, card) {
  const dot = card.querySelector('.status-dot');
  dot.classList.add('checking');
  try {
    const { online } = await api.refreshStatus(device.id);
    dot.classList.remove('online', 'offline', 'checking');
    if (online === true) dot.classList.add('online');
    else if (online === false) dot.classList.add('offline');
  } catch {
    dot.classList.remove('checking');
    toast('Erreur de vérification', 'error');
  }
}

async function toggleHistory(card, device) {
  const panel = card.querySelector('.history-panel');
  if (!panel.hidden) {
    panel.hidden = true;
    return;
  }
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
      let suffix = '';
      if (h.ping_confirmed === 1 && h.confirmed_at) {
        const triggered = new Date(h.triggered_at.replace(' ', 'T') + 'Z').getTime();
        const confirmed = new Date(h.confirmed_at.replace(' ', 'T') + 'Z').getTime();
        const seconds = Math.max(0, Math.round((confirmed - triggered) / 1000));
        suffix = ` (online en ${seconds}s)`;
      } else if (h.ping_confirmed === 1) {
        suffix = ' (online)';
      } else if (h.ping_confirmed === 0) {
        suffix = ' (no ping)';
      }
      li.innerHTML = `<span class="${h.success ? 'ok' : 'ko'}">${status}</span><span></span>`;
      li.querySelector('span:last-child').textContent = `${formatDate(h.triggered_at)}${suffix}`;
      ul.appendChild(li);
    }
    panel.innerHTML = '';
    panel.appendChild(ul);
  } catch (err) {
    panel.innerHTML = `<p class="ko">Erreur: ${err.message}</p>`;
  }
}

function applyStatus(id, online) {
  const card = devicesContainer.querySelector(`[data-device-id="${id}"]`);
  if (!card) return;
  const dot = card.querySelector('.status-dot');
  dot.classList.remove('online', 'offline', 'checking');
  if (online === true) dot.classList.add('online');
  else if (online === false) dot.classList.add('offline');
}

let pollTimer = null;
async function pollStatus() {
  if (document.visibilityState === 'hidden') return;
  try {
    const statuses = await api.getStatus();
    for (const { id, online } of statuses) applyStatus(id, online);
  } catch {
    /* silencieux: la home doit fonctionner même si /api/status échoue */
  }
}

let eventSource = null;
function startStream() {
  if (eventSource || !('EventSource' in window)) {
    if (!eventSource) startPolling();
    return;
  }
  try {
    eventSource = new EventSource('/api/status/stream');
  } catch {
    startPolling();
    return;
  }
  eventSource.addEventListener('snapshot', (e) => {
    const list = JSON.parse(e.data);
    for (const { id, online } of list) applyStatus(id, online);
  });
  eventSource.addEventListener('change', (e) => {
    const { id, online } = JSON.parse(e.data);
    applyStatus(id, online);
  });
  eventSource.addEventListener('error', () => {
    eventSource?.close();
    eventSource = null;
    startPolling();
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollStatus, 30_000);
  pollStatus();
}

function stopAll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    pollStatus();
    startStream();
  } else {
    stopAll();
  }
});

let lastFocusedBeforeModal = null;

function trapTab(e) {
  if (e.key !== 'Tab' || !modal.classList.contains('open')) return;
  const focusables = modal.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openModal({ edit = null } = {}) {
  lastFocusedBeforeModal = document.activeElement;
  if (edit) {
    modalTitle.textContent = "Modifier l'appareil";
    submitDeviceBtn.innerHTML = '<i class="fas fa-save" aria-hidden="true"></i> Enregistrer';
    document.getElementById('device-id').value = edit.id;
    document.getElementById('device-name').value = edit.name;
    document.getElementById('device-mac').value = edit.mac;
    document.getElementById('device-mac').disabled = true;
    document.getElementById('device-host').value = edit.host || '';
    document.getElementById('device-description').value = edit.description || '';
  } else {
    modalTitle.textContent = 'Ajouter un appareil';
    submitDeviceBtn.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> Ajouter';
    document.getElementById('device-id').value = '';
    document.getElementById('device-mac').disabled = false;
  }
  modal.classList.add('open');
  document.getElementById('device-name').focus();
}
function openEditModal(device) {
  openModal({ edit: device });
}
function closeModal() {
  modal.classList.remove('open');
  addDeviceForm.reset();
  document.getElementById('device-mac').disabled = false;
  if (lastFocusedBeforeModal && lastFocusedBeforeModal.focus) {
    lastFocusedBeforeModal.focus();
  }
}

addDeviceBtn.addEventListener('click', () => openModal());
closeModalBtn.addEventListener('click', closeModal);
cancelAddBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  trapTab(e);
});

if (searchInput) {
  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim();
    renderAll();
    pollStatus();
  });
}

addDeviceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.getElementById('device-id').value;
  const name = document.getElementById('device-name').value.trim();
  const mac = document.getElementById('device-mac').value.trim();
  const host = document.getElementById('device-host').value.trim();
  const description = document.getElementById('device-description').value.trim();
  try {
    if (id) {
      await api.updateDevice(parseInt(id, 10), { name, host, description });
      toast('Appareil modifié', 'success');
    } else {
      await api.createDevice({ name, mac, host, description });
      toast('Appareil ajouté', 'success');
    }
    closeModal();
    refresh();
  } catch (err) {
    toast(err.message || 'Erreur', 'error');
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

refresh().then(() => startStream());
