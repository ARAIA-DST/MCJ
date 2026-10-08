/** All business tables carry immutable creation metadata. Extra tables isolate PII, auth rate limits, and recovery. */
var BASE_COLUMNS_ = ['id','created_at','created_by','updated_at'];
var COLUMNS_ = {
  Users:['username','name','role','pin_salt','pin_hash','active','area','workshop_ids'],
  Sessions:['token_hash','user_id','expires_at','revoked'],
  Outlets:['name','physical_key','area','address','lat','lng','active','booking_url','contact_label'],
  Workshops:['outlet_id','name','active'],
  Rotation:['user_id','outlet_id','week','week_start','week_end','status','plan_id'],
  Roster:['user_id','outlet_id','date','position','backup','status','rebook_of','plan_id'],
  Visits:['user_id','outlet_id','assignment_id','kind','date','started_at','submitted_at','lat','lng','accuracy','distance_m','gps_flags','permission','stock','posm','planogram','retailer_questions','competitor','interest','next_action','exception_id','status','review_note','reviewer_id','backcheck','backcheck_note'],
  VisitPhotos:['visit_id','outlet_id','user_id','kind','file_id','url','bytes','captured_at'],
  Surveys:['user_id','outlet_id','visit_id','week','eligible','consent','consent_at','required_complete','status','reviewer_id','review_note','customer_id'],
  SurveyAnswers:['survey_id','decision_driver','brand_preference','confidence','need','respondent_ref'],
  Exceptions:['visit_id','reason','note','status','reviewer_id','approval_note'],
  Leads:['user_id','outlet_id','category','need','contact_permission','owner_id','recipient_id','status','validated_at','sla_due_at','ack_at','next_action','outcome','verified_at','verified_by','transaction_ref','sale_value'],
  LeadContacts:['lead_id','name','phone'],
  LeadEvents:['lead_id','event','note','actor_id'],
  Training:['name','questions','pass_score','active','approved','version'],
  QuizResults:['user_id','training_id','training_version','score','answers','pass','practical_pass','practical_by','practical_at'],
  Customers:['name','phone','plate','brand','model','year','birthday','workshop_id','last_service_date','odometer','service_type','next_service_date','next_service_odometer','wa_opt_in','consent_at','consent_source','cycle_id','reminder_attempts','deleted'],
  Consents:['customer_id','opt_in','timestamp','source','actor_id','text_version','evidence','number_hash'],
  PointsLedger:['customer_id','points','reason','ref','expires_at'],
  VoucherTemplates:['name','type','value','min_spend','validity_days','eligible_workshops','quota','terms','active','approval_required','cost'],
  Vouchers:['customer_id','template_id','code','value','type','min_spend','terms','eligible_workshops','expires_at','status','approval_status','approved_by','message_id','redeemed_at','void_reason'],
  Redemptions:['voucher_id','customer_id','workshop_id','user_id','transaction_ref','spend','discount_value','estimated_cost'],
  Campaigns:['name','audience','template','voucher_template_id','scheduled_at','status','cursor','cycle_key','audience_ids','test_phone'],
  MessageLog:['customer_id','template','provider','status','error','attempts','next_retry_at','provider_id','sent_at','delivered_at','last_attempt_at','cycle_id','stage','voucher_id','campaign_id','campaign_cycle_id','dedupe_key','variables','manual_url'],
  Config:['key','value','description'],
  AuditLog:['actor_id','action','entity','entity_id','detail'],
  Requests:['actor_id','action','fingerprint','status','journal_file_id','response_json'],
  RateLimits:['key','window_start','count'],
  PrivacyJobs:['customer_id','operation','status','requested_by','completed_at'],
  ServiceEvents:['customer_id','workshop_id','date','kind','verified_by','transaction_ref','sale_value','return_ref','reminder_id'],
  WebhookEvents:['provider','event_id','payload_hash','status']
};
var ENUMS_ = {
  'Users.role':['spg','fm','supervisor','client_viewer','admin'],
  'Visits.status':['draft','pending','approved','rejected','client-approved exception'],
  'Exceptions.reason':['outlet_closed','no_permission','no_stock','other'],
  'Surveys.status':['pending','valid','rejected'],
  'Leads.status':['recorded','validated','handed_off','acknowledged','responded','closed'],
  'Vouchers.status':['issued','sent','delivered','redeemed','expired','void'],
  'VoucherTemplates.type':['fixed','percent','free_check','free_item'],
  'Campaigns.status':['draft','scheduled','running','paused','completed']
};
var JSON_COLUMNS_ = ['audience_ids','workshop_ids','gps_flags','stock','questions','answers','eligible_workshops','audience','variables','detail'];
var BOOL_COLUMNS_ = ['active','revoked','backup','permission','posm','planogram','eligible','consent','required_complete','contact_permission','approved','pass','practical_pass','wa_opt_in','opt_in','deleted','approval_required','backcheck'];
var NUMBER_COLUMNS_ = ['lat','lng','accuracy','distance_m','week','position','score','pass_score','confidence','year','odometer','next_service_odometer','reminder_attempts','points','value','min_spend','validity_days','quota','cost','spend','discount_value','estimated_cost','sale_value','attempts','cursor','count','bytes'];
var DEFAULT_CONFIG_ = {
  option_spg:true, option_fm:true, pilot_start:'2026-10-12', pilot_weeks:16,
  fm_target:2400, fm_threshold:2280, survey_target:800, surveys_per_workshop_week:10,
  sla_working_days:1, working_days:[1,2,3,4,5], holidays:[],
  wa_provider:'wa_link', quiet_start:8, quiet_end:19, frequency_per_7days:2,
  max_send_attempts:3, reminder_batch:25, reminder_stages:[-14,0,14],
  service_intervals:{general:6,brake_check:6,shock_absorber:6}, service_odometer_intervals:{general:10000,brake_check:10000,shock_absorber:20000}, projected_km_per_day:0, odometer_interval_km:10000,
  points_visit:10, points_verified_purchase:50, points_expiry_days:365,
  tier_gold:200, tier_platinum:500, retention_days:365, request_retention_days:180,
  voucher_after_survey:'', voucher_after_purchase:'', voucher_t14:'', voucher_winback:'',
  loyalty_require_approval:true,
  template_voucher_issued:'Halo {name}, terima kasih sudah servis di {workshop}. Voucher TRW Anda: {code} senilai {value}, berlaku s/d {expiry}. Tunjukkan kode ini ke bengkel. {link} Balas STOP untuk berhenti.',
  template_service_reminder:'Halo {name}, kendaraan {plate} dijadwalkan servis pada {next_service_date} di {workshop}. Yuk atur kunjungan: {link}. Balas STOP untuk berhenti.',
  template_win_back:'Halo {name}, kami menunggu Anda kembali ke {workshop} untuk pengecekan kendaraan {plate}. Voucher {code}: {value}, berlaku s/d {expiry}. Booking: {link}. Balas STOP untuk berhenti.',
  meta_template_voucher_issued:'voucher_issued', meta_template_service_reminder:'service_reminder', meta_template_win_back:'win_back',
  meta_language:'id', meta_variable_order:['name','code','value','expiry','workshop','plate','next_service_date','link'],
  meta_graph_version:'v24.0', consent_text_version:'wa-opt-in-v1',
  consent_text:'Saya setuju menerima voucher dan pengingat servis TRW melalui WhatsApp. Saya dapat berhenti kapan saja dengan membalas STOP.',
  sample_size:10
};
