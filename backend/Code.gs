function response_(ok,data,error){return {ok:ok,data:data||null,error:error||null,serverTime:now_()};}
function jsonOutput_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function doGet(e){return jsonOutput_(response_(true,{name:'TRW Route to Preference',version:'1.0.0',status:'healthy',timezone:TZ_},null));}
function doPost(e){try{
  if(e&&e.parameter&&e.parameter.webhook)return jsonOutput_(response_(true,webhook_(e),null));
  assert_(e&&e.postData&&typeof e.postData.contents==='string','BAD_REQUEST','Body JSON diperlukan.');assert_(e.postData.contents.length<=1800000,'TOO_LARGE','Permintaan terlalu besar.');var request;
  try{request=JSON.parse(e.postData.contents);}catch(err){fail_('BAD_JSON','Body JSON tidak valid.');}
  assert_(request&&typeof request==='object'&&!Array.isArray(request),'BAD_REQUEST','Body tidak valid.');var route=ROUTES_[request.action];assert_(route,'UNKNOWN_ACTION','Action tidak dikenal.');id_(request.requestId);id_(request.clientId);assert_(request.payload&&typeof request.payload==='object'&&!Array.isArray(request.payload),'BAD_REQUEST','Payload object diperlukan.');
  var actor=request.action==='auth.login'?{id:'anonymous',role:'anonymous'}:auth_(request.token);role_(actor,route.roles);
  var data=route.write?transaction_(actor,request,function(ctx){return route.fn(ctx,request.payload,request.token);}):route.fn(readContext_(actor),request.payload,request.token);
  if(data&&data._error)return jsonOutput_(response_(false,null,data._error));return jsonOutput_(response_(true,data,null));
}catch(err){var code=err.code||'INTERNAL';if(code==='INTERNAL')console.error('TRW error: '+err.message);return jsonOutput_(response_(false,null,{code:code,message:code==='INTERNAL'?'Gangguan server. Coba kembali; hubungi admin bila berulang.':err.message}));}}
