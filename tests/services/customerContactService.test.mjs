import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMaintainContact,
  canMaintainCustomer,
  archiveCustomer,
  createCustomer,
  DuplicateCustomerError,
  normalizeCustomerWebsite,
  reopenCustomer,
  updateCustomer
} from '../../src/services/customerService.mjs';
import {
  archiveContact,
  createContact,
  DuplicateContactError,
  reopenContact,
  updateContact
} from '../../src/services/contactService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('salesperson maintains only owned customer records', () => {
  assert.equal(canMaintainCustomer({ id: 7, roles: [ROLES.SALESPERSON] }, { ownerUserId: 7 }), true);
  assert.equal(canMaintainCustomer({ id: 8, roles: [ROLES.SALESPERSON] }, { ownerUserId: 7 }), false);
});

test('administrator maintains all customer and contact records', () => {
  const admin = { id: 99, roles: [ROLES.ADMINISTRATOR] };
  assert.equal(canMaintainCustomer(admin, { ownerUserId: 7 }), true);
  assert.equal(canMaintainContact(admin, { customerOwnerUserId: 7 }), true);
});

test('createCustomer defaults ownership to current salesperson', async () => {
  const calls = [];
  const customerRepository = {
    async createCustomer(input) {
      calls.push(input);
      return { id: 10, ...input };
    }
  };

  const customer = await createCustomer(customerRepository, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    name: 'Acme Co',
    website: 'www.acme.example',
    industry: 'Manufacturing',
    country: 'China',
    region: 'Shanghai',
    parentCompany: 'Acme Group',
    enterpriseNature: 'Private',
    companyHighlights: 'Regional leader'
  });

  assert.equal(customer.ownerUserId, 7);
  assert.deepEqual(calls, [{
    name: 'Acme Co',
    website: 'https://www.acme.example',
    industry: 'Manufacturing',
    country: 'China',
    region: 'Shanghai',
    parentCompany: 'Acme Group',
    enterpriseNature: 'Private',
    companyHighlights: 'Regional leader',
    address: '',
    ownerUserId: 7,
    notes: ''
  }]);
});

test('normalizeCustomerWebsite accepts full URLs and adds HTTPS to bare domains', () => {
  assert.equal(normalizeCustomerWebsite(' acme.example '), 'https://acme.example');
  assert.equal(normalizeCustomerWebsite('http://acme.example'), 'http://acme.example');
  assert.equal(normalizeCustomerWebsite(''), '');
});

test('createCustomer rejects duplicate customer names before insert', async () => {
  let createCalled = false;
  const customerRepository = {
    async findDuplicatesByName(name) {
      assert.equal(name, 'Acme Co');
      return [{
        id: 10,
        name: 'Acme Co',
        ownerUserId: 9,
        ownerDisplayName: 'Sales Manager',
        contactCount: 2
      }];
    },
    async createCustomer() {
      createCalled = true;
      throw new Error('should not create duplicate customer');
    }
  };

  await assert.rejects(() => createCustomer(customerRepository, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    name: ' Acme Co '
  }), DuplicateCustomerError);
  assert.equal(createCalled, false);
});

test('createCustomer maps a concurrent database uniqueness conflict to the domain error', async () => {
  let lookupCount = 0;
  const customerRepository = {
    async findDuplicatesByName() {
      lookupCount += 1;
      return lookupCount === 1 ? [] : [{ id: 10, name: 'Acme Co' }];
    },
    async createCustomer() {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'customers_normalized_name_unique_idx';
      throw error;
    }
  };

  await assert.rejects(() => createCustomer(customerRepository, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, { name: 'Acme Co' }), DuplicateCustomerError);
  assert.equal(lookupCount, 2);
});

test('updateCustomer rejects non-owner salesperson', async () => {
  const customerRepository = {
    async getCustomerDetail() {
      return { id: 10, ownerUserId: 7 };
    },
    async updateCustomer() {
      throw new Error('should not update');
    }
  };

  await assert.rejects(() => updateCustomer(customerRepository, {
    id: 8,
    roles: [ROLES.SALESPERSON]
  }, 10, {
    name: 'Acme Updated'
  }), /Forbidden/);
});

test('updateCustomer rejects duplicate customer names excluding the current customer', async () => {
  let updateCalled = false;
  const customerRepository = {
    async getCustomerDetail() {
      return { id: 10, ownerUserId: 7 };
    },
    async findDuplicatesByName(name, options) {
      assert.equal(name, 'Acme Co');
      assert.deepEqual(options, { excludeId: 10 });
      return [{
        id: 11,
        name: 'Acme Co',
        ownerUserId: 8,
        ownerDisplayName: 'Other Sales',
        contactCount: 1
      }];
    },
    async updateCustomer() {
      updateCalled = true;
      throw new Error('should not update duplicate customer');
    }
  };

  await assert.rejects(() => updateCustomer(customerRepository, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, 10, {
    name: 'Acme Co'
  }), DuplicateCustomerError);
  assert.equal(updateCalled, false);
});

test('archive and reopen customer require an administrator, actor identity, and reason', async () => {
  const calls = [];
  const customerRepository = {
    async archiveById(id, input) {
      calls.push(['archive', id, input]);
      return true;
    },
    async reopenById(id, input) {
      calls.push(['reopen', id, input]);
      return true;
    }
  };
  const admin = { id: 99, roles: [ROLES.ADMINISTRATOR] };

  await archiveCustomer(customerRepository, admin, 10, 'Duplicate imported record');
  await reopenCustomer(customerRepository, admin, 10, 'Archive was entered in error');
  assert.deepEqual(calls, [
    ['archive', 10, { actorUserId: 99, reason: 'Duplicate imported record' }],
    ['reopen', 10, { actorUserId: 99, reason: 'Archive was entered in error' }]
  ]);

  await assert.rejects(
    () => archiveCustomer(customerRepository, { id: 7, roles: [ROLES.SALESPERSON] }, 10, 'No'),
    /Forbidden/
  );
  await assert.rejects(() => archiveCustomer(customerRepository, admin, 10, '  '), /Archive reason is required/);
  assert.equal(calls.length, 2);
});

