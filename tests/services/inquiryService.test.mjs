import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  CustomerApprovalRequiredError,
  approveInquiryCustomerApproval,
  canAccessInquiryInbox,
  canDeleteInquiry,
  canProcessInquiry,
  canViewInquiry,
  convertInquiryToOpportunity,
  createInquiry,
  markInquiryAsSpam,
  inquiryListFilterFor,
  rejectInquiryCustomerApproval,
  requestInquiryCustomerApproval,
  saveInquiryRecords,
  saveInquiryAsContact,
  saveInquiryAsCustomer,
  updateInquiryReview
} from '../../src/services/inquiryService.mjs';

const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };
const salesManager = { id: 2, roles: [ROLES.SALES_MANAGER] };
const quotationEngineer = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };

test('inquiry service exposes inbox to sales roles only', () => {
  assert.equal(canAccessInquiryInbox(salesperson), true);
  assert.equal(canAccessInquiryInbox(salesManager), true);
  assert.equal(canAccessInquiryInbox({ id: 99, roles: [ROLES.ADMINISTRATOR] }), true);
  assert.equal(canAccessInquiryInbox(quotationEngineer), false);

  assert.equal(canViewInquiry(salesperson, { assignedUserId: 7, createdBy: 8 }), true);
  assert.equal(canViewInquiry(salesperson, { assignedUserId: 8, createdBy: 7 }), true);
  assert.equal(canViewInquiry(salesperson, { assignedUserId: 8, createdBy: 9 }), false);
  assert.equal(canViewInquiry(salesManager, { assignedUserId: 8, createdBy: 9 }), true);
  assert.equal(canDeleteInquiry(salesperson), false);
  assert.equal(canDeleteInquiry({ id: 99, roles: [ROLES.ADMINISTRATOR] }), true);
  assert.equal(canProcessInquiry({ status: 'reviewing' }), true);
  assert.equal(canProcessInquiry({ status: 'customer_approval_pending' }), false);
  assert.equal(canProcessInquiry({ status: 'customer_saved' }), false);
});

test('inquiry list filter limits salesperson visibility', () => {
  assert.deepEqual(inquiryListFilterFor(salesperson, { status: 'new', source: 'email' }), {
    status: 'new',
    source: 'email',
    visibleToUserId: 7
  });
  assert.deepEqual(inquiryListFilterFor(salesManager, { assignedUserId: '7', status: 'spam', source: 'bad' }), {
    assignedUserId: 7,
    status: 'spam'
  });
  assert.deepEqual(inquiryListFilterFor(salesperson, {}), {
    excludeStatuses: ['converted', 'contact_saved', 'customer_saved', 'spam', 'duplicate', 'archived'],
    visibleToUserId: 7
  });
});

test('createInquiry normalizes input and requires requirement text', async () => {
  const calls = [];
  const inquiryRepository = {
    async createInquiry(input) {
      calls.push(input);
      return { id: 10, ...input };
    }
  };

  const inquiry = await createInquiry(inquiryRepository, salesperson, {
    source: 'email',
    subject: ' RFQ ',
    companyName: ' Acme ',
    contactEmail: 'ALICE@EXAMPLE.COM ',
    productInterest: ' Evaporator ',
    requirementText: ' Need quote ',
    priority: 'urgent'
  });

  assert.equal(inquiry.id, 10);
  assert.deepEqual(calls, [{
    source: 'email',
    sourceReference: '',
    sourceReceivedAt: null,
    subject: 'RFQ',
    companyName: 'Acme',
    contactName: '',
    contactEmail: 'alice@example.com',
    contactPhone: '',
    country: '',
    productInterest: 'Evaporator',
    opportunityType: '',
    requirementText: 'Need quote',
    rawPayload: {},
    priority: 'urgent',
    status: 'new',
    assignedUserId: 7,
    matchedCustomerId: null,
    matchedContactId: null,
    createdBy: 7,
    reviewNote: ''
  }]);

  await assert.rejects(() => createInquiry(inquiryRepository, salesperson, {
    requirementText: ''
  }), /Requirement is required/);
});

