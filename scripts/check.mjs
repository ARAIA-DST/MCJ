import fs from 'node:fs';
import vm from 'node:vm';
const files=fs.readdirSync('backend').filter(f=>f.endsWith('.gs'));
for(const file of files)new vm.Script(fs.readFileSync('backend/'+file,'utf8'),{filename:file});
JSON.parse(fs.readFileSync('backend/appsscript.json','utf8'));JSON.parse(fs.readFileSync('frontend/public/manifest.webmanifest','utf8'));
const all=files.map(f=>fs.readFileSync('backend/'+f,'utf8')).join('\n'),context=vm.createContext({});vm.runInContext(all,context);
for(const [name,r]of Object.entries(context.ROUTES_)){if(typeof r.fn!=='function')throw new Error('Missing router handler: '+name);if(!r.roles?.length)throw new Error('Missing RBAC: '+name);}
console.log(`${files.length} Apps Script files parsed; ${Object.keys(context.ROUTES_).length} whitelisted routes resolved.`);
