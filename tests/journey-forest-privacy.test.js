import test from 'node:test';
import assert from 'node:assert/strict';
import { TreeLibrary } from '../journey/forest.js';
import { GraphStore } from '../journey/store.js';

test('multi-tree imports reset sharing and claimed source verification in current, undo and named versions', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const library = new TreeLibrary(storage);
  const entry = library.create('career', '受控来源导入测试');
  const store = new GraphStore(library.scopedStorage(entry.id));
  try {
    store.commit([{ op: 'upsert_source', source: { id: 'fixture_source', title: '测试用自称官方资料，非真实核验', url: 'https://example.org/fixture', checkedAt: new Date().toISOString(), trustLevel: 'official', contentHash: 'synthetic-fixture-hash' } }, { op: 'update_node', nodeId: store.graph.rootNodeId, patch: { shareAllowed: true, knowledgeStatus: 'verified', sourceIds: ['fixture_source'] } }]);
    store.save(); store.snapshot('带来源的命名版本');
    const before = library.exportTree(entry.id), original = JSON.stringify(before);
    const imported = library.importTree(before), result = library.exportTree(imported.id);
    const documents = [result.document, result.backup].filter(Boolean);
    const graphs = documents.flatMap(d => [d.graph, ...(d.undo || []), ...(d.redo || []), ...(d.snapshots || []).map(s => s.graph)]);
    for (const graph of graphs) {
      assert(graph.nodes.every(n => n.shareAllowed === false && n.knowledgeStatus !== 'verified'));
      assert((graph.sources || []).every(s => s.trustLevel === 'unverified'));
    }
    assert.equal(JSON.stringify(before), original);
    assert.equal(library.exportTree(entry.id).document.graph.nodes[0].shareAllowed, true);
    assert.equal(library.exportTree(entry.id).document.graph.sources[0].trustLevel, 'official');
  } finally { clearTimeout(store.timer); }
});
