/* Built locally: app-shell contains hashed bundles, Chart.js/idb/QR code included. */
const CACHE='__VERSION__';
const SHELL=__APP_SHELL__;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('trw-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  // Token-bearing cross-origin POSTs must never enter shared CacheStorage. API network-first fallback is owner-scoped IndexedDB in api.js.
  if(req.method!=='GET'||url.origin!==self.location.origin)return;
  if(req.mode==='navigate'){event.respondWith(fetch(req).then(resp=>{if(resp.ok){const clone=resp.clone();caches.open(CACHE).then(c=>c.put(new URL('./index.html',self.registration.scope),clone));}return resp;}).catch(async()=>await caches.match(new URL('./index.html',self.registration.scope))||new Response('Aplikasi belum tersimpan offline.',{status:503})));return;}
  event.respondWith((async()=>{const cache=await caches.open(CACHE),hit=await cache.match(req),update=fetch(req).then(resp=>{if(resp.ok)cache.put(req,resp.clone());return resp;});if(hit){event.waitUntil(update.catch(()=>{}));return hit;}return update.catch(()=>new Response('',{status:503}));})());
});
// Browser sessions cannot sync in a service worker without exposing auth or running module imports.
// Wake an open app; otherwise the next open/online event resumes the durable queue.
self.addEventListener('sync',event=>{if(event.tag==='trw-sync')event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients)client.postMessage({type:'SYNC_NOW'});}));});
