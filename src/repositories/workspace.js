// All queries are user-scoped and run on the caller's transaction client.
export async function readWorkspace(client, userId) {
  const state = (await client.query('SELECT version,prep FROM user_state WHERE user_id=$1', [userId])).rows[0];
  if (!state) throw Object.assign(new Error('账号状态不完整，请联系管理员'), { code: 'USER_STATE_MISSING' });
  const profile = (await client.query('SELECT data FROM profiles WHERE user_id=$1', [userId])).rows[0]?.data;
  const assessment = (await client.query('SELECT data FROM assessments WHERE user_id=$1', [userId])).rows[0]?.data;
  const history = (await client.query('SELECT data FROM reports WHERE user_id=$1 ORDER BY report_id', [userId])).rows.map(row => row.data);
  return { version: state.version, appData: assessment ? { ...assessment, studentProfile: profile || {} } : null, history, prep: state.prep };
}

export async function writeWorkspace(client, userId, data) {
  const saved = (await client.query('UPDATE user_state SET version=version+1,prep=$3,updated_at=now() WHERE user_id=$1 AND version=$2 RETURNING version', [userId, data.version, data.prep])).rows[0];
  if (!saved) throw Object.assign(new Error('其他页面或设备已更新档案，请先下载本地备份，再加载云端资料'), { status: 409, code: 'VERSION_CONFLICT' });
  const { studentProfile = {}, chatHistory: _chatHistory, ...assessment } = data.appData;
  await client.query('INSERT INTO profiles(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data', [userId, studentProfile]);
  await client.query('INSERT INTO assessments(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data', [userId, assessment]);
  // A sync is a snapshot replacement, but unchanged report rows need not be deleted/reinserted.
  await client.query('DELETE FROM reports WHERE user_id=$1 AND NOT (report_id=ANY($2::text[]))', [userId, data.history.map(record => record.id)]);
  for (const record of data.history) {
    await client.query('INSERT INTO reports(user_id,report_id,data) VALUES($1,$2,$3) ON CONFLICT(user_id,report_id) DO UPDATE SET data=EXCLUDED.data WHERE reports.data IS DISTINCT FROM EXCLUDED.data', [userId, record.id, record]);
  }
  return saved.version;
}

export async function readConversations(client, userId) {
  const conversations = (await client.query('SELECT id,title,created_at FROM conversations WHERE user_id=$1 ORDER BY created_at,id', [userId])).rows;
  const messages = (await client.query('SELECT m.conversation_id,m.role,m.content,m.metadata,m.created_at FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 ORDER BY m.id', [userId])).rows;
  const grouped = new Map(conversations.map(conversation => [conversation.id, []]));
  for (const { conversation_id, ...message } of messages) grouped.get(conversation_id)?.push(message);
  return conversations.map(conversation => ({ ...conversation, messages: grouped.get(conversation.id) }));
}