test('updateInquiryReview validates matched customer and contact', async () => {
  const calls = [];
  const repositories = {
    inquiryRepository: {
      async updateReview(id, input) {
        calls.push(['updateReview', id, input]);
        return { id, ...input };
      }
    },
    customerRepository: {
      async getCustomerDetail(id) {
        calls.push(['getCustomer', id]);
        return { id, ownerUserId: 7 };
      }
    },
    contactRepository: {
      async getContactDetail(id) {
        calls.push(['getContact', id]);
        return { id, customerId: 20 };
      }
    }
  };

  await updateInquiryReview(repositories, salesperson, {
    id: 11,
    assignedUserId: 7,
    status: 'new',
    priority: 'normal',
    subject: 'RFQ',
    companyName: 'Acme',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '123',
    country: 'Singapore',
    productInterest: 'Dryer',
    opportunityType: 'Expansion',
    requirementText: 'Need a dryer'
  }, {
    status: 'reviewing',
    priority: 'high',
    assignedUserId: '7',
    matchedCustomerId: '20',
    matchedContactId: '30',
    reviewNote: 'Qualified'
  });

  assert.deepEqual(calls, [
    ['getCustomer', 20],
    ['getContact', 30],
    ['updateReview', 11, {
      status: 'reviewing',
      priority: 'high',
      assignedUserId: 7,
      matchedCustomerId: 20,
      matchedContactId: 30,
      subject: 'RFQ',
      companyName: 'Acme',
      contactName: 'Alice',
      contactEmail: 'alice@example.com',
      contactPhone: '123',
      country: 'Singapore',
      productInterest: 'Dryer',
      opportunityType: 'Expansion',
      requirementText: 'Need a dryer',
      reviewNote: 'Qualified',
      reviewedBy: 7
    }]
  ]);
});

test('convertInquiryToOpportunity creates draft opportunity and marks inquiry converted', async () => {
  const calls = [];
  const repositories = {
    inquiryRepository: {
      async markConverted(id, input) {
        calls.push(['markConverted', id, input]);
        return { id, ...input, status: 'converted' };
      }
    },
    customerRepository: {
      async getCustomerDetail(id) {
        calls.push(['getCustomer', id]);
        return { id, ownerUserId: 7 };
      }
    },
    contactRepository: {
      async getContactDetail(id) {
        calls.push(['getContact', id]);
        return { id, customerId: 20, customerOwnerUserId: 7 };
      }
    },
    opportunityRepository: {
      async createOpportunity(input) {
        calls.push(['createOpportunity', input]);
        return { id: 40, ...input };
      }
    }
  };

  const opportunity = await convertInquiryToOpportunity(repositories, salesperson, {
    id: 11,
    subject: 'Need evaporator quote',
    productInterest: 'Evaporator',
    opportunityType: 'Expansion',
    requirementText: 'Need wastewater evaporation package.',
    matchedCustomerId: 20,
    matchedContactId: 30,
    assignedUserId: 7,
    status: 'reviewing'
  }, {});

  assert.equal(opportunity.id, 40);
  assert.deepEqual(calls, [
    ['getCustomer', 20],
    ['getContact', 30],
    ['createOpportunity', {
      opportunityNo: null,
      title: 'Need evaporator quote',
      customerId: 20,
      primaryContactId: 30,
      requirement: 'Need wastewater evaporation package.',
      estimatedAmount: null,
      productInterest: 'Evaporator',
      projectType: 'Expansion',
      deliveryCycle: '',
      expectedBidDate: null,
      status: 'draft',
      salespersonId: 7
    }],
    ['markConverted', 11, {
      matchedCustomerId: 20,
      matchedContactId: 30,
      convertedOpportunityId: 40,
      reviewedBy: 7
    }]
  ]);
});

test('conversion can create missing customer and contact from extracted inquiry fields', async () => {
  const calls = [];
  const repositories = {
    inquiryRepository: {
      async markConverted(id, input) {
        calls.push(['markConverted', id, input]);
        return { id, ...input, status: 'converted' };
      }
    },
    customerRepository: {
      async findDuplicatesByName() {
        return [];
      },
      async createCustomer(input) {
        calls.push(['createCustomer', input]);
        return { id: 20, ...input };
      },
      async getCustomerDetail(id) {
        return { id, ownerUserId: 7 };
      }
    },
    contactRepository: {
      async createContact(input) {
        calls.push(['createContact', input]);
        return { id: 30, ...input };
      },
      async getContactDetail(id) {
        return { id, customerId: 20, customerOwnerUserId: 7 };
      }
    },
    opportunityRepository: {
      async createOpportunity(input) {
        calls.push(['createOpportunity', input]);
        return { id: 40, ...input };
      }
    }
  };

  const opportunity = await convertInquiryToOpportunity(repositories, salesperson, {
    id: 11,
    status: 'new',
    assignedUserId: 7,
    subject: 'New line RFQ',
    companyName: 'Acme',
    country: 'United States',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '123',
    productInterest: 'Evaporator',
    opportunityType: 'Expansion',
    requirementText: 'Need quote',
    matchedCustomerId: null,
    matchedContactId: null
  }, { createMissingRecords: '1' });

  assert.equal(opportunity.customerId, 20);
  assert.equal(opportunity.primaryContactId, 30);
  assert.equal(calls.find((call) => call[0] === 'createCustomer')[1].name, 'Acme');
  assert.equal(calls.find((call) => call[0] === 'createContact')[1].email, 'alice@example.com');
  assert.equal(calls.find((call) => call[0] === 'createOpportunity')[1].productInterest, 'Evaporator');
  assert.equal(calls.find((call) => call[0] === 'createOpportunity')[1].projectType, 'Expansion');
});

