import { z } from 'zod';
export class AiSourceError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function fail(status, code) { throw new AiSourceError(status, code); }
const text = (n) => z.string().trim().max(n);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/);
const time = z.string().datetime({ offset: true }).refine(v => Date.parse(v) <= Date.now() + 300000, 'future time');
const url = z.string().url().max(1500).refine(v => {
  const u = new URL(v);
  return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
}, 'public origin URL only');
export const channels = ['ai_project_search','website_form','web_chat','phone_consultation','email_reference'];
const attribution = z.object({ campaign: text(160).optional(), source: text(160).optional(), contributor: text(160).optional(), landing_page: url.optional() }).strict();
const project = z.object({ name: text(240).optional(), stage: text(160).optional(), registration_id: text(100).optional(), website_domain: z.string().max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i).optional(), discovered_at: time.optional(), published_at: time.nullable().optional(), search_task_id: id.optional(), verification: z.enum(['unverified','corroborated','conflicting']).default('unverified'), sources: z.array(z.object({ title: text(240), url, published_at: time.nullable().optional() }).strict()).max(30).default([]) }).strict();
const ai = z.object({ intent: z.enum(['project_intelligence','product_interest','technical_question','purchase_request','other']).optional(), urgency: z.enum(['low','normal','high','urgent']).optional(), summary: text(8000).optional(), confidence: z.number().min(0).max(1).optional(), follow_up_suggestion: text(2000).optional(), inferred_fields: z.array(text(120)).max(30).optional() }).strict();
const common = {
 external_event_id: id, idempotency_key: id, event_type: z.enum(['discovered','updated','consultation','follow_up']), occurred_at: time,
 source_channel: z.enum(channels), source_detail: text(500).optional(), original_session_id: text(160).optional(),
 summary: text(8000).optional(), language: z.string().max(35).regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/).optional(), ai: ai.optional()
};
export const submissionSchema = z.object({
 ...common, external_lead_id: id, title: z.string().trim().min(1).max(240),
 company_name: text(240).optional(), contact_name: text(160).optional(), job_title: text(160).optional(),
 email: z.string().email().max(254).transform(s=>s.trim().toLowerCase()).optional(),
 phone: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(), country_or_region: text(100).optional(), preferred_language: text(35).optional(),
 interested_products: z.array(text(160)).max(30).default([]), requirement_summary: z.string().trim().min(1).max(12000),
 estimated_value: z.object({ amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().nullable().optional(),
 expected_timing: text(240).nullable().optional(), consent_status: z.enum(['unknown','granted','denied','not_applicable']),
 consent_captured_at: time.nullable().optional(), data_origin: z.enum(['public_search','customer_provided','synthetic']),
 attribution: attribution.optional(), project: project.optional()
}).strict().superRefine((v,c)=>{if(v.consent_status==='granted'&&!v.consent_captured_at)c.addIssue({code:'custom',message:'consent time required',path:['consent_captured_at']});});
export const interactionSchema = z.object({ ...common, summary: z.string().trim().min(1).max(8000) }).strict();
export const evidenceSchema = z.object({ external_event_id:id, idempotency_key:id, occurred_at:time, interaction_event_id:id.optional(), sha256:z.string().regex(/^[a-f0-9]{64}$/), file_name:z.string().min(1).max(180).refine(v=>!/[\\/\x00-\x1f]/.test(v)&&!v.includes('..')), mime_type:z.enum(['application/pdf','image/png','image/jpeg','text/plain','audio/wav','audio/mpeg']), file_size:z.number().int().positive().max(25*1024*1024) }).strict();
export const reconciliationSchema=z.object({external_event_ids:z.array(id).min(1).max(100)}).strict();
export function parse(schema,input){const result=schema.safeParse(input);if(!result.success)fail(422,'invalid_payload');return result.data;}
export function positiveId(value){if(!/^[1-9]\d{0,14}$/.test(String(value)))fail(422,'invalid_id');return Number(value);}
export function uuid(value){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value)))fail(404,'not_found');return value;}
export function safeJson(buffer){try{return JSON.parse(buffer.toString('utf8'));}catch{fail(400,'invalid_json');}}
