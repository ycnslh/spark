const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function renderPage({ title, status = 200, bodyClass = '', body }) {
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#f5f7f8">
  <title>${escapeHtml(title)}</title>
  <script src="/js/theme.js"></script>
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/wake-page.css">
</head>
<body class="${escapeHtml(bodyClass)}">
<a class="skip-link" href="#main-content">Aller au contenu</a>
<main id="main-content" class="container wake-page" tabindex="-1">
${body}
<p class="back-link"><a href="/">Retour aux appareils</a></p>
</main>
</body>
</html>`,
  };
}

module.exports = { escapeHtml, renderPage };
