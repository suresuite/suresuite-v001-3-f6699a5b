// Run from the repo root. Requires Playwright and a Chromium installation.
// Set MANUAL_CHROME_EXECUTABLE if Chromium is outside Playwright's cache.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const playwrightPath = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright';
const { chromium } = require(playwrightPath);
const base = 'http://127.0.0.1:8091';
(async () => {
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '8091', '--strictPort'], { stdio: 'ignore' });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw Error('Local Vite preview did not start.');
    browser = await chromium.launch({ headless: true, executablePath: process.env.MANUAL_CHROME_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const output = path.resolve('docs/manual-evidence');
    fs.mkdirSync(output, { recursive: true });
    const report = [];
    for (const slug of ['your-first-project', 'uploading-data', 'how-your-data-flows']) {
      for (const [mode, width, theme] of [['desktop-light', 1280, 'light'], ['desktop-dark', 1280, 'dark'], ['mobile-light', 390, 'light'], ['mobile-dark', 390, 'dark']]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
        await page.goto(`${base}/scripts/docs/preview-manual.html?page=${slug}&theme=${theme}`, { waitUntil: 'networkidle' });
        await page.locator('h1').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, figures: document.querySelectorAll('figure').length, title: document.querySelector('h1').textContent }));
        if (metrics.scrollWidth > width || errors.length) throw Error(JSON.stringify({ slug, mode, metrics, errors }));
        await page.screenshot({ path: path.join(output, `${slug}-${mode}.png`), fullPage: true });
        report.push({ slug, mode, ...metrics, errors });
        if (slug === 'your-first-project') await page.screenshot({ path: path.join(output, `first-project-${mode}-viewport.png`) });
        if (slug === 'your-first-project' && mode === 'desktop-light') await page.locator('section').filter({ has: page.locator('#example') }).screenshot({ path: path.join(output, 'control-kit-example.png') });
        await page.close();
      }
    }
    fs.writeFileSync(path.join(output, 'render-checks.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.length} page/theme/viewport combinations captured; no horizontal overflow or page errors.`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
