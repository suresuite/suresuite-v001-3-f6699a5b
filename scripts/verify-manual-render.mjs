// Optional reviewer tool: install Playwright without changing package.json/lock,
// install its Chromium, and start node scripts/preview-manual.mjs in another terminal.
// Run from the repository root: node scripts/verify-manual-render.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
const pages = ['your-first-project','uploading-data','how-your-data-flows','how-suresuite-is-designed','product-level-network','process-level-network','firm-level-network','how-policies-work','simulation-lab','experiments-and-comparison','reading-your-results','kpis-and-resilience-index','seeds-replications-confidence','roles-and-capabilities','project-access','getting-an-api-key','known-limits'];
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const reports=[];fs.mkdirSync('docs/manual-review/screenshots',{recursive:true});
for (const width of [1440,375]) for(const theme of ['light','dark']) {
 const p=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 // Block all remote services. Only the local preview server is authorized by this check.
 await p.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 for(const slug of pages){
  errors.length=0;await p.goto(`http://127.0.0.1:4173/manual-preview.html?page=${slug}&theme=${theme}`);await p.locator('h1').waitFor();await p.evaluate(()=>document.fonts.ready);
  const info=await p.evaluate(()=>({heading:document.querySelector('h1')?.textContent,figures:document.querySelectorAll('figure svg,figure img').length,overflow:document.documentElement.scrollWidth>innerWidth+1,brokenImages:[...document.images].filter(i=>!i.complete||!i.naturalWidth).length,authorText:/not drawn yet|To fill it:|Work package \d/.test(document.body.innerText)}));
  reports.push({slug,width,theme,...info,errors:[...errors]});
  if((slug==='your-first-project'&&width===1440&&theme==='light')||(slug==='how-policies-work'&&width===1440&&theme==='dark')||(slug==='uploading-data'&&width===375&&theme==='light')||(slug==='reading-your-results'&&width===375&&theme==='dark'))await p.screenshot({path:`docs/manual-review/screenshots/${slug}-${width}-${theme}.png`,fullPage:true});
 }
 await p.close();
}
await browser.close();fs.writeFileSync('docs/manual-review/render-checks.json',JSON.stringify(reports,null,2)+'\n');
const failures=reports.filter(x=>x.overflow||x.brokenImages||x.authorText||x.errors.length||!x.figures);console.log(JSON.stringify({views:reports.length,failures},null,2));if(failures.length)process.exitCode=1;
