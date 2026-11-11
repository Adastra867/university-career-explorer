import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('shipped pages do not load executable or style resources from external CDNs', async () => {
  for (const page of ['index.html', 'job-search.html', 'career-prep.html']) {
    const html = await readFile(new URL('../public/' + page, import.meta.url), 'utf8');
    assert.equal(/<(?:script|link|img)\b[^>]+(?:src|href)=["']https?:/i.test(html), false, page);
    assert.equal(html.includes('tailwind.config'), false, page);
  }
});
