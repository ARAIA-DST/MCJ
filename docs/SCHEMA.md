# Google Sheets schema

setup() creates 31 tables and a README sheet. Every business/internal row begins with id(UUID or stable request-derived ID), created_at, created_by, updated_at. All timestamps ISO8601; business dates YYYY-MM-DD, timezone Asia/Jakarta. Header order is strict and checked before I/O.

| Sheet | Columns after common metadata |
|---|---|
| Users | username, name, role, pin_salt, pin_hash, active, area, workshop_ids |
| Sessions | token_hash, user_id, expires_at, revoked |
| Outlets | name, physical_key, area, address, lat, lng, active, booking_url, contact_label |
| Workshops | outlet_id, name, active |
| Rotation | user_id, outlet_id, week, week_start, week_end, status, plan_id |
| Roster | user_id, outlet_id, date, position, backup, status, rebook_of, plan_id |
| Visits | user_id, outlet_id, assignment_id, kind, date, started_at, submitted_at, lat, lng, accuracy, distance_m, gps_flags, permission, stock, posm, planogram, retailer_questions, competitor, interest, next_action, exception_id, status, review_note, reviewer_id, backcheck, backcheck_note |
| VisitPhotos | visit_id, outlet_id, user_id, kind, file_id, url, bytes, captured_at |
| Surveys | user_id, outlet_id, visit_id, week, eligible, consent, consent_at, required_complete, status, reviewer_id, review_note, customer_id |
| SurveyAnswers | survey_id, decision_driver, brand_preference, confidence, need, respondent_ref |
| Exceptions | visit_id, reason, note, status, reviewer_id, approval_note |
| Leads | user_id, outlet_id, category, need, contact_permission, owner_id, recipient_id, status, validated_at, sla_due_at, ack_at, next_action, outcome, verified_at, verified_by, transaction_ref, sale_value |
| LeadContacts | lead_id, name, phone |
| LeadEvents | lead_id, event, note, actor_id |
| Training | name, questions, pass_score, active, approved, version |
| QuizResults | user_id, training_id, training_version, score, answers, pass, practical_pass, practical_by, practical_at |
| Customers | name, phone, plate, brand, model, year, birthday, workshop_id, last_service_date, odometer, service_type, next_service_date, next_service_odometer, wa_opt_in, consent_at, consent_source, cycle_id, reminder_attempts, deleted |
| Consents | customer_id, opt_in, timestamp, source, actor_id, text_version, evidence, number_hash |
| PointsLedger | customer_id, points, reason, ref, expires_at |
| VoucherTemplates | name, type, value, min_spend, validity_days, eligible_workshops, quota, terms, active, approval_required, cost |
| Vouchers | customer_id, template_id, code, value, type, min_spend, terms, eligible_workshops, expires_at, status, approval_status, approved_by, message_id, redeemed_at, void_reason |
| Redemptions | voucher_id, customer_id, workshop_id, user_id, transaction_ref, spend, discount_value, estimated_cost |
| Campaigns | name, audience, template, voucher_template_id, scheduled_at, status, cursor, cycle_key, audience_ids, test_phone |
| MessageLog | customer_id, template, provider, status, error, attempts, next_retry_at, provider_id, sent_at, delivered_at, last_attempt_at, cycle_id, stage, voucher_id, campaign_id, campaign_cycle_id, dedupe_key, variables, manual_url |
| Config | key, value, description |
| AuditLog | actor_id, action, entity, entity_id, detail |
| Requests | actor_id, action, fingerprint, status, journal_file_id, response_json |
| RateLimits | key, window_start, count |
| PrivacyJobs | customer_id, operation, status, requested_by, completed_at |
| ServiceEvents | customer_id, workshop_id, date, kind, verified_by, transaction_ref, sale_value, return_ref, reminder_id |
| WebhookEvents | provider, event_id, payload_hash, status |

## Types and validation

JSON columns: workshop_ids, gps_flags, stock, questions, answers, eligible_workshops, audience, variables, detail.

Boolean columns: active, revoked, backup, permission, posm, planogram, eligible, consent, required_complete, contact_permission, approved, pass, practical_pass, wa_opt_in, opt_in, deleted, approval_required, backcheck.

Numeric columns: lat, lng, accuracy, distance_m, week, position, score, pass_score, confidence, year, odometer, next_service_odometer, reminder_attempts, points, value, min_spend, validity_days, quota, cost, spend, discount_value, estimated_cost, sale_value, attempts, cursor, count, bytes. Config.value is deliberately a JSON string and excluded from numeric conversion.

All writes are batch range setValues. Contiguous changes are grouped, appends use one range, row grid grows when required. Enums have Sheet validations; API validation remains authoritative. Text with leading formula characters is escaped. Do not reorder headers or edit transactional rows during live use.

## Privacy

LeadContacts isolates personal lead contact details. Customers/Consents/MessageLog/Requests also contain sensitive data. Sheet protection only prevents editing; it does not hide data from editors. Share raw database only with trusted database owners. Client_viewer receives aggregate KPI, assigned opportunity summaries and voucher approval projections without customer identifiers/contact/code.

Requests stores actor+requestId hash, fingerprint, response and journal reference. Prepared journal files recover partial commits. Completed journals move to Drive trash; retention/erasure must include trash/archives and externally downloaded exports. IDs are stable within offline retries, not sequential spreadsheet row numbers.
