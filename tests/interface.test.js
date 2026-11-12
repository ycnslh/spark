const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PRECACHE_ASSETS } = require('../src/routes/serviceWorker');
const read = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

for (const file of ['index.html', 'offline.html']) {
  test(`${file}: French landmarks, skip link and same-origin CSP-compatible assets`, () => {
    const html = read(file);
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /class="skip-link" href="#main-content"/);
    assert.match(html, /<main[^>]*id="main-content"/);
    assert.doesNotMatch(html, /<style\b|\sstyle=|\son\w+=|cdnjs/i);
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.match(script[1], /src="\/js\/[^"]+"/);
      assert.equal(script[2].trim(), '');
    }
    for (const match of html.matchAll(/(?:src|href)="(\/[^"#?]+)(?:#[^"]*)?"/g)) {
      if (match[1].startsWith('/api/')) continue;
      assert.ok(fs.existsSync(path.join(__dirname, '../public', match[1])), match[1]);
      assert.ok(PRECACHE_ASSETS.includes(match[1]), `Precache missing ${match[1]}`);
    }
  });
}

test('all visible static form controls have an associated label and errors reference real regions', () => {
  const html = read('index.html');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = match[0];
    if (attr(tag, 'type') === 'hidden') continue;
    const id = attr(tag, 'id');
    const wrapped =
      html.lastIndexOf('<label', match.index) > html.lastIndexOf('</label>', match.index);
    assert.ok(wrapped || (id && html.includes(`for="${id}"`)), `Missing label: ${tag}`);
    for (const ref of (attr(tag, 'aria-describedby') || '').split(' ').filter(Boolean)) {
      assert.ok(ids.has(ref), `Missing description ${ref}`);
    }
    if (id && !['search-input', 'tag-filter', 'schedules-paused'].includes(id)) {
      assert.ok(attr(tag, 'aria-describedby'), `Missing feedback association: ${id}`);
    }
  }
});

test('all local icons used by static markup or JS exist in the sprite', () => {
  const ids = new Set([...read('icons.svg').matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const names = [...read('index.html').matchAll(/icons\.svg#([^" ]+)/g)].map((m) => m[1]);
  for (const name of ['app.js', 'ui.js']) {
    for (const match of read(`js/${name}`).matchAll(/(?:icon\(|setIcon\([^,]+,\s*)'([^']+)'/g))
      names.push(match[1]);
  }
  for (const name of names) assert.ok(ids.has(name), name);
});

function themeHarness({ dark = false, saved = null, blocked = false } = {}) {
  const handlers = {};
  const system = {
    matches: dark,
    addEventListener: (_name, callback) => {
      handlers.system = callback;
    },
  };
  const root = { dataset: {} };
  const meta = {};
  const button = {
    setAttribute: (key, value) => {
      button[key] = value;
    },
    addEventListener: (_name, fn) => {
      handlers.click = fn;
    },
  };
  const storage = {
    value: saved,
    getItem() {
      if (blocked) throw new Error('Blocked');
      return this.value;
    },
    setItem(_key, value) {
      if (blocked) throw new Error('Blocked');
      this.value = value;
    },
  };
  vm.runInNewContext(read('js/theme.js'), {
    window: { matchMedia: () => system },
    localStorage: storage,
    document: {
      documentElement: root,
      querySelector: () => ({
        setAttribute: (key, value) => {
          meta[key] = value;
        },
      }),
      getElementById: () => button,
      addEventListener: (_name, fn) => {
        handlers.ready = fn;
      },
    },
  });
  return { root, system, button, meta, storage, handlers };
}

test('theme follows the system before DOM ready, syncs theme-color and follows system changes', () => {
  const t = themeHarness({ dark: true });
  assert.equal(t.root.dataset.theme, 'dark');
  assert.equal(t.meta.content, '#101c23');
  t.handlers.ready();
  assert.equal(t.button['aria-pressed'], 'true');
  t.system.matches = false;
  t.handlers.system();
  assert.equal(t.root.dataset.theme, 'light');
  assert.equal(t.meta.content, '#f5f7f8');
});

test('manual theme survives reload and ignores later system changes', () => {
  const t = themeHarness({ saved: 'dark' });
  assert.equal(t.root.dataset.theme, 'dark');
  t.handlers.ready();
  t.handlers.click();
  assert.equal(t.storage.value, 'light');
  t.system.matches = true;
  t.handlers.system();
  assert.equal(t.root.dataset.theme, 'light');
  assert.equal(themeHarness({ saved: t.storage.value, dark: true }).root.dataset.theme, 'light');
});

test('blocked storage and invalid saved values do not break theming', () => {
  for (const options of [{ blocked: true }, { saved: 'invalid' }]) {
    const t = themeHarness(options);
    t.handlers.ready();
    t.handlers.click();
    assert.equal(t.root.dataset.theme, 'dark');
    assert.equal(t.button['aria-pressed'], 'true');
  }
});

function luminance(hex) {
  const channels = hex
    .match(/[a-f\d]{2}/gi)
    .map((n) => parseInt(n, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
}
for (const [theme, selector] of [
  ['light', ':root {'],
  ['dark', ":root[data-theme='dark'] {"],
]) {
  test(`${theme}: text contrasts >= 4.5:1 and controls/focus >= 3:1`, () => {
    const block = read('style.css').split(selector)[1].split('}')[0];
    const colors = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map((m) => [m[1], m[2]])
    );
    const ratios = [];
    for (const background of ['bg', 'surface', 'surface-alt']) {
      for (const foreground of ['text', 'muted', 'accent', 'success', 'error']) {
        const ratio = contrast(colors[foreground], colors[background]);
        assert.ok(ratio >= 4.5, `${foreground}/${background}: ${ratio.toFixed(2)}`);
        ratios.push(ratio);
      }
      for (const foreground of ['border', 'focus']) {
        assert.ok(
          contrast(colors[foreground], colors[background]) >= 3,
          `${foreground}/${background}`
        );
      }
    }
    for (const background of ['accent', 'accent-hover'])
      assert.ok(contrast(colors['on-accent'], colors[background]) >= 4.5);
    for (const background of ['success', 'error'])
      assert.ok(contrast(colors.surface, colors[background]) >= 4.5);
    console.log(`${theme}: minimum text contrast ${Math.min(...ratios).toFixed(2)}:1`);
  });
}
