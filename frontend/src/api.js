import {GAS_URL,IS_CONFIGURED} from './config.js';
import {session,cache,cached,getMeta,setMeta} from './store.js';
export class ApiError extends Error{constructor(code,message){super(message);this.code=code;}}
export async function request(action,payload={},requestId=crypto.randomUUID(),opts={}){
  if(!IS_CONFIGURED)throw new ApiError('CONFIG_REQUIRED','Isi VITE_GAS_URL lalu build/deploy kembali.');
  const s=await session();let clientId=await getMeta('clientId');if(!clientId){clientId=crypto.randomUUID();await setMeta('clientId',clientId);}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),action==='photo.upload'?90000:60000);
  try{
    const resp=await fetch(GAS_URL,{method:'POST',mode:'cors',redirect:'follow',credentials:'omit',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token:s?.token||'',payload,clientId,requestId}),signal:controller.signal,cache:'no-store'});
    const raw=await resp.text();let json;try{json=JSON.parse(raw);}catch{throw new ApiError('DEPLOYMENT_ERROR','Respons bukan JSON. Periksa deployment Web App: Execute as Me, akses Anyone, URL /exec.');}
    if(!json.ok)throw new ApiError(json.error?.code||'SERVER_ERROR',json.error?.message||'Permintaan gagal.');return json.data;
  }catch(e){if(e instanceof ApiError)throw e;throw new ApiError('NETWORK','Koneksi terputus atau timeout. Data antrean tetap disimpan.');}finally{clearTimeout(timer);}
}
export async function read(action,payload={},opts={}){
  const s=await session();if(!s)throw new ApiError('AUTH_EXPIRED','Login diperlukan.');
  try{const data=await request(action,payload);if(!opts.sensitive)await cache(s.user.id,action,payload,data);return {data,offline:false};}
  catch(e){if(['NETWORK','CONFIG_REQUIRED'].includes(e.code)&&!opts.sensitive){const fallback=await cached(s.user.id,action,payload);if(fallback)return {data:fallback.data,offline:true,savedAt:fallback.savedAt};}throw e;}
}
