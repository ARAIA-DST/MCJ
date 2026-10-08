# GAS API

POST to /exec. Content-Type: text/plain;charset=utf-8. Follow redirects. credentials:omit. No Authorization/custom header (avoids preflight).

~~~json
{"action":"me.today","token":"UUID_SESSION_TOKEN","payload":{},"clientId":"DEVICE_UUID","requestId":"STABLE_REQUEST_UUID"}
~~~

~~~json
{"ok":true,"data":{},"error":null,"serverTime":"2026-10-12T02:00:00.000Z"}
~~~

Errors have ok:false,data:null,error:{code,message}. Apps Script ContentService typically returns HTTP200 for application errors: always inspect ok. Never infer write success from HTTP200 alone. doGet is health only. Router denies non-whitelisted actions.

## Routes

| Action | Roles | Write |
|---|---|---|
| auth.login | anonymous | yes |
| auth.logout | spg, fm, supervisor, client_viewer, admin | yes |
| me.today | spg, fm, supervisor, client_viewer, admin | no |
| me.bootstrap | spg, fm, supervisor, client_viewer, admin | no |
| visit.start | spg, fm | yes |
| visit.submit | spg, fm | yes |
| visit.review | supervisor, admin | yes |
| photo.upload | spg, fm | yes |
| photo.read | spg, fm, supervisor, admin | no |
| survey.submit | spg | yes |
| survey.review | supervisor, admin | yes |
| lead.create | spg, fm | yes |
| lead.update | supervisor, admin, client_viewer | yes |
| lead.list | spg, fm, supervisor, client_viewer, admin | no |
| lead.contacts | supervisor, admin | no |
| training.list | spg, fm, supervisor, client_viewer, admin | no |
| training.submit | spg, fm | yes |
| training.practical | supervisor, admin | yes |
| training.save | admin | yes |
| report.kpi | spg, fm, supervisor, client_viewer, admin | no |
| report.export | supervisor, admin, client_viewer | no |
| customer.upsert | spg, fm, supervisor, admin | yes |
| customer.list | spg, fm, supervisor, admin | no |
| customer.optout | supervisor, admin | yes |
| customer.service | supervisor, admin, client_viewer | yes |
| customer.export | admin | no |
| customer.delete | admin | yes |
| voucher.templates | spg, fm, supervisor, client_viewer, admin | no |
| voucher.template.save | admin | yes |
| voucher.issue | spg, fm, supervisor, admin | yes |
| voucher.approve | client_viewer, admin | yes |
| voucher.list | spg, fm, supervisor, client_viewer, admin | no |
| voucher.send | supervisor, admin | yes |
| voucher.validate | spg, fm, supervisor, admin | no |
| voucher.redeem | spg, fm, supervisor, admin | yes |
| voucher.void | supervisor, admin | yes |
| campaign.save | admin | yes |
| campaign.preview | admin | no |
| campaign.run | admin | yes |
| campaign.test | admin | yes |
| campaign.list | admin | no |
| message.open | supervisor, admin | yes |
| message.status | supervisor, admin | yes |
| message.list | supervisor, admin | no |
| admin.setup | admin | no |
| admin.config | admin | yes |
| admin.user | admin | yes |
| admin.outlet | admin | yes |
| admin.list | supervisor, admin | no |
| rotation.generate | admin | yes |
| roster.generate | supervisor, admin | yes |
| roster.rebook | supervisor, admin | yes |

## Key payloads

| Action | Required or useful payload |
|---|---|
| auth.login | username, pin(string8–12digit); returns token,expiresAt,user |
| visit.start | visit_id(clientUUID),assignment_id,outlet_id,date,started_at,gps:{lat,lng,accuracy} |
| photo.upload | visit_id,photo_id(clientUUID),kind(before/after/exception),base64(no dataURI prefix),captured_at; max1280px JPEG/1MB |
| visit.submit | visit_id,permission,posm,planogram,stock:[{sku,qty}],retailer_questions,competitor,interest(none/low/medium/high),next_action; OR exception:{reason,note}+next_action |
| visit.review | visit_id,approve(boolean),note,backcheck,backcheck_note; exception approval also client_approval_ref |
| survey.submit | visit_id,eligible:true,consent:true,consent_at,customer_id(optional),answers:{decision_driver,brand_preference,confidence1–5,need,respondent_ref(anonymous stable workshop-week code)} |
| survey.review | survey_id,valid(boolean),note |
| lead.create | outlet_id,category,need,contact_permission,contact:{name,phone},next_action |
| lead.update | lead_id,event(validate/handoff/acknowledge/respond/outcome),note,next_action. validate:recipient_id+owner_id; respond:stock_response+price_response; sale:transaction_ref+sale_value |
| training.submit | training_id,answers:[selected index for each question] |
| training.practical | result_id,pass(boolean) |
| report.kpi | from,to optional dates; field role gets personal scope; pilotTarget2400,pilotThreshold2280 always returned |
| report.export | type:kpi/visits/leads/surveys; client only kpi. returns filename,mime,content |
| customer.upsert | name,phone,plate,brand,model,year,workshop_id,last_service_date,service_type(general/brake_check/shock_absorber),wa_opt_in,consent_confirmed,consent_source(spg/fm/workshop),consent_evidence; odometer,birthday,id optional |
| customer.service | customer_id,kind(visit/purchase),date,transaction_ref; purchase client only+sale_value; visit managers+odometer optional |
| voucher.issue | customer_id,template_id |
| voucher.approve | voucher_id,approve(boolean),reason ifreject |
| voucher.send | voucher_id; enqueuesdurableoutbox, doesnotpretenddelivered |
| message.open | message_id; managers only, rechecksconsent/window/cap then returnswa.me URL |
| message.status | message_id,sent:true; wa_linkmanualpending only, self-reported sent, notdelivered |
| voucher.validate | code,workshop_id; read-only servervalidation |
| voucher.redeem | code,workshop_id,spend,transaction_ref; serializedsingleuse |
| campaign.save | name,audience(object),template,voucher_template_id(optional),scheduled_at(ISO),status(draft/scheduled/paused),id optional |
| campaign.preview | campaign_id OR audience+template; admin,dryrunonly |
| campaign.run | campaign_id; onebatch, cursorcontinues bytrigger |
| campaign.test | phone,workshop_id,template,confirm_own_number:true |
| admin.config | values:{knownConfigKey:value}; no secrets |
| rotation.generate | start_date(Monday),user_ids(5readySPG),outlet_ids(optionalexact80) |
| roster.generate | date,user_ids(readyFM); dailyprimarydedup, six+backup |
| roster.rebook | roster_ids,date(newslot) |
| customer.export/delete | customer_id; admin only |

## Idempotency

Same actor+requestId+payload returns stored result. Reusing requestId for another payload returns IDEMPOTENCY_CONFLICT. Queue preserves requestId on retries, including timeouts. Handler writes are serialized with ScriptLock and recoverable journal; rate-limit denials retain counters. Personal data deletion may redact stored responses. Never mint another ID simply because the client did not receive a result.

## Webhook

Provider URL: /exec?webhook=fonnte&secret=HIGH_ENTROPY_SCRIPT_PROPERTY. Provider POST JSON incoming sender/message/STOP, or outgoing id/state/status/stateid. Authenticated event dedupe uses payload identifiers/hash. Unknown delivery state is not promoted to delivered. No business data on GET. Meta directcallback unsupported under requested doGet/headers constraints; see limitations.
