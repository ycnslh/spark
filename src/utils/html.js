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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/wake-page.css">
</head>
<body class="${escapeHtml(bodyClass)}">
${body}
<p class="back-link"><a href="/">Retour</a></p>
</body>
</html>`,
  };
}

module.exports = { escapeHtml, renderPage };
