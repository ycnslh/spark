const { test } = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, renderPage } = require('../src/utils/html');

test('escapeHtml escapes the dangerous characters', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml handles null and undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml stringifies non-strings', () => {
  assert.equal(escapeHtml(42), '42');
});

test('wake result pages share the accessible, themed local shell', () => {
  const { html } = renderPage({ title: '<script>', body: '<h1>Succès</h1>' });
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /href="#main-content"/);
  assert.match(html, /<main id="main-content"/);
  assert.match(html, /<title>&lt;script&gt;<\/title>/);
  assert.match(html, /src="\/js\/theme.js"/);
  assert.match(html, /href="\/style.css"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)|\sstyle=|\son\w+=/i);
});
