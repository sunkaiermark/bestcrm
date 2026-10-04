import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRichEmailBody } from '../../src/services/emailRichTextService.mjs';

test('rich email keeps table rows, cells, emphasis, and a readable plain-text alternative', () => {
  const result = sanitizeRichEmailBody('<p>Quote:</p><table><tr><th>Item</th><th>Price</th></tr><tr><td>Mixing vessel</td><td>USD 100</td></tr></table><p><strong>Thanks</strong></p>');
  assert.match(result.html, /<table style=/);
  assert.match(result.html, /<th style=/);
  assert.match(result.html, /Mixing vessel<\/td>/);
  assert.match(result.html, /<strong>Thanks<\/strong>/);
  assert.match(result.text, /ITEM\s+PRICE/);
  assert.match(result.text, /Mixing vessel\s+USD 100/);
});

test('rich email drops active content, remote images, links, pasted styles, and unsafe attributes', () => {
  const result = sanitizeRichEmailBody(`
    <p onclick="alert(1)" style="color:red">Hello<a href="javascript:alert(2)"> customer</a></p>
    <table background="https://tracker.example/pixel"><tr><td colspan="2" rowspan="99" style="background:url(https://tracker.example/x)" onmouseover="alert(3)">One</td></tr></table>
    <img src="https://tracker.example/open" onerror="alert(4)">
    <svg onload="alert(5)"><circle /></svg><script>alert(6)</script><iframe src="https://tracker.example"></iframe>
  `);
  assert.match(result.html, /Hello customer/);
  assert.match(result.html, /colspan="2"/);
  assert.doesNotMatch(result.html, /rowspan=|onclick|onmouseover|onerror|javascript:|tracker\.example|<img|<svg|<script|<iframe|color:red/i);
  assert.equal(result.text.includes('Hello customer'), true);
});

test('rich email rejects image-only or script-only content as empty', () => {
  assert.equal(sanitizeRichEmailBody('<img src="https://tracker.example/open">').text, '');
  assert.equal(sanitizeRichEmailBody('<script>alert(1)</script>').text, '');
});
