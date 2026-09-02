import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTranslator,
  inferLanguageFromAcceptLanguage,
  listMissingTranslationKeys,
  normalizeLanguage
} from '../../src/utils/i18n.mjs';

test('English and Chinese dictionaries contain every English translation key', () => {
  assert.deepEqual(listMissingTranslationKeys('en'), []);
  assert.deepEqual(listMissingTranslationKeys('zh'), []);
});

test('language helpers normalize input and retain readable fallbacks', () => {
  assert.equal(normalizeLanguage('zh'), 'zh');
  assert.equal(normalizeLanguage('fr'), 'en');
  assert.equal(inferLanguageFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8'), 'zh');
  assert.equal(inferLanguageFromAcceptLanguage('en-US,en;q=0.9'), 'en');
  assert.equal(createTranslator('zh')('language'), '语言');
  assert.equal(createTranslator('en')('missing.key'), 'missing.key');
});
