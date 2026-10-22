import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ejs from 'ejs';
import { JSDOM } from 'jsdom';

function editor() {
  const source = fs.readFileSync('src/views/lead-submissions/_saved-report-editor.ejs', 'utf8');
  const html = ejs.render(source, {
    submission: { id: 8547, convertedOpportunityId: 173, rawPayload: { leadAnalysis: { customerAnalysisReport: 'Original saved report <script>alert(1)</script>' } } },
    customerReportSaved: false, customerReportRevision: 'revision', leadAiEnabled: true,
    csrfField: () => '<input name="_csrf" type="hidden" value="csrf-token">'
  });
  const dom = new JSDOM(html, { url: 'https://crm.example.invalid/lead-submissions/8547', runScripts: 'outside-only' });
  dom.window.confirm = () => true;
  return dom;
}

test('saved report editor escapes content and retains original report on AI failure', async () => {
  const dom = editor();
  try {
    const form = dom.window.document.querySelector('form');
    dom.window.fetch = async () => ({ ok: false, json: async () => ({ error: '搜索服务不可用' }) });
    dom.window.eval(fs.readFileSync('src/public/assets/lead-saved-report.js', 'utf8'));
    form.elements.reportReviewed.checked = true;
    form.querySelector('[data-report-generate]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(form.elements.customerAnalysisReport.value, /Original saved report/);
    assert.match(form.querySelector('[data-report-status]').textContent, /搜索服务不可用/);
    assert.equal(form.querySelector('[data-report-generate]').disabled, false);
    assert.equal(form.elements.customerAnalysisReport.readOnly, false);
    assert.equal(form.elements.reportReviewed.checked, false);
    assert.equal(dom.window.document.querySelectorAll('script').length, 1);
  } finally { dom.window.close(); }
});

test('generated report remains unsaved and requires a fresh human review', async () => {
  const dom = editor();
  try {
    const form = dom.window.document.querySelector('form');
    let submitted;
    dom.window.fetch = async (url, options) => {
      submitted = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ text: 'Generated report', token: 'generation-token' }) };
    };
    dom.window.eval(fs.readFileSync('src/public/assets/lead-saved-report.js', 'utf8'));
    form.querySelector('[data-report-generate]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(submitted.url, /8547\/customer-report\/generate$/);
    assert.equal(submitted.body._csrf, 'csrf-token');
    assert.equal(submitted.body.consent, true);
    assert.equal(form.elements.customerAnalysisReport.value, 'Generated report');
    assert.equal(form.elements.reportGenerationToken.value, 'generation-token');
    assert.match(form.querySelector('[data-report-status]').textContent, /尚未保存/);
    assert.equal(form.elements.reportReviewed.checked, false);
    form.elements.reportReviewed.checked = true;
    form.elements.customerAnalysisReport.dispatchEvent(new dom.window.Event('input'));
    assert.equal(form.elements.reportReviewed.checked, false);
  } finally { dom.window.close(); }
});
