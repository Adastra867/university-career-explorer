import { transaction } from '../db.js';
import { readWorkspace, writeWorkspace, readConversations } from '../repositories/workspace.js';

export function loadWorkspace(userId) {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return readWorkspace(client, userId);
  });
}

export function saveWorkspace(userId, data) {
  return transaction(client => writeWorkspace(client, userId, data));
}

export function exportAccount(userId) {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const workspace = await readWorkspace(client, userId);
    const conversations = await readConversations(client, userId);
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), ...workspace, conversations };
  });
}
