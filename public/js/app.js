import { api } from './api.js';
import {
  toast,
  confirmDialog,
  attachRipple,
  copyToClipboard,
  formatMac,
  formatDate,
  focusableElements,
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
// Secrets éphémères : aucune persistance dans le stockage du navigateur.
const newTokenLinks = new Map();
const statuses = new Map();
const wakeStates = new Map();

async function refresh() {
  try {
    currentDevices = await api.listDevices();
    renderAll();
    await refreshSchedules();
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
      (d.ip || '').includes(q) ||
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
      <div class="device-ip"></div>
      <div class="device-host"></div>
      <div class="device-desc"></div>
      <div class="device-tags"></div>
      <button class="glass-button wake-button" data-action="wake">
        <i class="fas fa-power-off" aria-hidden="true"></i>
      </button>
      <p class="wake-state" role="status" aria-live="polite" aria-atomic="true"></p>
      <details class="token-panel">
        <summary>Raccourcis iPhone — tokens</summary>
        <form class="token-form form-group">
          <label>Libellé (facultatif, 60 caractères maximum)
            <input name="label" maxlength="60" placeholder="iPhone de la maison">
          </label>
          <button class="copy-button" type="submit">Créer un token</button>
        </form>
        <div class="token-secret" aria-live="polite"></div>
        <div class="token-list" aria-live="polite"></div>
      </details>
      <div class="history-panel" hidden></div>`;

    card.querySelector('.device-name span:last-child').textContent = device.name;
    card.querySelector('.device-mac').textContent = formatMac(device.mac);
    card.querySelector('.device-ip').textContent = device.ip ? `IP : ${device.ip}` : '';
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

    const tokenPanel = card.querySelector('.token-panel');
    tokenPanel.addEventListener('toggle', () => {
      if (tokenPanel.open) loadTokens(tokenPanel, device);
      else {
        newTokenLinks.delete(device.id);
        tokenPanel.querySelector('.token-secret').replaceChildren();
        renderDirectLinks(filteredDevices());
      }
    });
    card.querySelector('.token-form').addEventListener('submit', (event) => {
      event.preventDefault();
      createDeviceToken(tokenPanel, device);
    });
    const fresh = newTokenLinks.get(device.id);
    if (fresh) showCreatedToken(tokenPanel, device, fresh);
    devicesContainer.appendChild(card);
    applyStatus(device.id, statuses.get(device.id) ?? null);
    renderWakeState(device.id);
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
    const url = newTokenLinks.get(device.id)?.url;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td></td>
      <td class="link-cell"><a target="_blank" rel="noopener"></a></td>
      <td><button class="copy-button" aria-label="Copier le lien"><i class="fas fa-copy" aria-hidden="true"></i> Copier</button></td>`;
    tr.querySelector('td:first-child').textContent = device.name;
    const a = tr.querySelector('a');
    if (url) a.href = url;
    a.textContent = url || 'Créez un token dans la fiche de cet appareil.';
    tr.querySelector('.copy-button').disabled = !url;
    tr.querySelector('.copy-button').addEventListener('click', async (e) => {
      const button = e.currentTarget;
      try {
        await copyToClipboard(url);
        toast('Lien copié', 'success', 2000);
        const icon = button.querySelector('i');
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

function showCreatedToken(panel, device, created) {
  const secret = panel.querySelector('.token-secret');
  secret.replaceChildren();
  const warning = document.createElement('p');
  warning.textContent =
    'Copiez ce token maintenant : il ne sera plus affiché après fermeture ou rechargement. Cette URL donne accès au réveil de cet appareil. Utilisez HTTPS.';
  const value = document.createElement('code');
  value.textContent = created.token;
  const copy = document.createElement('button');
  copy.className = 'copy-button';
  copy.textContent = 'Copier le token';
  copy.addEventListener('click', async () => {
    try {
      await copyToClipboard(created.token);
      toast('Token copié', 'success');
    } catch {
      toast('Erreur de copie', 'error');
    }
  });
  const dismiss = document.createElement('button');
  dismiss.className = 'copy-button';
  dismiss.textContent = 'Masquer le token et le lien';
  dismiss.addEventListener('click', () => {
    newTokenLinks.delete(device.id);
    secret.replaceChildren();
    renderDirectLinks(filteredDevices());
  });
  secret.append(warning, value, copy, dismiss);
}

async function loadTokens(panel, device) {
  const list = panel.querySelector('.token-list');
  list.textContent = 'Chargement…';
  try {
    const tokens = await api.listTokens(device.id);
    list.replaceChildren();
    if (!tokens.length) list.textContent = 'Aucun token créé.';
    for (const token of tokens) {
      const row = document.createElement('p');
      const description = document.createElement('span');
      description.textContent = `${token.label || `Token ${token.id}`} — créé le ${formatDate(token.created_at)} — ${token.revoked_at ? 'révoqué' : 'actif'} — dernière utilisation : ${token.last_used_at ? formatDate(token.last_used_at) : 'jamais'} `;
      row.appendChild(description);
      if (!token.revoked_at) {
        const revoke = document.createElement('button');
        revoke.className = 'copy-button';
        revoke.textContent = 'Révoquer';
        revoke.addEventListener('click', async () => {
          if (!(await confirmDialog(`Révoquer le token « ${token.label || token.id} » ?`))) return;
          revoke.disabled = true;
          try {
            await api.revokeToken(device.id, token.id);
            if (newTokenLinks.get(device.id)?.id === token.id) {
              newTokenLinks.delete(device.id);
              panel.querySelector('.token-secret').replaceChildren();
              renderDirectLinks(filteredDevices());
            }
            await loadTokens(panel, device);
          } catch (err) {
            revoke.disabled = false;
            toast(err.message || 'Erreur de révocation', 'error');
          }
        });
        row.appendChild(revoke);
      }
      list.appendChild(row);
    }
  } catch (err) {
    list.textContent = err.message || 'Erreur de chargement des tokens';
  }
}

async function createDeviceToken(panel, device) {
  const form = panel.querySelector('form');
  const submit = form.querySelector('button');
  submit.disabled = true;
  try {
    const created = await api.createToken(device.id, form.elements.label.value);
    newTokenLinks.set(device.id, created);
    showCreatedToken(panel, device, created);
    form.reset();
    renderDirectLinks(filteredDevices());
    await loadTokens(panel, device);
  } catch (err) {
    toast(err.message || 'Erreur de création du token', 'error');
  } finally {
    submit.disabled = false;
  }
}

async function wakeDevice(device, button) {
  const icon = button.querySelector('i');
  const originalClass = icon.className;
  button.disabled = true;
  icon.className = 'fas fa-spinner fa-spin';
  button.classList.add('wake-sending');
  setWakeState(device.id, 'sending');

  try {
    await api.wakeDevice(device.mac);
    if (wakeStates.get(device.id) === 'sending') setWakeState(device.id, 'sent');
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
    setWakeState(device.id, 'failed');
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
    newTokenLinks.delete(device.id);
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
    applyStatus(device.id, online);
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
    panel.innerHTML = '<p class="ko"></p>';
    panel.querySelector('p').textContent = `Erreur: ${err.message}`;
  }
}

function applyStatus(id, online) {
  if (!Number.isInteger(id)) return;
  statuses.set(id, online);
  const card = devicesContainer.querySelector(`[data-device-id="${id}"]`);
  if (!card) return;
  const dot = card.querySelector('.status-dot');
  dot.classList.remove('online', 'offline', 'checking');
  if (online === true) dot.classList.add('online');
  else if (online === false) dot.classList.add('offline');
  dot.title =
    online === true
      ? 'En ligne — cliquer pour rafraîchir'
      : online === false
        ? 'Hors ligne — cliquer pour rafraîchir'
        : 'État inconnu — cliquer pour rafraîchir';
}

function setWakeState(id, state) {
  if (!Number.isInteger(id)) return;
  wakeStates.set(id, state);
  renderWakeState(id);
  if (state === 'confirmed') applyStatus(id, true);
}

function renderWakeState(id) {
  const card = devicesContainer.querySelector(`[data-device-id="${id}"]`);
  if (!card) return;
  const device = currentDevices.find((d) => d.id === id);
  const hasHost =
    device?.ip || device?.host || /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(device?.description || '');
  const labels = {
    sending: 'Envoi du réveil en cours…',
    sent: hasHost
      ? 'Réveil envoyé — en attente de confirmation…'
      : 'Réveil envoyé — aucune adresse de confirmation configurée.',
    confirmed: 'Réveil confirmé — appareil en ligne.',
    timeout: 'Délai de confirmation dépassé.',
    failed: 'Échec de l’envoi du réveil.',
  };
  card.querySelector('.wake-state').textContent = labels[wakeStates.get(id)] || '';
}

let pollTimer = null;
async function pollStatus() {
  if (document.visibilityState === 'hidden') return;
  try {
    const statuses = await api.getStatus();
    if (eventSource && eventSource.readyState === 1) return;
    for (const { id, online } of statuses) applyStatus(id, online);
    syncPendingWakes();
  } catch {
    /* silencieux: la home doit fonctionner même si /api/status échoue */
  }
}

async function syncPendingWakes() {
  for (const [id, state] of wakeStates) {
    if (state !== 'sent') continue;
    try {
      const [latest] = await api.getHistory(id, 1);
      if (wakeStates.get(id) !== state || !latest) continue;
      if (latest.ping_confirmed === 1) setWakeState(id, 'confirmed');
      else if (latest.ping_confirmed === 0) setWakeState(id, 'timeout');
      else if (!latest.success) setWakeState(id, 'failed');
    } catch {
      /* Le prochain sondage ou la reconnexion réessaiera. */
    }
  }
}

let eventSource = null;
let streamRetryTimer = null;
function startStream() {
  if (eventSource || !('EventSource' in window)) {
    if (!eventSource) startPolling();
    return;
  }
  try {
    eventSource = new EventSource('/api/events');
  } catch {
    startPolling();
    return;
  }
  eventSource.addEventListener('snapshot', (e) => {
    const list = JSON.parse(e.data);
    statuses.clear();
    for (const device of currentDevices) applyStatus(device.id, null);
    for (const { id, online } of list) applyStatus(id, online);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    syncPendingWakes();
  });
  eventSource.addEventListener('status', (e) => {
    const { id, online } = JSON.parse(e.data);
    applyStatus(id, online);
  });
  eventSource.addEventListener('remove', (e) => {
    const { id } = JSON.parse(e.data);
    statuses.delete(id);
    wakeStates.delete(id);
    newTokenLinks.delete(id);
    currentDevices = currentDevices.filter((device) => device.id !== id);
    renderAll();
    refreshSchedules();
  });
  eventSource.addEventListener('wake', (e) => {
    const { deviceId, state } = JSON.parse(e.data);
    setWakeState(deviceId, state);
  });
  // EventSource se reconnecte seul ; le snapshot resynchronise les pastilles.
  eventSource.addEventListener('error', () => {
    startPolling();
    if (eventSource?.readyState === 2) {
      eventSource.close();
      eventSource = null;
      streamRetryTimer = setTimeout(() => {
        streamRetryTimer = null;
        startStream();
      }, 5000);
    }
  });
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollStatus, 30_000);
  pollStatus();
}

function stopAll() {
  if (streamRetryTimer) clearTimeout(streamRetryTimer);
  streamRetryTimer = null;
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
  const focusables = focusableElements(modal);
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
  addDeviceForm.reset();
  document.getElementById('device-network-options').open = false;
  for (const field of ['ip', 'broadcast', 'probe_port']) {
    document.getElementById(`device-${field}`).value = edit?.[field] ?? '';
  }
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
  const ip = document.getElementById('device-ip').value.trim();
  const broadcast = document.getElementById('device-broadcast').value.trim();
  const port = document.getElementById('device-probe_port').value;
  const probe_port = port === '' ? null : Number(port);
  const payload = { name, host, description, ip, broadcast, probe_port };
  try {
    if (id) {
      await api.updateDevice(parseInt(id, 10), payload);
      toast('Appareil modifié', 'success');
    } else {
      await api.createDevice({ ...payload, mac });
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

const scheduleForm = document.getElementById('schedule-form');
const scheduleDevice = document.getElementById('schedule-device');
const schedulePause = document.getElementById('schedules-paused');
const scheduleFeedback = document.getElementById('schedule-feedback');
const dayNames = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
let scheduleRequest = null;

async function refreshSchedules() {
  if (scheduleRequest) return scheduleRequest;
  scheduleRequest = (async () => {
    try {
      const [schedules, state] = await Promise.all([api.listSchedules(), api.getScheduleState()]);
      const selected = scheduleDevice.value;
      scheduleDevice.replaceChildren(new Option('Sélectionnez un appareil', ''));
      for (const device of currentDevices) {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        scheduleDevice.add(option);
      }
      scheduleDevice.value = selected;
      schedulePause.checked = state.paused;
      schedulePause.setAttribute('aria-checked', String(state.paused));
      schedulePause.disabled = false;
      renderSchedules(schedules, state.paused);
    } catch (err) {
      scheduleFeedback.textContent = `Chargement des planifications impossible : ${err.message}`;
    }
  })().finally(() => {
    scheduleRequest = null;
  });
  return scheduleRequest;
}

function renderSchedules(schedules, paused) {
  const tbody = document.getElementById('schedules-tbody');
  const focused = tbody.contains(document.activeElement)
    ? document.activeElement.dataset.focusKey
    : null;
  tbody.replaceChildren();
  if (!schedules.length) {
    const cell = tbody.insertRow().insertCell();
    cell.colSpan = 7;
    cell.textContent = 'Aucune planification.';
  }
  for (const schedule of schedules) {
    const row = tbody.insertRow();
    const statusLabels = { running: 'En cours', sent: 'Paquet envoyé', failed: 'Échec' };
    const values = [
      schedule.label ? `${schedule.device_name} — ${schedule.label}` : schedule.device_name,
      schedule.time,
      schedule.days.map((day) => dayNames[day]).join(', '),
      schedule.enabled ? (paused ? 'En pause globale' : 'Activée') : 'Désactivée',
      schedule.last_run_at ? new Date(schedule.last_run_at).toLocaleString('fr-FR') : 'Jamais',
      statusLabels[schedule.last_status] || '—',
    ];
    for (const value of values) row.insertCell().textContent = value;
    const actions = row.insertCell();
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'copy-button';
    toggle.textContent = schedule.enabled ? 'Désactiver' : 'Activer';
    toggle.setAttribute(
      'aria-label',
      `${toggle.textContent} la planification de ${schedule.device_name} à ${schedule.time}`
    );
    toggle.dataset.focusKey = `toggle-${schedule.id}`;
    toggle.addEventListener('click', () =>
      scheduleAction(toggle, async () => {
        await api.updateSchedule(schedule.id, { enabled: !schedule.enabled });
        scheduleFeedback.textContent = 'Planification mise à jour.';
      })
    );
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'copy-button danger';
    remove.textContent = 'Supprimer';
    remove.setAttribute(
      'aria-label',
      `Supprimer la planification de ${schedule.device_name} à ${schedule.time}`
    );
    remove.dataset.focusKey = `delete-${schedule.id}`;
    remove.addEventListener('click', async () => {
      if (!(await confirmDialog('Supprimer cette planification ?'))) return;
      await scheduleAction(remove, async () => {
        await api.deleteSchedule(schedule.id);
        scheduleFeedback.textContent = 'Planification supprimée.';
      });
      scheduleDevice.focus();
    });
    actions.append(toggle, remove);
  }
  if (focused) {
    for (const button of tbody.querySelectorAll('button')) {
      if (button.dataset.focusKey === focused) button.focus();
    }
  }
}

async function scheduleAction(button, action) {
  button.disabled = true;
  try {
    await action();
    await scheduleRequest;
    await refreshSchedules();
  } catch (err) {
    scheduleFeedback.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

scheduleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const days = [...scheduleForm.querySelectorAll('[name="schedule-day"]:checked')].map((input) =>
    Number(input.value)
  );
  if (!days.length) {
    scheduleFeedback.textContent = 'Sélectionnez au moins un jour.';
    scheduleForm.querySelector('[name="schedule-day"]').focus();
    return;
  }
  await scheduleAction(scheduleForm.querySelector('[type="submit"]'), async () => {
    await api.createSchedule(scheduleDevice.value, {
      time: document.getElementById('schedule-time').value,
      days,
      label: document.getElementById('schedule-label').value,
    });
    scheduleForm.reset();
    scheduleFeedback.textContent = 'Planification ajoutée.';
  });
});

schedulePause.addEventListener('change', async () => {
  const paused = schedulePause.checked;
  schedulePause.setAttribute('aria-checked', String(paused));
  schedulePause.disabled = true;
  try {
    await api.setSchedulePaused(paused);
    scheduleFeedback.textContent = paused
      ? 'Tous les réveils planifiés sont en pause.'
      : 'Les réveils planifiés sont repris.';
  } catch (err) {
    schedulePause.checked = !paused;
    schedulePause.setAttribute('aria-checked', String(!paused));
    scheduleFeedback.textContent = err.message;
  } finally {
    schedulePause.disabled = false;
    await scheduleRequest;
    await refreshSchedules();
  }
});

setInterval(refreshSchedules, 30_000);

refresh().then(() => startStream());
