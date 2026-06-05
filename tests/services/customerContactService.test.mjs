import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMaintainContact,
  canMaintainCustomer,
  createCustomer,
  updateCustomer
} from '../../src/services/customerService.mjs';
import { createContact, updateContact } from '../../src/services/contactService.mjs';
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
    region: 'Shanghai'
  });

  assert.equal(customer.ownerUserId, 7);
  assert.deepEqual(calls, [{
    name: 'Acme Co',
    industry: 'Manufacturing',
    region: 'Shanghai',
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
    title: 'Buyer'
  });

  assert.equal(contact.customerId, 10);
  assert.deepEqual(calls, [{
    customerId: 10,
    name: 'Alice',
    title: 'Buyer',
    phone: '',
    email: '',
    wechat: '',
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
