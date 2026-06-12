import test from 'node:test';
import assert from 'node:assert/strict';

import { inlineContentDisposition } from '../../src/utils/contentDisposition.mjs';

test('inline content disposition encodes Chinese filenames as ASCII-safe headers', () => {
  const header = inlineContentDisposition('利尔化学含盐废水焚烧系统技术方案260608.pdf');

  assert.match(header, /^inline; filename="[^"]+\.pdf"; filename\*=UTF-8''/);
  assert.doesNotMatch(header, /[^\x00-\x7F]/);
  assert.match(header, /%E5%88%A9%E5%B0%94/);
});

test('inline content disposition strips header-breaking control characters from fallback filename', () => {
  const header = inlineContentDisposition('bad\r\nname".pdf');

  assert.equal(header, "inline; filename=\"bad__name'.pdf\"; filename*=UTF-8''bad%0D%0Aname%22.pdf");
});
