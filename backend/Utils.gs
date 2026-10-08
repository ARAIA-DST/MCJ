var TZ_ = 'Asia/Jakarta';
function now_(){return new Date().toISOString();}
function day_(date){return Utilities.formatDate(date ? new Date(date) : new Date(),TZ_,'yyyy-MM-dd');}
function today_(){return day_();}
function uuid_(){return Utilities.getUuid();}
function digest_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s),Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function equal_(a,b){a=String(a);b=String(b);var d=a.length^b.length;for(var i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;}
function fail_(code,message){var e=new Error(message);e.code=code;throw e;}
function assert_(condition,code,message){if(!condition)fail_(code,message);}
function str_(v,max,required){assert_(typeof v==='string'||v===undefined||v===null,'VALIDATION','Teks tidak valid.');var s=String(v||'').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');assert_(s.length<=(max||500),'VALIDATION','Teks terlalu panjang.');if(required)assert_(!!s,'VALIDATION','Kolom wajib belum diisi.');return s;}
function id_(v){var s=str_(v,100,true);assert_(/^[a-zA-Z0-9_-]{3,100}$/.test(s),'VALIDATION','ID tidak valid.');return s;}
function num_(v,min,max){assert_(v!==''&&v!==null&&v!==undefined,'VALIDATION','Angka wajib diisi.');var n=Number(v);assert_(Number.isFinite(n)&&n>=min&&n<=max,'VALIDATION','Angka di luar rentang.');return n;}
function date_(v){var s=str_(v,10,true);assert_(/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s+'T00:00:00+07:00'))&&day_(s+'T00:00:00+07:00')===s,'VALIDATION','Tanggal tidak valid.');return s;}
function iso_(v){var d=new Date(v);assert_(!isNaN(d.getTime()),'VALIDATION','Waktu tidak valid.');return d.toISOString();}
function one_(v,options){assert_(options.indexOf(v)!==-1,'VALIDATION','Pilihan tidak valid.');return v;}
function bool_(v){assert_(typeof v==='boolean','VALIDATION','Checkbox tidak valid.');return v;}
function listIds_(v){assert_(Array.isArray(v)&&v.length<=300,'VALIDATION','Daftar ID tidak valid.');return Array.from(new Set(v.map(id_)));}
function addDays_(s,n){return day_(new Date(new Date(s+'T12:00:00+07:00').getTime()+n*86400000));}
function addMonths_(s,n){var a=s.split('-').map(Number),d=new Date(Date.UTC(a[0],a[1]-1+n,1)),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();return d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2)+'-'+('0'+Math.min(a[2],last)).slice(-2);}
function dayDiff_(a,b){return Math.round((Date.parse(a+'T12:00:00+07:00')-Date.parse(b+'T12:00:00+07:00'))/86400000);}
function workingDue_(timestamp,days,config){var s=day_(timestamp),left=days;while(left>0){s=addDays_(s,1);var dow=new Date(s+'T12:00:00+07:00').getUTCDay();if(config.working_days.indexOf(dow)!==-1&&config.holidays.indexOf(s)===-1)left--;}return s+'T17:00:00+07:00';}
function haversine_(a,b,c,d){var r=Math.PI/180,x=Math.sin((c-a)*r/2),y=Math.sin((d-b)*r/2),q=x*x+Math.cos(a*r)*Math.cos(c*r)*y*y;return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));}
function phone_(v){var s=str_(v,30,true).replace(/[\s()-]/g,'');if(s.indexOf('08')===0)s='+62'+s.slice(1);else if(s.indexOf('62')===0)s='+'+s;assert_(/^\+628\d{7,11}$/.test(s),'VALIDATION','Nomor WhatsApp Indonesia harus berbentuk +628… atau 08….');return s;}
function plate_(v){var s=str_(v,20,true).toUpperCase().replace(/\s/g,'');assert_(/^[A-Z]{1,3}\d{1,4}[A-Z]{0,3}$/.test(s),'VALIDATION','Nomor polisi tidak valid.');return s;}
function url_(v){var s=str_(v,1000);assert_(!s||/^https:\/\/[a-z0-9.-]+(?::443)?(?:[/?#]|$)/i.test(s),'VALIDATION','URL harus HTTPS.');return s;}
function csv_(rows,columns){var esc=function(v){var s=typeof v==='object'?JSON.stringify(v):String(v===undefined?'':v);if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+[columns.map(esc).join(',')].concat(rows.map(function(r){return columns.map(function(c){return esc(r[c]);}).join(',');})).join('\r\n');}
function cleanPublicUser_(u){return {id:u.id,username:u.username,name:u.name,role:u.role,area:u.area};}
function gps_(p,o){var lat=num_(p.lat,-90,90),lng=num_(p.lng,-180,180),acc=num_(p.accuracy,0,50000),distance=haversine_(lat,lng,o.lat,o.lng);var flags=[];if(acc>100)flags.push('accuracy_over_100m');if(distance>200)flags.push('distance_over_200m');return {lat:lat,lng:lng,accuracy:acc,distance_m:Math.round(distance),gps_flags:flags};}
