import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMaintainContact,
  canMaintainCustomer,
  createCustomer,
  deleteCustomer,
  updateCustomer
} from '../../src/services/customerService.mjs';
import { createContact, deleteContact, updateContact } from '../../src/services/contactService.mjs';
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

test('deleteCustomer allows administrators only', async () => {
  const calls = [];
  const customerRepository = {
    async deleteById(id) {
      calls.push(id);
      return true;
    }
  };

  await deleteCustomer(customerRepository, { id: 99, roles: [ROLES.ADMINISTRATOR] }, 10);
  assert.deepEqual(calls, [10]);

  await assert.rejects(() => deleteCustomer(customerRepository, { id: 7, roles: [ROLES.SALESPERSON] }, 10), /Forbidden/);
  assert.deepEqual(calls, [10]);
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

test('deleteContact allows administrators only', async () => {
  const calls = [];
  const contactRepository = {
    async deleteById(id) {
      calls.push(id);
      return true;
    }
  };

  await deleteContact(contactRepository, { id: 99, roles: [ROLES.ADMINISTRATOR] }, 20);
  assert.deepEqual(calls, [20]);

  await assert.rejects(() => deleteContact(contactRepository, { id: 7, roles: [ROLES.SALESPERSON] }, 20), /Forbidden/);
  assert.deepEqual(calls, [20]);
});