test('conversion requires approval instead of duplicating another salesperson customer', async () => {
  const repositories = {
    inquiryRepository: {},
    customerRepository: {
      async getCustomerDetail(id) {
        return { id, name: 'Acme', ownerUserId: 8 };
      }
    },
    contactRepository: {},
    opportunityRepository: {
      async createOpportunity() {
        assert.fail('opportunity must not be created before approval');
      }
    }
  };

  await assert.rejects(
    () => convertInquiryToOpportunity(repositories, salesperson, {
      id: 11,
      status: 'reviewing',
      assignedUserId: 7,
      subject: 'Acme project',
      requirementText: 'Need quote',
      matchedCustomerId: 20,
      matchedContactId: null
    }, {}),
    (error) => error instanceof CustomerApprovalRequiredError
      && error.customer.ownerUserId === 8
  );
});

test('cross-sales customer request is assigned to a sales manager with proposed contact and opportunity data', async () => {
  const calls = [];
  const repositories = {
    customerRepository: {
      async getCustomerDetail(id) {
        return { id, name: 'Acme', ownerUserId: 8 };
      }
    },
    contactRepository: {},
    approvalSettingRepository: {
      async findActiveByKey(key) {
        calls.push(['findSetting', key]);
        return null;
      }
    },
    userRepository: {
      async listUsersWithRoles() {
        return [{ id: 2, displayName: 'Sales Manager', isActive: true, roles: [ROLES.SALES_MANAGER] }];
      }
    },
    inquiryCustomerApprovalRepository: {
      async createPending(input) {
        calls.push(['createPending', input]);
        return { id: 80, status: 'pending', ...input };
      }
    }
  };

  const approval = await requestInquiryCustomerApproval(repositories, salesperson, {
    id: 11,
    status: 'reviewing',
    assignedUserId: 7,
    companyName: 'Acme',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    productInterest: 'Evaporator',
    opportunityType: 'Expansion',
    requirementText: 'Need quote',
    subject: 'Acme project'
  }, {
    approvalCustomerId: '20',
    contactName: 'Alice Ahmed',
    contactEmail: 'alice.ahmed@example.com',
    requirementText: 'Updated requirement',
    opportunityType: 'New project'
  });

  assert.equal(approval.reviewerUserId, 2);
  assert.deepEqual(calls[0], ['findSetting', 'inquiry_customer_access']);
  assert.deepEqual(calls[1][1], {
    inquiryId: 11,
    customerId: 20,
    requestedBy: 7,
    customerOwnerUserId: 8,
    reviewerUserId: 2,
    matchedContactId: null,
    requestPayload: {
      primaryContactId: null,
      newContactName: 'Alice Ahmed',
      newContactTitle: '',
      newContactPhone: '',
      newContactEmail: 'alice.ahmed@example.com',
      newContactNotes: 'Updated requirement',
      title: 'Acme project',
      requirement: 'Updated requirement',
      estimatedAmount: null,
      productInterest: 'Evaporator',
      projectType: 'New project',
      deliveryCycle: '',
      expectedBidDate: null
    }
  });
});

test('sales manager approval creates the opportunity for the requesting salesperson', async () => {
  const calls = [];
  const repositories = {
    inquiryCustomerApprovalRepository: {
      async findById(id) {
        calls.push(['findApproval', id]);
        return {
          id: 80,
          inquiryId: 11,
          customerId: 20,
          requestedBy: 7,
          reviewerUserId: 2,
          status: 'pending',
          requestPayload: {
            primaryContactId: null,
            newContactName: 'Alice',
            title: 'Acme project',
            requirement: 'Need quote'
          }
        };
      },
      async completeApproval(id, input) {
        calls.push(['complete', id, input]);
        return { id: 40, customerId: 20, salespersonId: 7, title: input.title };
      }
    },
    contactRepository: {}
  };

  const opportunity = await approveInquiryCustomerApproval(repositories, salesManager, {
    id: 11,
    status: 'customer_approval_pending'
  }, 80, { decisionNote: 'Approved for collaboration' });

  assert.equal(opportunity.id, 40);
  assert.deepEqual(calls, [
    ['findApproval', 80],
    ['complete', 80, {
      primaryContactId: null,
      newContactName: 'Alice',
      title: 'Acme project',
      requirement: 'Need quote',
      decidedBy: 2,
      decisionNote: 'Approved for collaboration',
      allowAnyReviewer: false,
      inquiryId: 11
    }]
  ]);
});

