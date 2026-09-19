import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlainEmailForReading, resolveInlineEmailContent } from '../../src/utils/emailPresentation.mjs';

test('plain email reading format reflows hard-wrapped paragraphs across the available width', () => {
  assert.equal(
    formatPlainEmailForReading('Following the successful completion of the new\nmanufacturing facility, please provide a technical and\ncommercial quotation.'),
    'Following the successful completion of the new manufacturing facility, please provide a technical and commercial quotation.'
  );
});

test('plain email reading format keeps paragraphs and list items readable', () => {
  assert.equal(
    formatPlainEmailForReading('Dear Sales Team,\n\n1. Equipment requirements\n\n- Reactor with agitator\nand sanitary seal\n- Heat exchanger\nand controls'),
    'Dear Sales Team,\n\n1. Equipment requirements\n\n- Reactor with agitator and sanitary seal\n- Heat exchanger and controls'
  );
});

test('plain email reading format preserves quoted history and signature line structure', () => {
  assert.equal(
    formatPlainEmailForReading('Best regards,\nMark Yang\nSales Manager\nSUNKAIER\n\n> Original line one\n> Original line two'),
    'Best regards,\nMark Yang\nSales Manager\nSUNKAIER\n\n> Original line one\n> Original line two'
  );
});

test('HTML email reading resolves archived CID images without changing external URLs', () => {
  assert.equal(
    resolveInlineEmailContent(
      '<img src="cid:logo@example.com"><img src="CID:%3Cchart.1@example.com%3E"><img src="https://example.com/pixel">',
      [
        { id: 21, contentId: '<logo@example.com>' },
        { id: 22, contentId: 'chart.1@example.com' }
      ]
    ),
    '<img src="/email-center/attachments/21/inline"><img src="/email-center/attachments/22/inline"><img src="https://example.com/pixel">'
  );
});
