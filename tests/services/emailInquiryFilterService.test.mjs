import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyEmailInquiryFilter,
  classifyEmailInquiryPayload
} from '../../src/services/emailInquiryFilterService.mjs';

test('email filter keeps clear RFQ and proposal messages in the active inbox', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'Request for Quotation (RFQ) & Technical Inquiry - Process Dosing Pumps',
    contactEmail: 'contact@segi.ma',
    requirementText: 'Please quote dosing pumps for our process project.'
  });

  assert.equal(filter.status, 'new');
  assert.equal(filter.reason, 'protected_business_intent');
  assert.equal(filter.entryDecision, 'accept');
  assert.deepEqual(filter.protectedReasons, ['explicit_rfq_or_project_product_intent']);
});

test('email filter archives Google Ads notifications before product keyword matching', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'Take action to optimize Steam Tube Dryer',
    contactName: 'Google Ads',
    contactEmail: 'ads-noreply@google.com',
    requirementText: 'Google Ads notification for Steam Tube Dryer assets.'
  });

  assert.equal(filter.status, 'archived');
  assert.equal(filter.category, 'system_notification');
  assert.equal(filter.reason, 'google_ads_notification');
  assert.equal(filter.entryDecision, 'accept');
  assert.deepEqual(filter.matchedRules, ['ads-noreply@google.com']);
});

test('email filter archives Google Ads notices from official Google subdomains', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'Schedule a consultation with a Google Ads specialist',
    contactEmail: 'campaigns@xwf.google.com',
    requirementText: 'Google Ads account recommendations with several campaign links.'
  });

  assert.equal(filter.status, 'archived');
  assert.equal(filter.reason, 'google_ads_notification');
  assert.equal(filter.entryDecision, 'accept');
});

test('email filter keeps proposal review threads even with newsletter footers', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'RE: [EXTERNAL] QS100 KNEADER PROPOSAL REVIEW',
    contactEmail: 'eduardo.soares@amorim.com',
    requirementText: [
      'Please review the updated kneader proposal.',
      '',
      'You can unsubscribe from automated mailing footers.'
    ].join('\n')
  });

  assert.equal(filter.status, 'new');
  assert.equal(filter.reason, 'protected_business_intent');
  assert.equal(filter.entryDecision, 'accept');
});

test('email filter marks SEO outreach as spam', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'Re: few SEO opportunities',
    contactEmail: 'keyword.savvy@topseoagency.co',
    requirementText: 'We can help with backlinks and guest post placements.'
  });

  assert.equal(filter.status, 'spam');
  assert.equal(filter.reason, 'seo_outreach');
  assert.equal(filter.entryDecision, 'reject_spam');
  assert.ok(filter.spamScore >= 8);
});

test('email filter never rejects on one weak marketing keyword', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'SEO question',
    contactEmail: 'unknown@example.com',
    requirementText: 'Can you advise on this keyword?'
  });

  assert.notEqual(filter.entryDecision, 'reject_spam');
  assert.equal(filter.spamScore, 0);
});

test('email filter rejects only a high-scoring outreach cluster without business protection', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'SEO and backlinks for your website ranking',
    contactEmail: 'outreach@example.com',
    requirementText: 'We sell SEO services and guest post placements.'
  });

  assert.equal(filter.entryDecision, 'reject_spam');
  assert.equal(filter.spamScore, 8);
  assert.deepEqual(filter.spamSignals, ['seo_outreach_cluster', 'irrelevant_unsolicited_service']);
});

test('email filter rejects multi-signal SEO plan and academic publication solicitations', () => {
  const seoPlan = classifyEmailInquiryPayload({
    subject: 'Your SEO plan is waiting',
    contactEmail: 'hello@getautoseo.com',
    requirementText: 'SEO keyword ranking and backlinks are included in our SEO plan.'
  });
  const journalPitch = classifyEmailInquiryPayload({
    subject: 'Submit your paper for publication',
    contactEmail: 'journal@example.org',
    requirementText: 'Submit your paper. Visit https://1.example https://2.example https://3.example https://4.example https://5.example',
    rawPayload: { headers: { 'list-id': 'journal.example.org' } }
  });

  assert.equal(seoPlan.entryDecision, 'reject_spam');
  assert.ok(seoPlan.spamScore >= 8);
  assert.equal(journalPitch.entryDecision, 'reject_spam');
  assert.ok(journalPitch.spamScore >= 8);
});

test('explicit RFQ and industrial product intent protects conflicting content for review', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'RFQ for industrial mixer',
    contactEmail: 'buyer@example.com',
    productInterest: 'Industrial mixer',
    requirementText: 'Please quote a mixer. Our footer mentions SEO services and guest post placements.'
  });

  assert.equal(filter.status, 'new');
  assert.equal(filter.entryDecision, 'manual_review');
  assert.equal(filter.spamScore, 8);
  assert.deepEqual(filter.protectedReasons, ['explicit_rfq_or_project_product_intent']);
});

test('an attached business document protects an uncertain message from rejection', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'Attached specification',
    contactEmail: 'buyer@example.com',
    requirementText: 'The attached specification also contains SEO and backlink reference notes. We use SEO services.',
    rawPayload: { attachments: [{ filename: 'process-specification.pdf', contentType: 'application/pdf' }] }
  });

  assert.equal(filter.status, 'new');
  assert.equal(filter.entryDecision, 'manual_review');
  assert.ok(filter.protectedReasons.includes('business_document_attachment'));
});

test('email filter archives finance and supplier messages without inquiry intent', () => {
  assert.equal(classifyEmailInquiryPayload({
    subject: 'Remittance Advice Completed for Sunkaier Industrial Technology Co',
    contactEmail: 'ap@example.com'
  }).status, 'archived');

  assert.equal(classifyEmailInquiryPayload({
    subject: 'AVAILABLE NOW: (14) 30K GAL STUBBIES',
    contactEmail: 'sales@example.com'
  }).status, 'archived');
});

test('email filter archives high-confidence automated and mailing-list headers', () => {
  const mailingList = classifyEmailInquiryPayload({
    subject: 'Weekly industry digest',
    contactEmail: 'digest@example.com',
    rawPayload: { headers: { 'list-id': 'industry.example.com', 'list-unsubscribe': '<mailto:leave@example.com>' } }
  });
  assert.equal(mailingList.status, 'archived');
  assert.equal(mailingList.category, 'newsletter');
  assert.equal(mailingList.reason, 'mailing_list_headers');
  assert.equal(mailingList.entryDecision, 'accept');
  assert.deepEqual(mailingList.matchedRules, ['list-id', 'list-unsubscribe']);

  assert.equal(classifyEmailInquiryPayload({
    subject: 'Automatic delivery status update',
    contactEmail: 'mailer-daemon@example.com',
    rawPayload: { headers: { 'auto-submitted': 'auto-generated' } }
  }).reason, 'automated_message');
});

test('applyEmailInquiryFilter stores the decision in raw payload', () => {
  const inquiry = applyEmailInquiryFilter({
    subject: 'Google Ads account notice',
    contactEmail: 'ads-account-noreply@ads.google.com',
    rawPayload: { messageId: 'msg-1' },
    reviewNote: ''
  });

  assert.equal(inquiry.status, 'archived');
  assert.equal(inquiry.rawPayload.messageId, 'msg-1');
  assert.equal(inquiry.rawPayload.emailFilter.reason, 'google_ads_notification');
  assert.equal(inquiry.rawPayload.emailFilter.entryDecision, 'accept');
  assert.equal(inquiry.reviewNote, 'Auto-filtered email: google_ads_notification');
});