test('createContact checks customer ownership before insert', async () => {
  const calls = [];
  const customerRepository = {
    async getCustomerDetail(customerId) {
      return { id: customerId, ownerUserId: 7 };
    }
  };
  const contactRepository = {
    async createContact(input) {
      calls.push(input);
      return { id: 20, ...input };
    }
  };

  const contact = await createContact({ customerRepository, contactRepository }, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    customerId: 10,
    name: 'Alice',
    title: 'Buyer',
    educationBackground: 'MBA',
    workExperience: '10 years in procurement',
    keyAchievements: 'Led supplier consolidation'
  });

  assert.equal(contact.customerId, 10);
  assert.deepEqual(calls, [{
    customerId: 10,
    name: 'Alice',
    title: 'Buyer',
    phone: '',
    email: '',
    wechat: '',
    educationBackground: 'MBA',
    workExperience: '10 years in procurement',
    keyAchievements: 'Led supplier consolidation',
    notes: ''
  }]);
});

test('createContact rejects the same name customer and phone identity', async () => {
  let createCalled = false;
  const customerRepository = {
    async getCustomerDetail() {
      return { id: 10, ownerUserId: 7 };
    }
  };
  const contactRepository = {
    async findDuplicatesByIdentity(identity, options) {
      assert.deepEqual(identity, { customerId: 10, name: 'Alice', phone: '+86 159-6158-1489' });
      assert.deepEqual(options, { excludeId: undefined });
      return [{ id: 20, contactCode: 'CT000020', customerId: 10, name: 'Alice', phone: '15961581489' }];
    },
    async createContact() {
      createCalled = true;
    }
  };

  await assert.rejects(() => createContact({ customerRepository, contactRepository }, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    customerId: 10,
    name: ' Alice ',
    phone: '+86 159-6158-1489'
  }), DuplicateContactError);
  assert.equal(createCalled, false);
});

test('createContact maps a concurrent database uniqueness conflict to the domain error', async () => {
  let lookupCount = 0;
  const customerRepository = {
    async getCustomerDetail() {
      return { id: 10, ownerUserId: 7 };
    }
  };
  const contactRepository = {
    async findDuplicatesByIdentity() {
      lookupCount += 1;
      return lookupCount === 1 ? [] : [{ id: 20, contactCode: 'CT000020' }];
    },
    async createContact() {
      const error = new Error('duplicate key');
      error.code = '23505';
      error.constraint = 'contacts_customer_name_phone_unique_idx';
      throw error;
    }
  };

  await assert.rejects(() => createContact({ customerRepository, contactRepository }, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, {
    customerId: 10,
    name: 'Alice',
    phone: '15961581489'
  }), DuplicateContactError);
  assert.equal(lookupCount, 2);
});

test('updateContact rejects non-owner salesperson', async () => {
  const contactRepository = {
    async getContactDetail() {
      return { id: 20, customerOwnerUserId: 7 };
    },
    async updateContact() {
      throw new Error('should not update');
    }
  };

  await assert.rejects(() => updateContact(contactRepository, {
    id: 8,
    roles: [ROLES.SALESPERSON]
  }, 20, {
    name: 'Alice Updated'
  }), /Forbidden/);
});

test('updateContact excludes itself and rejects another matching contact', async () => {
  let updateCalled = false;
  const contactRepository = {
    async getContactDetail() {
      return { id: 20, customerId: 10, customerOwnerUserId: 7, name: 'Alice', phone: '123' };
    },
    async findDuplicatesByIdentity(identity, options) {
      assert.deepEqual(identity, { customerId: 10, name: 'Alice', phone: '15961581489' });
      assert.deepEqual(options, { excludeId: 20 });
      return [{ id: 21, contactCode: 'CT000021', customerId: 10, name: 'Alice', phone: '15961581489' }];
    },
    async updateContact() {
      updateCalled = true;
    }
  };

  await assert.rejects(() => updateContact(contactRepository, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  }, 20, {
    name: 'Alice',
    phone: '15961581489'
  }), DuplicateContactError);
  assert.equal(updateCalled, false);
});

test('archive and reopen contact require an administrator, actor identity, and reason', async () => {
  const calls = [];
  const contactRepository = {
    async archiveById(id, input) {
      calls.push(['archive', id, input]);
      return true;
    },
    async reopenById(id, input) {
      calls.push(['reopen', id, input]);
      return true;
    }
  };
  const admin = { id: 99, roles: [ROLES.ADMINISTRATOR] };

  await archiveContact(contactRepository, admin, 20, 'Former contact');
  await reopenContact(contactRepository, admin, 20, 'Contact returned');
  assert.deepEqual(calls, [
    ['archive', 20, { actorUserId: 99, reason: 'Former contact' }],
    ['reopen', 20, { actorUserId: 99, reason: 'Contact returned' }]
  ]);

  await assert.rejects(
    () => archiveContact(contactRepository, { id: 7, roles: [ROLES.SALESPERSON] }, 20, 'No'),
    /Forbidden/
  );
  await assert.rejects(() => reopenContact(contactRepository, admin, 20, ''), /Reopen reason is required/);
  assert.equal(calls.length, 2);
});
