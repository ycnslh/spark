const toastContainer = document.getElementById('toast-container');

export function focusableElements(container) {
  return [
    ...container.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
    ),
  ].filter((element) => element.getClientRects().length > 0);
}

// Only trusted, hard-coded symbol names are passed to this template.
export function icon(name) {
  return `<svg class="icon${name === 'spinner' ? ' is-spinning' : ''}" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;
}
export function setIcon(button, name) {
  button.querySelector('svg').outerHTML = icon(name);
}

export function toast(message, type = 'info', durationMs = 6000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

// Both device and confirmation dialogs share keyboard and background isolation.
export function activateDialog(modal, onEscape) {
  const previous = document.activeElement;
  const siblings = [...document.body.children].filter(
    (el) => el !== modal && el.tagName !== 'SCRIPT' && el.id !== 'toast-container'
  );
  const previousInert = siblings.map((el) => el.inert);
  siblings.forEach((el) => {
    el.inert = true;
  });
  document.body.classList.add('modal-open');
  modal.classList.add('open');
  const keydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
    }
    if (event.key !== 'Tab') return;
    const elements = focusableElements(modal);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first) {
      event.preventDefault();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || !modal.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !modal.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', keydown);
  focusableElements(modal)[0]?.focus();
  return () => {
    document.removeEventListener('keydown', keydown);
    modal.classList.remove('open');
    siblings.forEach((el, index) => {
      el.inert = previousInert[index];
    });
    document.body.classList.remove('modal-open');
    if (previous?.isConnected) previous.focus();
    else document.getElementById('add-device-btn')?.focus();
  };
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'confirmation-title');
    modal.setAttribute('aria-describedby', 'confirmation-message');
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header"><h2 id="confirmation-title" class="modal-title">Confirmation</h2></div>
        <p id="confirmation-message" class="dialog-message"></p>
        <div class="form-buttons">
          <button type="button" class="btn cancel-button" data-act="cancel">Annuler</button>
          <button type="button" class="btn" data-act="ok">Confirmer</button>
        </div>
      </div>`;
    modal.querySelector('p').textContent = message;
    document.body.appendChild(modal);
    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      deactivate();
      modal.remove();
      resolve(result);
    };
    const deactivate = activateDialog(modal, () => close(false));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close(false);
      const act = event.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') close(false);
      if (act === 'ok') close(true);
    });
  });
}

export async function copyToClipboard(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const previous = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.className = 'sr-only';
  ta.setAttribute('aria-label', 'Texte à copier');
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copie indisponible');
  } finally {
    ta.remove();
    previous?.focus();
  }
}

export function formatMac(mac) {
  return mac.replace(/[:-]/g, '').match(/.{2}/g).join(':');
}
export function formatDate(isoString) {
  try {
    return new Date(isoString.replace(' ', 'T') + 'Z').toLocaleString('fr-FR');
  } catch {
    return isoString;
  }
}
