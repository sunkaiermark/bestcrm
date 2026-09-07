export const EMAIL_ENTRY_RULE_VERSION = 'spam-entry-v1';

export const EMAIL_ENTRY_DECISIONS = Object.freeze({
  ACCEPT: 'accept',
  MANUAL_REVIEW: 'manual_review',
  REJECT_SPAM: 'reject_spam'
});

const DEFAULT_KEEP = {
  status: 'new',
  category: 'inquiry',
  reason: 'manual_review',
  matchedRules: [],
  entryDecision: EMAIL_ENTRY_DECISIONS.MANUAL_REVIEW,
  ruleVersion: EMAIL_ENTRY_RULE_VERSION,
  spamScore: 0,
  spamSignals: [],
  protectedReasons: []
};

const exactSenderRules = [
  {
    status: 'archived',
    category: 'system_notification',
    reason: 'google_ads_notification',
    senders: [
      'ads-noreply@google.com',
      'ads-account-noreply@google.com',
      'ads-account-noreply@ads.google.com',
      'googleads-research-noreply@google.com'
    ]
  }
];

const domainRules = [
  {
    status: 'spam',
    category: 'marketing_spam',
    reason: 'seo_outreach',
    score: 8,
    signal: 'confirmed_spam_domain',
    domains: ['topseoagency.co']
  },
  {
    status: 'archived',
    category: 'newsletter',
    reason: 'industry_newsletter',
    domains: ['xprt.com']
  }
];

const nonInquiryTextRules = [
  {
    status: 'archived',
    category: 'supplier_offer',
    reason: 'supplier_inventory_offer',
    patterns: [/\bavailable now\b/i, /\bstubbies\b/i, /\bnew paint\b/i, /\b\d+k gal\b/i]
  },
  {
    status: 'archived',
    category: 'newsletter',
    reason: 'newsletter_or_product_alert',
    patterns: [/\bnewsletter\b/i, /\bproduct alerts?\b/i, /\bunsubscribe\b/i, /\bwaste\s*&\s*recycling product alerts?\b/i]
  },
  {
    status: 'archived',
    category: 'system_notification',
    reason: 'advertising_platform_notice',
    patterns: [/google ads/i]
  },
  {
    status: 'archived',
    category: 'finance_or_logistics',
    reason: 'finance_or_shipping_document',
    patterns: [/\bremittance advice\b/i, /\bpayment completed\b/i, /\bform e\b/i]
  }
];

const inquiryIntentPatterns = [
  /\brfq\b/i,
  /\brequest for quotation\b/i,
  /\bquotation\b/i,
  /\bquote\b/i,
  /\btechnical inquiry\b/i,
  /\binquiry\b/i,
  /\benquiry\b/i,
  /\bproposal review\b/i,
  /\bagitators?\b/i,
  /\bkneaders?\b/i,
  /\bdryers?\b/i,
  /\bevaporators?\b/i,
  /\bdosing pumps?\b/i
];

const strongCommercialIntentPatterns = [
  /\brfq\b/i,
  /\brequest for quotation\b/i,
  /\bplease (?:send|provide|revise|update|review|quote)\b/i,
  /\btechnical inquiry\b/i,
  /\bproposal review\b/i,
  /\bpurchase order\b/i,
  /\bquotation revision\b/i
];

const industrialProductPatterns = [
  /\bagitators?\b/i,
  /\bmixers?\b/i,
  /\bkneaders?\b/i,
  /\bdryers?\b/i,
  /\bevaporators?\b/i,
  /\bdosing pumps?\b/i,
  /\breactors?\b/i,
  /\bheat exchangers?\b/i,
  /\bprocess (?:equipment|system|line|plant)\b/i
];

const seoOutreachPatterns = [
  /\bseo\b/i,
  /\bbacklinks?\b/i,
  /\bguest posts?\b/i,
  /\bwebsite ranking\b/i,
  /\bkeyword ranking\b/i,
  /\bsearch engine ranking\b/i
];

const irrelevantServicePatterns = [
  /\bguest post placements?\b/i,
  /\blink building\b/i,
  /\bdigital marketing services?\b/i,
  /\bwebsite (?:design|development|promotion)\b/i,
  /\bseo services?\b/i,
  /\bseo (?:plan|audit|campaign|package|proposal)\b/i,
  /\blead generation services?\b/i,
  /\bsubmit (?:your|a) paper\b/i,
  /\bjournal publication\b/i,
  /\bpublication (?:offer|invitation|service)\b/i
];

const promotionalPatterns = [
  /\blimited[- ]time offer\b/i,
  /\bdiscount\b/i,
  /\bpromotion(?:al)?\b/i,
  /\bspecial offer\b/i,
  /\bbook a (?:free )?(?:call|consultation)\b/i
];

