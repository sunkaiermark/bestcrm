import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ejs from 'ejs';
import { JSDOM } from 'jsdom';
import { researchCustomer } from '../../src/services/leadAiProvider.mjs';
import { analysisContextHash } from '../../src/domain/leadAnalysis.mjs';
import { savedLeadReportContext, savedLeadReportRevision } from '../../src/services/leadCustomerReportService.mjs';

const requirement = 'SSHE处理动物脂肪8 t/h，入口25°C，出口65°C，优选SS316L。';

test('product fit research includes actual inquiry and approved product families but does not assert catalogue performance', async () => {
  let payload;
  const result = await researchCustomer({ company: { value: 'Example EPC' }, transactionRole: { value: 'epc' },
    requirement: { value: requirement }, product: { value: 'SSHE' },
    productCategories: { value: ['heat-exchanger', 'invented-product'] }
  }, { env: { LAB_ARK_API_KEY: 'test', LAB_SEARCH_ENABLED: 'true' }, fetchImpl: async (url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: '胜开尔产品结合度\n有条件匹配，须技术评审。' }] }] }) };
  } });
  const prompt = payload.input[0].content;
  assert.ok(prompt.includes(requirement));
  assert.ok(prompt.includes('"code":"heat-exchanger","label":"Heat Exchanger"'));
  assert.equal(prompt.includes('invented-product'), false);
  assert.ok(prompt.includes('胜开尔产品结合度'));
  assert.ok(prompt.includes('企业业务结合度和本次项目匹配结论'));
  assert.ok(prompt.includes('不是技术能力证明'));
  assert.ok(prompt.includes('不得据此承诺具体型号'));
  assert.ok(prompt.includes('不将询价方当作自用工厂'));
  assert.ok(prompt.includes('不编造百分比或评分'));
  assert.equal(result.verified, false);
});

test('changed requirements or confirmed product families invalidate a prior report context', () => {
  const input = { companyName: 'Example', requirementText: requirement,
    confirmedProductCategoryCodes: ['heat-exchanger'] };
  const baseline = analysisContextHash(input);
  assert.notEqual(analysisContextHash({ ...input, requirementText: 'Different process duty' }), baseline);
  assert.notEqual(analysisContextHash({ ...input, confirmedProductCategoryCodes: ['mixers'] }), baseline);
  assert.equal(analysisContextHash({ ...input, confirmedProductCategoryCodes: ['heat-exchanger', 'invalid'] }), baseline);
  const lead = { convertedOpportunityId: 173, companyName: 'Example', requirementText: requirement,
    productInterest: 'SSHE', confirmedProductCategoryCodes: ['heat-exchanger'], rawPayload: { leadAnalysis: { transactionRole: 'epc' } } };
  assert.equal(savedLeadReportContext(lead).requirementText, requirement);
  assert.notEqual(savedLeadReportRevision(lead), savedLeadReportRevision({ ...lead, requirementText: 'Changed' }));
});

test('saved report displays product fit as a numbered chapter and keeps the source chapter', () => {
  const file = 'src/views/lead-submissions/_analysis-summary.ejs';
  const html = ejs.render(fs.readFileSync(file, 'utf8'), { analysis: { transactionRole: 'epc',
    customerAnalysisReport: '执行摘要\nSummary\n胜开尔产品结合度\n有条件匹配\n信息来源\nhttps://example.invalid' } }, { filename: file });
  const dom = new JSDOM(html);
  try {
    const headings = [...dom.window.document.querySelectorAll('h3')].map(node => node.textContent);
    assert.ok(headings.includes('四、胜开尔产品结合度'));
    assert.ok(headings.includes('八、信息来源'));
    assert.match(dom.window.document.querySelector('article').textContent, /有条件匹配/);
  } finally { dom.window.close(); }
});
