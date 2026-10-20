import test from 'node:test';
import assert from 'node:assert/strict';
import { organizeEmailRequirement } from '../../src/utils/emailRequirement.mjs';

test('email requirement retains the customer request and RFQ condition without signature and legal footer', () => {
  const body = 'Hi Jason,\n\nI am CVS Somayajulu working in engineering department in HATCH.\n\nPlease share the catalogues & reference drawings of concentrate repulper\n(Twin paddle type) / de-lumper.\n\nIf it suits to our requirement I will inform our procurement team, so that\nthey will send you the RFQ.\n\nThanks for your support.\n\nRegards,\nSomayajulu CVS\nMechanical Specialist\n\nN O T I C E - This message from Hatch is intended only for the use of the individual';
  const result = organizeEmailRequirement(body);
  assert.match(result, /HATCH/);
  assert.match(result, /repulper \(Twin paddle type\) \/ de-lumper/);
  assert.match(result, /they will send you the RFQ/);
  assert.doesNotMatch(result, /Hi Jason|Regards|Mechanical Specialist|N O T I C E|Thanks for/);
  assert.equal(body.includes('Mechanical Specialist'), true);
});

test('technical values, lists, conditions and inline thanks remain intact', () => {
  const body = 'Dear Team,\n\n1. Vessel: 316L, 10 bar.\n2. Motor: 55 kW.\n\nThanks to the new process, capacity must exceed 20 t/h.\nPlease reply by Friday.\n\nBest regards,\nCustomer';
  const result = organizeEmailRequirement(body);
  for (const text of ['316L, 10 bar','55 kW','20 t/h','Please reply by Friday','Thanks to the new process']) assert.ok(result.includes(text));
  assert.doesNotMatch(result, /Dear Team|Best regards|Customer/);
});

test('fallback and Chinese requirements stay readable', () => {
  assert.equal(organizeEmailRequirement('', 'Equipment RFQ'), 'Equipment RFQ');
  assert.equal(organizeEmailRequirement('您好！\n\n需要容器设计，压力0.6MPa。\n\n谢谢支持。\n此致\n张先生'), '需要容器设计，压力0.6MPa。');
});