test('sales manager rejection requires a reason and returns the inquiry to the requester', async () => {
  const calls = [];
  const repositories = {
    inquiryCustomerApprovalRepository: {
      async rejectAndReturnInquiry(id, input) {
        calls.push([id, input]);
        return { id, status: 'rejected' };
      }
    }
  };
  const pendingInquiry = { id: 11, status: 'customer_approval_pending' };

  await assert.rejects(
    () => rejectInquiryCustomerApproval(repositories, salesManager, pendingInquiry, 80, {}),
    /Decision note is required/
  );
  await rejectInquiryCustomerApproval(repositories, salesManager, pendingInquiry, 80, {
    decisionNote: 'Use another customer'
  });

  assert.deepEqual(calls, [[80, {
    decidedBy: 2,
    decisionNote: 'Use another customer',
    allowAnyReviewer: false,
    inquiryId: 11
  }]]);
});

test('saveInquiryRecords creates one customer and contact then closes the inquiry', async () => {
  const calls = [];
  const repositories = {
    inquiryRepository: {
      async markDisposition(id, input) {
        calls.push(['markDisposition', id, input]);
        return { id, ...input };
      }
    },
    customerRepository: {
      async findDuplicatesByName() {
        return [];
      },
      async createCustomer(input) {
        calls.push(['createCustomer', input]);
        return { id: 20, ownerUserId: 7, ...input };
      },
      async getCustomerDetail(id) {
        return { id, ownerUserId: 7 };
      }
    },
    contactRepository: {
      async createContact(input) {
        calls.push(['createContact', input]);
        return { id: 30, ...input };
      }
    }
  };

  await saveInquiryRecords(repositories, salesperson, {
    id: 11,
    assignedUserId: 7,
    status: 'reviewing',
    companyName: 'Acme',
    country: 'Oman',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '123',
    requirementText: 'Original requirement',
    matchedCustomerId: null,
    matchedContactId: null,
    reviewNote: ''
  }, { requirementText: 'Corrected requirement' });

  assert.equal(calls.find((call) => call[0] === 'createCustomer')[1].notes, 'Corrected requirement');
  assert.equal(calls.find((call) => call[0] === 'createContact')[1].notes, 'Corrected requirement');
  assert.equal(calls.find((call) => call[0] === 'markDisposition')[2].status, 'contact_saved');
});

test('inquiry dispositions save an existing customer, create a contact, and prevent a second action', async () => {
  const calls = [];
  const repositories = {
    inquiryRepository: {
      async markDisposition(id, input) {
        calls.push(['markDisposition', id, input]);
        return { id, ...input };
      }
    },
    customerRepository: {
      async getCustomerDetail(id) {
        calls.push(['getCustomer', id]);
        return { id, ownerUserId: 7 };
      }
    },
    contactRepository: {
      async createContact(input) {
        calls.push(['createContact', input]);
        return { id: 31, ...input };
      },
      async getContactDetail() {
        return null;
      }
    }
  };
  const inquiry = {
    id: 11,
    assignedUserId: 7,
    status: 'reviewing',
    companyName: 'Acme',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '123',
    requirementText: 'Need quote',
    reviewNote: ''
  };

  await saveInquiryAsCustomer(repositories, salesperson, inquiry, { customerId: '20' });
  await saveInquiryAsContact(repositories, salesperson, inquiry, { customerId: '20' });

  assert.deepEqual(calls.filter((call) => call[0] === 'markDisposition').map((call) => call[2].status), [
    'customer_saved',
    'contact_saved'
  ]);
  assert.deepEqual(calls.find((call) => call[0] === 'createContact')[1], {
    customerId: 20,
    name: 'Alice',
    title: '',
    phone: '123',
    email: 'alice@example.com',
    wechat: '',
    educationBackground: '',
    workExperience: '',
    keyAchievements: '',
    notes: 'Need quote'
  });

  await assert.rejects(
    () => markInquiryAsSpam(repositories.inquiryRepository, salesperson, { ...inquiry, status: 'contact_saved' }),
    /Inquiry already processed/
  );
});

test('markInquiryAsSpam records the final spam disposition', async () => {
  const calls = [];
  const inquiryRepository = {
    async markDisposition(id, input) {
      calls.push([id, input]);
      return { id, ...input };
    }
  };
  await markInquiryAsSpam(inquiryRepository, salesperson, {
    id: 12,
    assignedUserId: 7,
    status: 'new',
    reviewNote: ''
  }, { reviewNote: 'SEO solicitation' });
  assert.equal(calls[0][1].status, 'spam');
  assert.equal(calls[0][1].reviewNote, 'SEO solicitation');
});
