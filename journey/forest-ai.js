import { validateAIData } from './ai-store.js';

/** Copy one tree's AI records without sharing global identities or model consent. */
export function cloneTreeAIData(data, sourceGraphId) {
  const validated = validateAIData(data);
  if (typeof sourceGraphId !== 'string' || !sourceGraphId.trim() || sourceGraphId.length > 160) throw new Error('复制 AI 历史需要明确的来源树 ID');
  const result = {
    schemaVersion: 1,
    turns: validated.turns.filter(turn => turn.graphId === sourceGraphId),
    narratives: validated.narratives.filter(record => record.graphId === sourceGraphId),
  };
  const turnIds = new Map(), threadIds = new Map(), requestIds = new Map(), narrativeIds = new Map();
  const mapped = (mapping, value, prefix) => {
    if (!mapping.has(value)) mapping.set(value, `${prefix}_${crypto.randomUUID()}`);
    return mapping.get(value);
  };
  for (const turn of result.turns) mapped(turnIds, turn.turnId, 'turn');
  const turnReference = id => {
    if (!turnIds.has(id)) throw new Error('派生路线介绍引用了其他树或缺失的问答');
    return turnIds.get(id);
  };
  for (const turn of result.turns) {
    turn.turnId = turnReference(turn.turnId);
    turn.threadId = mapped(threadIds, turn.threadId, 'thread');
    turn.clientRequestId = mapped(requestIds, turn.clientRequestId, 'request');
    // Historical binding is retained; model-send authorization requires a fresh choice.
    turn.contextKey = '';
  }
  for (const record of result.narratives) {
    record.narrativeId = mapped(narrativeIds, record.narrativeId, 'narrative');
    for (const key of ['draft', 'confirmed', 'userEdited']) {
      const version = record[key];
      if (!version) continue;
      version.inputTurnIds = version.inputTurnIds.map(turnReference);
      version.sourceTurnIds = version.sourceTurnIds.map(turnReference);
      version.content.sourceTurnIds = version.content.sourceTurnIds.map(turnReference);
      for (const preparation of version.content.requiredPreparation) preparation.supportingTurnIds = preparation.supportingTurnIds.map(turnReference);
      for (const stamp of version.turnStamps) stamp.turnId = turnReference(stamp.turnId);
    }
  }
  // graph/root/node/edge/path/source IDs and historical stamps are deliberately
  // unchanged. AIStore.importData binds this copy to the new tree and marks
  // derived introductions stale until the user regenerates them.
  return validateAIData(result);
}
