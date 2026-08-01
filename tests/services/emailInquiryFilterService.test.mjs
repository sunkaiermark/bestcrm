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
  assert.equal(filter.reason, 'inquiry_intent');
});

test('email filter archives Google Ads notifications before product keyword matching', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'Take action to optimize Steam Tube Dryer',
    contactName: 'Google Ads',
    contactEmail: 'ads-noreply@google.com',
    requirementText: 'Google Ads notification for Steam Tube Dryer assets.'
  });

  assert.deepEqual(filter, {
    status: 'archived',
    category: 'system_notification',
    reason: 'google_ads_notification',
    matchedRules: ['ads-noreply@google.com']
  });
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
  assert.equal(filter.reason, 'inquiry_intent');
});

test('email filter marks SEO outreach as spam', () => {
  const filter = classifyEmailInquiryPayload({
    subject: 'Re: few SEO opportunities',
    contactEmail: 'keyword.savvy@topseoagency.co',
    requirementText: 'We can help with backlinks and guest post placements.'
  });

  assert.equal(filter.status, 'spam');
  assert.equal(filter.reason, 'seo_outreach');
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
  assert.equal(inquiry.reviewNote, 'Auto-filtered email: google_ads_notification');
});
