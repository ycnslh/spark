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
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; padding: 24px; text-align: center; background: #121212; color: #e1e1e1; }
    .ok { color: #4caf50; margin: 16px 0; }
    .err { color: #f44336; margin: 16px 0; }
    .card { background: #1e1e1e; padding: 16px; border-radius: 12px; max-width: 360px; margin: 16px auto; }
    a { color: #4d6fff; }
  </style>
</head>
<body class="${escapeHtml(bodyClass)}">
${body}
<p style="margin-top: 24px;"><a href="/">Retour</a></p>
</body>
</html>`,
  };
}

module.exports = { escapeHtml, renderPage };
