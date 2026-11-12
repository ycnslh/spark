// Blocking same-origin script: apply the saved preference before the first paint.
(() => {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try {
    const saved = localStorage.getItem('spark-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // Private mode or blocked storage: keep the control usable in memory.
  }
  function apply() {
    const dark = preference ? preference === 'dark' : system.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#101c23' : '#f5f7f8');
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.textContent = dark ? 'Thème clair' : 'Thème sombre';
      button.setAttribute(
        'aria-label',
        dark ? 'Activer le thème clair' : 'Activer le thème sombre'
      );
      button.setAttribute('aria-pressed', String(dark));
    }
  }
  apply();
  system.addEventListener('change', () => {
    if (!preference) apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('spark-theme', preference);
      } catch {
        /* Storage is optional. */
      }
      apply();
    });
  });
})();