const businessDocumentPatterns = [
  /\b(?:attached|attachment)\b.{0,40}\b(?:drawing|specification|datasheet|rfq|quotation|purchase order|po)\b/i,
  /\b(?:drawing|specification|datasheet|rfq|quotation|purchase order|po)\b.{0,40}\b(?:attached|attachment)\b/i
];

function text(value) {
  return String(value || '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function emailDomain(address) {
  const normalized = lower(address);
  const index = normalized.lastIndexOf('@');
  return index === -1 ? '' : normalized.slice(index + 1);
}

function combinedText(input = {}) {
  return [
    input.subject,
    input.contactName,
    input.contactEmail,
    input.productInterest,
    input.opportunityType,
    input.requirementText,
    input.rawPayload?.from?.name,
    input.rawPayload?.from?.address,
    input.rawPayload?.text
  ].map(text).filter(Boolean).join('\n');
}

function baseDecision({
  status,
  category,
  reason,
  matchedRules = [],
  entryDecision = EMAIL_ENTRY_DECISIONS.ACCEPT,
  spamScore = 0,
  spamSignals = [],
  protectedReasons = []
}) {
  return {
    status,
    category,
    reason,
    matchedRules,
    entryDecision,
    ruleVersion: EMAIL_ENTRY_RULE_VERSION,
    spamScore,
    spamSignals,
    protectedReasons
  };
}

function automatedMailDecision(input = {}) {
  const headers = input.rawPayload?.headers || {};
  const autoSubmitted = lower(headers['auto-submitted']);
  const precedence = lower(headers.precedence);
  const listId = text(headers['list-id']);
  const listUnsubscribe = text(headers['list-unsubscribe']);

  if (autoSubmitted && autoSubmitted !== 'no') {
    return baseDecision({
      status: 'archived',
      category: 'system_notification',
      reason: 'automated_message',
      matchedRules: [`auto-submitted:${autoSubmitted}`]
    });
  }
  if (listId || listUnsubscribe || ['bulk', 'list', 'junk'].includes(precedence)) {
    return baseDecision({
      status: 'archived',
      category: 'newsletter',
      reason: 'mailing_list_headers',
      matchedRules: [
        listId ? 'list-id' : '',
        listUnsubscribe ? 'list-unsubscribe' : '',
        precedence ? `precedence:${precedence}` : ''
      ].filter(Boolean)
    });
  }
  return null;
}

function matchTextRule(rule, value) {
  const matchedPatterns = rule.patterns
    .filter((pattern) => pattern.test(value))
    .map((pattern) => pattern.source);
  return matchedPatterns.length
    ? baseDecision({
      status: rule.status,
      category: rule.category,
      reason: rule.reason,
      matchedRules: matchedPatterns
    })
    : null;
}

function matchingPatterns(patterns, value) {
  return patterns.filter((pattern) => pattern.test(value)).map((pattern) => pattern.source);
}

function hasInquiryIntent(value) {
  return inquiryIntentPatterns.some((pattern) => pattern.test(value));
}

function businessProtectionReasons(input, value) {
  const strongIntent = matchingPatterns(strongCommercialIntentPatterns, value);
  const productIntent = matchingPatterns(industrialProductPatterns, value);
  const hasBusinessDocumentAttachment = Array.isArray(input.rawPayload?.attachments)
    && input.rawPayload.attachments.length > 0
    && businessDocumentPatterns.some((pattern) => pattern.test(value));
  const reasons = [];
  if (strongIntent.length && (productIntent.length || text(input.productInterest))) {
    reasons.push('explicit_rfq_or_project_product_intent');
  }
  if (hasBusinessDocumentAttachment) {
    reasons.push('business_document_attachment');
  }
  return reasons;
}

function authenticationFailureSignal(input = {}) {
  const headers = input.rawPayload?.headers || {};
  const authentication = lower(headers['authentication-results']);
  const spf = lower(headers['received-spf']);
  const failedSpf = /\bspf=(?:fail|softfail)\b/.test(authentication) || /^fail\b/.test(spf);
  const failedDmarc = /\bdmarc=fail\b/.test(authentication);
  const failedDkim = /\bdkim=fail\b/.test(authentication);
  return failedSpf && (failedDmarc || failedDkim);
}

function spamEvidence(input, value, fromDomain) {
  let score = 0;
  const signals = [];
  const matchedRules = [];
  const blockedDomain = domainRules.find((rule) => rule.score && rule.domains.includes(fromDomain));
  if (blockedDomain) {
    score += blockedDomain.score;
    signals.push(blockedDomain.signal);
    matchedRules.push(fromDomain);
  }

  if (authenticationFailureSignal(input)) {
    score += 5;
    signals.push('authentication_failure_cluster');
    matchedRules.push('spf-and-dmarc-or-dkim-failure');
  }

  const seoMatches = matchingPatterns(seoOutreachPatterns, value);
  if (seoMatches.length >= 2) {
    score += 4;
    signals.push('seo_outreach_cluster');
    matchedRules.push(...seoMatches);
  }

  const serviceMatches = matchingPatterns(irrelevantServicePatterns, value);
  if (serviceMatches.length) {
    score += 4;
    signals.push('irrelevant_unsolicited_service');
    matchedRules.push(...serviceMatches);
  }

  const headers = input.rawPayload?.headers || {};
  const hasListHeaders = Boolean(text(headers['list-id']))
    || ['bulk', 'list', 'junk'].includes(lower(headers.precedence));
  if (hasListHeaders) {
    score += 3;
    signals.push('mailing_list_headers');
    matchedRules.push('mailing-list-header');
  }

  const hasUnsubscribe = Boolean(text(headers['list-unsubscribe'])) || /\bunsubscribe\b/i.test(value);
  const promoMatches = matchingPatterns(promotionalPatterns, value);
  if (hasUnsubscribe && promoMatches.length) {
    score += 3;
    signals.push('promotional_unsubscribe_cluster');
    matchedRules.push('unsubscribe', ...promoMatches);
  }

  const linkCount = (value.match(/https?:\/\//gi) || []).length;
  if (linkCount >= 5) {
    score += 2;
    signals.push('many_marketing_links');
    matchedRules.push('five-or-more-links');
  }

  return {
    score,
    signals: [...new Set(signals)],
    matchedRules: [...new Set(matchedRules)],
    blockedDomain
  };
}

export function classifyEmailInquiryPayload(input = {}) {
  const fromAddress = lower(input.contactEmail || input.rawPayload?.from?.address);
  const fromDomain = emailDomain(fromAddress);
  const value = combinedText(input);

  for (const rule of exactSenderRules) {
    if (rule.senders.includes(fromAddress)) {
      return baseDecision({ ...rule, matchedRules: [fromAddress] });
    }
  }

  for (const rule of domainRules.filter((candidate) => !candidate.score)) {
    if (rule.domains.includes(fromDomain)) {
      return baseDecision({ ...rule, matchedRules: [fromDomain] });
    }
  }

  if (fromDomain.endsWith('.google.com') && /\bgoogle ads\b/i.test(value)) {
    return baseDecision({
      status: 'archived',
      category: 'system_notification',
      reason: 'google_ads_notification',
      matchedRules: [fromDomain, 'google-ads-content']
    });
  }

  const protectedReasons = businessProtectionReasons(input, value);
  const evidence = spamEvidence(input, value, fromDomain);
  if (evidence.score >= 8 && protectedReasons.length === 0) {
    return baseDecision({
      status: 'spam',
      category: 'marketing_spam',
      reason: evidence.blockedDomain?.reason || 'spam_score_threshold',
      matchedRules: evidence.matchedRules,
      entryDecision: EMAIL_ENTRY_DECISIONS.REJECT_SPAM,
      spamScore: evidence.score,
      spamSignals: evidence.signals
    });
  }

  if (protectedReasons.length) {
    return baseDecision({
      status: 'new',
      category: 'inquiry',
      reason: 'protected_business_intent',
      matchedRules: matchingPatterns(inquiryIntentPatterns, value),
      entryDecision: evidence.score > 0
        ? EMAIL_ENTRY_DECISIONS.MANUAL_REVIEW
        : EMAIL_ENTRY_DECISIONS.ACCEPT,
      spamScore: evidence.score,
      spamSignals: evidence.signals,
      protectedReasons
    });
  }

  if (evidence.score >= 4) {
    return baseDecision({
      status: 'new',
      category: 'suspected_spam',
      reason: 'spam_score_review',
      matchedRules: evidence.matchedRules,
      entryDecision: EMAIL_ENTRY_DECISIONS.MANUAL_REVIEW,
      spamScore: evidence.score,
      spamSignals: evidence.signals
    });
  }

  const automated = automatedMailDecision(input);
  if (automated) {
    return automated;
  }

  if (hasInquiryIntent(value)) {
    return baseDecision({
      ...DEFAULT_KEEP,
      reason: 'inquiry_intent',
      entryDecision: EMAIL_ENTRY_DECISIONS.ACCEPT,
      matchedRules: matchingPatterns(inquiryIntentPatterns, value)
    });
  }

  for (const rule of nonInquiryTextRules) {
    const matched = matchTextRule(rule, value);
    if (matched) {
      return matched;
    }
  }

  return { ...DEFAULT_KEEP };
}

export function applyEmailInquiryFilter(inquiry) {
  const filter = classifyEmailInquiryPayload(inquiry);
  return {
    ...inquiry,
    status: filter.status,
    rawPayload: {
      ...(inquiry.rawPayload || {}),
      emailFilter: filter
    },
    reviewNote: filter.status === 'new'
      ? inquiry.reviewNote || ''
      : inquiry.reviewNote || `Auto-filtered email: ${filter.reason}`
  };
}
