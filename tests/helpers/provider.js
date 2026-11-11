import http from 'node:http';

export async function startProvider() {
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    let input;
    try { input = JSON.parse(raw); } catch { res.writeHead(400); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/tools/search') {
      res.end(JSON.stringify({ results: [0, 1, 2].map(i => ({ title: '数据分析师校园招聘 ' + i, url: 'https://www.zhipin.com/job_detail/fixture-' + i + '.html', snippet: 'SQL与数据分析，面向应届生', content: input.need_content ? '岗位职责：SQL数据分析；任职要求：本科。' : '', site_name: '测试招聘平台', date: '2026-11-01T00:00:00Z', authority: 2 })) })); return;
    }
    if (req.url === '/v1/tools/fetch') { res.end(JSON.stringify({ title: '测试岗位JD', content: '# 数据分析师\n岗位职责：使用SQL分析数据。' })); return; }
    const prompt = input.messages?.[0]?.content || '';
    const query = input.messages?.at(-1)?.content || '';
    let data = prompt.includes('"skills"') ? { skills: [{ name: 'SQL', category: 'tool', evidence: '使用SQL完成分析' }], starItems: [], questions: ['结果是什么？'] } : prompt.includes('"requirements"') ? { requirements: [{ requirement: 'SQL', kind: 'skill', evidence: '使用SQL完成分析', status: 'supported', explanation: '原文包含SQL' }] } : { answer: '用真实经历说明行动与成果', citationIds: ['resume-evidence'] };
    if (query.includes('bad-citation')) data = { answer: 'bad', citationIds: ['invented'] };
    if (query.includes('bad-evidence')) data = { skills: [{ name: 'SQL', category: 'tool', evidence: '虚构经历' }], starItems: [], questions: [] };
    if (query.includes('invalid-json')) { res.end(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] })); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }], usage: { total_tokens: 100 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
