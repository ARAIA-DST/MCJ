import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
export default defineConfig({
  root: 'frontend', base: process.env.PAGES_BASE || './',
  build: { outDir: '../dist', emptyOutDir: true, target:'es2022', chunkSizeWarningLimit: 650 },
  plugins:[{name:'offline-shell',closeBundle(){
    const files=[];
    const scan=(dir)=>{for(const f of fs.readdirSync(dir)){const p=path.join(dir,f);if(fs.statSync(p).isDirectory())scan(p);else if(!['sw.js','.nojekyll'].includes(f))files.push('./'+path.relative('dist',p).replaceAll('\\','/'));}};
    scan('dist');
    const sw=fs.readFileSync('frontend/public/sw.js','utf8').replace('__APP_SHELL__',JSON.stringify(files)).replace('__VERSION__','trw-'+Date.now());
    fs.writeFileSync('dist/sw.js',sw);fs.writeFileSync('dist/.nojekyll','');
  }}]
});
