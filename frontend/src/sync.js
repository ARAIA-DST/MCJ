import {session,queueRows,patchQueue,queueItem,purgeCompleted} from './store.js';
import {request} from './api.js';
const PERMANENT=['VALIDATION','FORBIDDEN','OPTION_DISABLED','EVIDENCE_REQUIRED','NOT_READY','CONSENT_REQUIRED','NOT_FOUND','CONFLICT','DUPLICATE','IDEMPOTENCY_CONFLICT','OPTED_OUT','EXPIRED','ALREADY_REDEEMED','NOT_ELIGIBLE','MIN_SPEND','APPROVAL_REQUIRED','TOO_LARGE','UNKNOWN_ACTION'];
let running=false;
export function syncEvent(detail={}){window.dispatchEvent(new CustomEvent('trw-sync',{detail}));}
export async function syncNow(){
  if(running||!navigator.onLine)return;
  const work=async()=>{running=true;syncEvent({running:true});try{const s=await session();if(!s)return;if(Date.parse(s.expiresAt)<=Date.now()){syncEvent({authExpired:true});return;}
    const rows=await queueRows(s.user.id);for(const row of rows){if(!navigator.onLine)break;if(!['pending','retry','sending'].includes(row.status)||row.nextAttempt>Date.now())continue;
      const deps=await Promise.all(row.dependsOn.map(queueItem));if(deps.some(d=>!d||d.status!=='done'))continue;
      await patchQueue(row.id,{status:'sending'});try{const result=await request(row.action,row.payload,row.id);await patchQueue(row.id,{status:'done',result,payload:{},error:''});}
      catch(e){if(e.code==='AUTH_EXPIRED'){await patchQueue(row.id,{status:'pending'});syncEvent({authExpired:true});break;}const permanent=PERMANENT.includes(e.code),attempts=row.attempts+1;await patchQueue(row.id,{status:permanent?'blocked':'retry',attempts,error:e.message,errorCode:e.code,nextAttempt:permanent?0:Date.now()+Math.min(300000,2000*2**Math.min(8,attempts))});if(!permanent)break;}
      syncEvent({running:true});
    }await purgeCompleted(s.user.id);
  }finally{running=false;syncEvent({running:false});}};
  if(navigator.locks)await navigator.locks.request('trw-sync',{ifAvailable:true},async lock=>{if(lock)await work();});else await work();
}
export async function scheduleSync(){try{const reg=await navigator.serviceWorker?.ready;if(reg&&'sync'in reg)await reg.sync.register('trw-sync');}catch{}syncNow();}
export function initSync(){window.addEventListener('online',()=>{syncEvent();syncNow();});window.addEventListener('offline',()=>syncEvent());navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='SYNC_NOW')syncNow();});setInterval(syncNow,30000);}
