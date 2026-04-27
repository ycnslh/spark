const toastContainer = document.getElementById('toast-container');

export function toast(message, type = 'info', durationMs = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header"><h3 class="modal-title">Confirmation</h3></div>
        <p class="dialog-message"></p>
        <div class="form-buttons">
          <button type="button" class="btn cancel-button" data-act="cancel">Annuler</button>
          <button type="button" class="btn" data-act="ok">Confirmer</button>
        </div>
      </div>`;
    modal.querySelector('p').textContent = message;
    document.body.appendChild(modal);

    const close = (result) => {
      modal.remove();
      resolve(result);
    };
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') close(false);
      if (act === 'ok') close(true);
    });
    modal.querySelector('[data-act="ok"]').focus();
  });
}

export function attachRipple(button) {
  button.addEventListener('click', (e) => {
    const rect = button.getBoundingClientRect();
    const x = e.clientX ? e.clientX - rect.left : rect.width / 2;
    const y = e.clientY ? e.clientY - rect.top : rect.height / 2;
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 800);
  });
}

export function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('execCommand failed'));
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}

export function formatMac(mac) {
  const clean = mac.replace(/[:-]/g, '');
  return clean.match(/.{2}/g).join(':');
}

export function formatDate(isoString) {
  try {
    return new Date(isoString.replace(' ', 'T') + 'Z').toLocaleString('fr-FR');
  } catch {
    return isoString;
  }
}
