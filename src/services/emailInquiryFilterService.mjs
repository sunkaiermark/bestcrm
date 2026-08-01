const DEFAULT_KEEP = {
  status: 'new',
  category: 'inquiry',
  reason: 'manual_review',
  matchedRules: []
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
    domains: ['topseoagency.co']
  },
  {
    status: 'archived',
    category: 'newsletter',
    reason: 'industry_newsletter',
    domains: ['xprt.com']
  }
];

const blockingTextRules = [
  {
    status: 'spam',
    category: 'marketing_spam',
    reason: 'seo_marketing_pitch',
    patterns: [
      /\bseo\b/i,
      /\bbacklinks?\b/i,
      /\bguest post\b/i,
      /\bkeyword\b/i,
      /\btopseoagency\b/i
    ]
  }
];

const nonInquiryTextRules = [
  {
    status: 'archived',
    category: 'supplier_offer',
    reason: 'supplier_inventory_offer',
    patterns: [
      /\bavailable now\b/i,
      /\bstubbies\b/i,
      /\bnew paint\b/i,
      /\b\d+k gal\b/i
    ]
  },
  {
    status: 'archived',
    category: 'newsletter',
    reason: 'newsletter_or_product_alert',
    patterns: [
      /\bnewsletter\b/i,
      /\bproduct alerts?\b/i,
      /\bunsubscribe\b/i,
      /\bwaste\s*&\s*recycling product alerts?\b/i
    ]
  },
  {
    status: 'archived',
    category: 'system_notification',
    reason: 'advertising_platform_notice',
    patterns: [
      /google ads/i
    ]
  },
  {
    status: 'archived',
    category: 'finance_or_logistics',
    reason: 'finance_or_shipping_document',
    patterns: [
      /\bremittance advice\b/i,
      /\bpayment completed\b/i,
      /\bform e\b/i
    ]
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
    input.requirementText,
    input.rawPayload?.from?.name,
    input.rawPayload?.from?.address,
    input.rawPayload?.text
  ].map(text).filter(Boolean).join('\n');
}

function matchTextRule(rule, value) {
  const matchedPatterns = rule.patterns
    .filter((pattern) => pattern.test(value))
    .map((pattern) => pattern.source);
  return matchedPatterns.length
    ? {
      status: rule.status,
      category: rule.category,
      reason: rule.reason,
      matchedRules: matchedPatterns
    }
    : null;
}

function hasInquiryIntent(value) {
  return inquiryIntentPatterns.some((pattern) => pattern.test(value));
}

function decision(rule, matchedRules) {
  return {
    status: rule.status,
    category: rule.category,
    reason: rule.reason,
    matchedRules
  };
}

export function classifyEmailInquiryPayload(input = {}) {
  const fromAddress = lower(input.contactEmail || input.rawPayload?.from?.address);
  const fromDomain = emailDomain(fromAddress);
  const value = combinedText(input);

  for (const rule of exactSenderRules) {
    if (rule.senders.includes(fromAddress)) {
      return decision(rule, [fromAddress]);
    }
  }

  for (const rule of domainRules) {
    if (rule.domains.includes(fromDomain)) {
      return decision(rule, [fromDomain]);
    }
  }

  for (const rule of blockingTextRules) {
    const matched = matchTextRule(rule, value);
    if (matched) {
      return matched;
    }
  }

  if (hasInquiryIntent(value)) {
    return {
      ...DEFAULT_KEEP,
      reason: 'inquiry_intent',
      matchedRules: inquiryIntentPatterns
        .filter((pattern) => pattern.test(value))
        .map((pattern) => pattern.source)
    };
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
