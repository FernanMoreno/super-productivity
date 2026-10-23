import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const bundle = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL('../src/', import.meta.url)),
    contents: `import { createGuidedPlanner } from './guided.mjs';
      import { initializeI18n } from './i18n.mjs';
      let language = 'es';
      window.queryDate = '2026-10-22';
      window.hooks = {};
      const api = {getCurrentLanguage: async () => language,
        registerHook: async (name, callback) => window.hooks[name] = callback};
      window.guided = createGuidedPlanner({
        adapter: {}, refresh: async () => {}, reportError: message => {throw Error(message)},
        current: () => ({date: window.queryDate, profile: {weekStartsOn: 1,
          timezone: 'Europe/Madrid', areas: [], preferences: {}}})});
      window.changeLanguage = async () => {language = 'en'; await hooks.languageChange()};
      window.navigation = [];
      document.addEventListener('planner:navigate', event => navigation.push(event.detail.section));
      initializeI18n(api, () => guided.render()).then(() => {guided.render(); window.ready = true});`,
  },
  bundle: true,
  write: false,
  format: 'iife',
});
const html = `<button id="outside">Outside</button>${[
  'review-range',
  'now-options',
  'guided-pending',
  'guided-proposal',
]
  .map((id) => `<div id="${id}"></div>`)
  .join('')}
  <script>${bundle.outputFiles[0].text}</script>`;
const server = createServer((_, response) => response.end(html));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.ready);
  const from = page.locator('#review-range [name="from"]');
  const to = page.locator('#review-range [name="to"]');
  assert.equal(await from.inputValue(), '2026-10-19');
  await from.fill('2026-10-01');
  await page.locator('#outside').focus();
  await page.evaluate(() => {
    window.queryDate = '2026-11-05';
    guided.render();
  });
  assert.equal(
    await from.inputValue(),
    '2026-10-01',
    'inactive edited start survives background render',
  );
  assert.equal(await to.inputValue(), '2026-11-08', 'untouched end follows query week');
  await page.evaluate(() => guided.render());
  assert.equal(await from.inputValue(), '2026-10-01', 'draft survives repeated hooks');
  await to.fill('2026-12-01');
  await page.locator('#outside').focus();
  await page.evaluate(() => changeLanguage());
  assert.equal(await from.inputValue(), '2026-10-01');
  assert.equal(
    await to.inputValue(),
    '2026-12-01',
    'both dirty dates survive language changes',
  );
  await page.evaluate(() => guided.showProposal({ proposals: [], conflicts: [] }));
  assert.deepEqual(
    await page.evaluate(() => navigation),
    ['proposal-adjust'],
    'proposal opens its owning workspace view',
  );
  assert.ok(await page.locator('#guided-proposal form').count());
  console.log('Guided browser draft preservation and proposal navigation passed.');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
