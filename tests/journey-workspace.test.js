import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeWorkspaceImport, evidenceFromAI } from '../journey/extensions.js';

const document = (id = 'doc_1') => ({ id, title: '本人资料', text: '本人提供的项目证明', kind: 'text', shareWithAI: true });
test('workspace recovery keeps source data but requires fresh model/document consent', () => {
  const raw = { version: 1, useProfile: true, useDocuments: true, liveSearch: true, profile: { authorizedFields: ['major'], authorizedAt: '2026-10-13T12:00:00Z', major: '材料科学', skills: [{ name: '未授权技能' }], apiKey: 'untrusted key' }, documents: [document()], research: { evidence: [], answer: '旧查询' }, apiKey: 'untrusted key' };
  const next = sanitizeWorkspaceImport(raw);
  assert.equal(next.profile.major, '材料科学');
  assert(!('skills' in next.profile)); assert(!('apiKey' in next)); assert(!('apiKey' in next.profile));
  assert.equal(next.documents[0].text, raw.documents[0].text);
  assert.equal(next.documents[0].shareWithAI, false);
  assert.equal(next.useDocuments, false); assert.equal(next.useProfile, false); assert.equal(next.liveSearch, false);
  assert.equal(next.research, null);
  assert.equal(sanitizeWorkspaceImport(raw, { restoreCache: true }).research.cached, true);
  assert.equal(raw.documents[0].shareWithAI, true);
});
test('ambiguous document identities are rejected before any workspace can be adopted', () => {
  assert.throws(() => sanitizeWorkspaceImport({ version: 1, documents: [document('same'), document('same')] }), /ID 重复/);
  for (const id of ['', '   ', 'x'.repeat(161)]) assert.throws(() => sanitizeWorkspaceImport({ version: 1, documents: [document(id)] }), /资料格式/);
  assert.throws(() => sanitizeWorkspaceImport({ version: 1, documents: [document('x'.repeat(160) + 'a'), document('x'.repeat(160) + 'b')] }), /资料格式/);
});
test('invalid and oversized backup compartments fail before replacing a working graph', () => {
  assert.throws(() => sanitizeWorkspaceImport({ version: 2 }), /格式不受支持/);
  assert.throws(() => sanitizeWorkspaceImport({ version: 1, profile: { authorizedAt: 'invalid', authorizedFields: ['major'] } }), /授权记录无效/);
  assert.throws(() => sanitizeWorkspaceImport({ version: 1, documents: Array.from({ length: 4 }, (_, i) => document(`d${i}`)) }), /数量超过/);
  assert.throws(() => sanitizeWorkspaceImport({ version: 1, documents: [{ ...document(), text: 'x'.repeat(20001) }] }), /资料格式/);
  assert.throws(() => sanitizeWorkspaceImport({ version: 1, documents: [{ ...document(), kind: 'arbitrary' }] }), /资料格式/);
});
test('AI citation cache preserves provenance and selected excerpt from the server source record', () => {
  const result = { citations: [{ sourceId: 'official_1', title: '正式项目要求', url: 'https://example.org/requirements', relevantExcerpt: '与问题相关的片段' }], sourceRecords: [{ id: 'official_1', title: '正式项目要求', trustLevel: 'official', contentHash: 'recorded-hash', excerpt: '完整检索摘要', checkedAt: '2026-10-13T12:00:00Z', expiresAt: '2026-11-12T12:00:00Z', region: '该项目', language: 'en' }] };
  const [evidence] = evidenceFromAI(result);
  assert.equal(evidence.excerpt, '与问题相关的片段'); assert.equal(evidence.hash, 'recorded-hash');
  assert.equal(evidence.expiresAt, result.sourceRecords[0].expiresAt);
  assert.equal(evidence.trustLevel, 'official'); assert.equal(evidence.region, '该项目');
  assert.equal(evidence.sourceId, 'official_1');
  assert.deepEqual(evidenceFromAI({ evidence: [evidence] }), [evidence]);
});
