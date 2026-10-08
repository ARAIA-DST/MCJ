import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{harness}=require('./gas-harness.cjs');
const root=path.resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));const file=fs.existsSync(p)&&fs.statSync(p).isDirectory()?path.join(p,'index.html'):p;if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(4173,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const outputs=[];const failures=[];
try{
  const ctx=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Jakarta'}),page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4173/?demo=1#today');await page.waitForSelector('.task-card');
  await page.screenshot({path:'docs/preview-desktop.png',fullPage:true});
  for(const size of [{width:1440,height:1000},{width:360,height:800}]){
    await page.setViewportSize(size);await page.screenshot({path:'docs/preview-'+(size.width===360?'mobile':'desktop')+'.png',fullPage:true});
    const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
    assert.ok(dims.scroll<=dims.width+1,'Page overflows viewport');
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    const violations=axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));outputs.push({page:'today',width:size.width,violations});if(violations.length)failures.push(...violations);
  }
  for(const view of ['reports','leads','loyalty','training','sync']){
    await page.goto('http://127.0.0.1:4173/?demo=1#'+view);await page.waitForTimeout(350);assert.ok(await page.locator('h1').count(),view+' header');const dims=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(dims<=1,view+' overflow');
  }
  assert.deepEqual(errors,[]);await ctx.close();
  const h=harness(),fm=h.rows('Users').find(u=>u.username==='fm1'),roster=h.rows('Roster').find(r=>r.user_id===fm.id&&!r.backup),outlet=h.rows('Outlets').find(o=>o.id===roster.outlet_id);
  const fieldCtx=await browser.newContext({viewport:{width:360,height:800},timezoneId:'Asia/Jakarta',geolocation:{latitude:outlet.lat,longitude:outlet.lng,accuracy:20},permissions:['geolocation']});
  await fieldCtx.route('https://script.google.com/macros/s/TEST_EXEC/exec',async route=>{const body=route.request().postDataJSON();const result=h.api(body.action,body.payload,body.token,body.requestId);await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});});
  const fieldPage=await fieldCtx.newPage();await fieldPage.clock.install({time:new Date('2026-10-12T02:00:00Z')});
  const browserErrors=[];fieldPage.on('pageerror',e=>browserErrors.push(e.message));
  await fieldPage.goto('http://127.0.0.1:4173/');await fieldPage.locator('[name=username]').fill('fm1');await fieldPage.locator('[name=pin]').fill('23456789');await fieldPage.locator('#login-form button[type=submit]').click();
  await fieldPage.waitForSelector('.task-card');
  await fieldPage.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await fieldCtx.setOffline(true);
  await fieldPage.locator('[data-start]').first().click();await fieldPage.locator('[data-gps]').click();await fieldPage.waitForSelector('.gps-result');await fieldPage.locator('[name=permission]').check();await fieldPage.locator('[data-next]').click();
  await fieldPage.locator('[name=posm]').check();await fieldPage.locator('[name=planogram]').check();await fieldPage.locator('[data-camera=before]').setInputFiles('frontend/public/assets/icon-192.png');await fieldPage.waitForSelector('.camera img');
  await fieldPage.locator('[data-camera=after]').setInputFiles('frontend/public/assets/icon-192.png');await fieldPage.waitForFunction(()=>document.querySelectorAll('.camera img').length===2);await fieldPage.locator('[data-next]').click();
  await fieldPage.locator('[name=retailer_questions]').fill('Butuh stok TRW brake pad');await fieldPage.locator('[name=next_action]').fill('Supervisor validasi kemudian client follow-up');await fieldPage.locator('[data-next]').click();await fieldPage.waitForSelector('.summary-row');await fieldPage.locator('[data-next]').click();await fieldPage.waitForSelector('.task-card');
  const getQueue=()=>fieldPage.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('trw-field-v1');request.onsuccess=()=>{const db=request.result,q=db.transaction('queue').objectStore('queue').getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);};}));
  assert.equal((await getQueue()).filter(r=>r.status!=='done').length,4);
  await fieldPage.reload();await fieldPage.waitForSelector('.task-card');assert.equal((await getQueue()).filter(r=>r.status!=='done').length,4);
  await fieldCtx.setOffline(false);await fieldPage.locator('[data-global=sync]').click();await fieldPage.waitForFunction(()=>new Promise(resolve=>{const r=indexedDB.open('trw-field-v1');r.onsuccess=()=>{const q=r.result.transaction('queue').objectStore('queue').getAll();q.onsuccess=()=>resolve(q.result.every(r=>r.status==='done'));};}),{timeout:20000});
  assert.equal(h.rows('Visits').length,1);assert.equal(h.rows('VisitPhotos').length,2);assert.equal(h.rows('Visits')[0].status,'pending');assert.deepEqual(browserErrors,[]);
  outputs.push({offlineFlow:'FM: capture offline → reload → reconnect → exactly one visit, two JPEG photos, pending review',passed:true});
  await fieldCtx.close();
  const spg=h.rows('Users').find(u=>u.username==='spg1'),rotation=h.rows('Rotation').find(r=>r.user_id===spg.id),spgOutlet=h.rows('Outlets').find(o=>o.id===rotation.outlet_id);
  const spgCtx=await browser.newContext({viewport:{width:360,height:800},timezoneId:'Asia/Jakarta',geolocation:{latitude:spgOutlet.lat,longitude:spgOutlet.lng,accuracy:20},permissions:['geolocation']});
  await spgCtx.route('https://script.google.com/macros/s/TEST_EXEC/exec',async route=>{const body=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(h.api(body.action,body.payload,body.token,body.requestId))});});
  const spgPage=await spgCtx.newPage();await spgPage.clock.install({time:new Date('2026-10-12T02:00:00Z')});
  await spgPage.goto('http://127.0.0.1:4173/');await spgPage.locator('[name=username]').fill('spg1');await spgPage.locator('[name=pin]').fill('23456789');await spgPage.locator('#login-form button[type=submit]').click();await spgPage.waitForSelector('.task-card');
  await spgPage.evaluate(async()=>{await navigator.serviceWorker.ready;});await spgCtx.setOffline(true);
  await spgPage.locator('[data-start]').first().click();await spgPage.locator('[data-gps]').click();await spgPage.waitForSelector('.gps-result');await spgPage.locator('[name=permission]').check();await spgPage.locator('[data-next]').click();
  await spgPage.locator('[name=posm]').check();await spgPage.locator('[name=planogram]').check();await spgPage.locator('[data-camera=before]').setInputFiles('frontend/public/assets/icon-192.png');await spgPage.waitForSelector('.camera img');await spgPage.locator('[data-camera=after]').setInputFiles('frontend/public/assets/icon-192.png');await spgPage.waitForFunction(()=>document.querySelectorAll('.camera img').length===2);await spgPage.locator('[data-next]').click();
  await spgPage.locator('[name=retailer_questions]').fill('Customer needs approved product explanation');await spgPage.locator('[name=next_action]').fill('Voluntary consent survey');await spgPage.locator('[data-next]').click();await spgPage.waitForSelector('.summary-row');await spgPage.locator('[data-next]').click();await spgPage.waitForSelector('.task-card');
  await spgPage.locator('[data-survey]').click();await spgPage.waitForSelector('dialog');await spgPage.locator('dialog [name=visit_id]').selectOption({index:1});await spgPage.locator('[name=respondent_ref]').fill('W01-R01');await spgPage.locator('[name=eligible]').check();await spgPage.locator('[name=consent]').check();await spgPage.locator('[name=brand_preference]').fill('TRW');await spgPage.locator('[name=need]').fill('Safety and reliable braking');await spgPage.locator('dialog button[type=submit]').click();await spgPage.waitForSelector('dialog',{state:'detached'});
  await spgCtx.setOffline(false);await spgPage.locator('[data-global=sync]').click();await spgPage.waitForFunction(()=>new Promise(resolve=>{const r=indexedDB.open('trw-field-v1');r.onsuccess=()=>{const q=r.result.transaction('queue').objectStore('queue').getAll();q.onsuccess=()=>resolve(q.result.length>=5&&q.result.every(r=>r.status==='done'));};}));
  assert.equal(h.rows('Visits').filter(v=>v.kind==='spg').length,1);assert.equal(h.rows('Surveys').length,1);outputs.push({offlineFlow:'SPG: offline visit plus consent survey → exactly one SPG visit, one pending survey',passed:true});await spgCtx.close();
  fs.writeFileSync('docs/browser-results.json',JSON.stringify({checks:outputs,failures},null,2));
  console.log(JSON.stringify({checks:outputs,failures},null,2));
  assert.equal(failures.length,0,'Accessibility violations remain');
}finally{await browser.close();await new Promise(r=>server.close(r));}
