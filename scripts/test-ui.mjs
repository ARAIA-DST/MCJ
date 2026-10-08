import {spawnSync} from 'node:child_process';
for(const args of [['node_modules/vite/bin/vite.js','build'],['tests/browser.mjs']]){
 const run=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,VITE_GAS_URL:'https://script.google.com/macros/s/TEST_EXEC/exec'}});
 if(run.status!==0)process.exit(run.status||1);
}
