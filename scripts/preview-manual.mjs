/** Isolated real-component preview. No app login, backend requests or auth bypass route.
 * Run: node scripts/preview-manual.mjs; open http://127.0.0.1:4173/manual-preview.html
 * Temporary entry files are removed on exit. This preview is not in the production entry graph.
 */
import { createServer } from 'vite';
import { writeFileSync, rmSync } from 'node:fs';
const html = 'manual-preview.html', entry = 'manual-preview.tsx';
writeFileSync(html, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/manual-preview.tsx"></script></body></html>');
writeFileSync(entry, `import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { DOC_BODIES } from './src/components/docs/bodies';
import './src/index.css';
const params = new URLSearchParams(location.search);
const slug = params.get('page') || 'your-first-project';
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const Body = DOC_BODIES[slug];
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/docs/'+slug]}><main className="min-h-screen bg-background text-foreground"><div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">SuReSuite · isolated documentation preview</div><article className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">{Body ? <Body /> : <h1>Unknown page</h1>}</article></main></MemoryRouter>);
`);
const server = await createServer({ server: { port: 4173, strictPort: true, host: '127.0.0.1' } });
await server.listen();
console.log('Manual preview: http://127.0.0.1:4173/manual-preview.html');
const cleanup = async () => { await server.close(); rmSync(html, {force:true}); rmSync(entry, {force:true}); process.exit(); };
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup);
