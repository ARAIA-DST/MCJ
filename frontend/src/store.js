import {openDB} from 'idb';
export const dbPromise=openDB('trw-field-v1',1,{upgrade(db){db.createObjectStore('meta');const queue=db.createObjectStore('queue',{keyPath:'id'});queue.createIndex('owner','owner');db.createObjectStore('cache');db.createObjectStore('drafts',{keyPath:'id'});}});
export async function getMeta(key){return (await dbPromise).get('meta',key);}
export async function setMeta(key,value){return (await dbPromise).put('meta',value,key);}
export async function session(){return getMeta('session');}
export async function saveSession(s){await setMeta('session',s);}
export async function cached(owner,action,payload){return (await dbPromise).get('cache',owner+'|'+action+'|'+JSON.stringify(payload));}
export async function cache(owner,action,payload,data){return (await dbPromise).put('cache',{data,savedAt:Date.now()},owner+'|'+action+'|'+JSON.stringify(payload));}
export async function queueRows(owner){const rows=await(await dbPromise).getAllFromIndex('queue','owner',owner);return rows.sort((a,b)=>a.createdAt-b.createdAt||a.order-b.order);}
export async function enqueueBatch(owner,items,draft=null){const db=await dbPromise,tx=db.transaction(['queue','drafts'],'readwrite'),stamp=Date.now();for(let i=0;i<items.length;i++){const item=items[i];await tx.objectStore('queue').put({id:item.id||crypto.randomUUID(),owner,createdAt:stamp,order:i,action:item.action,payload:item.payload,dependsOn:item.dependsOn||[],status:'pending',attempts:0,nextAttempt:0,error:'',result:null});}if(draft)await tx.objectStore('drafts').put(draft);await tx.done;return items.map(i=>i.id);}
export async function patchQueue(id,patch){const db=await dbPromise,tx=db.transaction('queue','readwrite'),old=await tx.store.get(id);if(old)await tx.store.put({...old,...patch});await tx.done;}
export async function queueItem(id){return (await dbPromise).get('queue',id);}
export async function saveDraft(d){return (await dbPromise).put('drafts',d);}
export async function drafts(owner){return (await(await dbPromise).getAll('drafts')).filter(d=>d.owner===owner);}
export async function removeDraft(id){return (await dbPromise).delete('drafts',id);}
export async function purgeCompleted(owner){const db=await dbPromise,rows=await queueRows(owner),tx=db.transaction('queue','readwrite');const required=new Set(rows.filter(r=>r.status!=='done').flatMap(r=>r.dependsOn));for(const row of rows)if(row.status==='done'&&!required.has(row.id)&&row.createdAt<Date.now()-31*86400000)await tx.store.delete(row.id);await tx.done;}
export async function logoutLocal(owner){const db=await dbPromise,tx=db.transaction(['meta','cache'],'readwrite');await tx.objectStore('meta').delete('session');let cursor=await tx.objectStore('cache').openCursor();while(cursor){if(String(cursor.key).startsWith(owner+'|'))await cursor.delete();cursor=await cursor.continue();}await tx.done;}
