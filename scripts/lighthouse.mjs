import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import lighthouse from 'lighthouse';
const root=path.resolve('dist'),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{let p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(fs.existsSync(p)&&fs.statSync(p).isDirectory())p=path.join(p,'index.html');if(!p.startsWith(root)||!fs.existsSync(p))return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(p)]||'application/octet-stream');fs.createReadStream(p).pipe(res);});
await new Promise(r=>server.listen(4173,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--remote-debugging-port=9222']});
try{
 const result=await lighthouse('http://127.0.0.1:4173/?demo=1#today',{port:9222,output:'json',onlyCategories:['performance','accessibility','best-practices'],logLevel:'error'});
 const scores=Object.fromEntries(Object.entries(result.lhr.categories).map(([k,v])=>[k,Math.round(v.score*100)]));
 fs.writeFileSync('docs/lighthouse-local.json',JSON.stringify(result.lhr,null,2));
 console.log(JSON.stringify({scores,environment:'local production build, mobile simulation, read-only demo; live GAS network not measured',failedAudits:Object.entries(result.lhr.audits).filter(([,v])=>v.score!==null&&v.score<1).map(([id,v])=>({id,title:v.title,score:v.score}))},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
