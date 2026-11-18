import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit, billable acceptance run against a configured real model.
// npm test does not discover this file. Running it without --run performs no API calls.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argumentsList = process.argv.slice(2);
const usage = 'Usage: node tests/career-advisor-live.mjs --run --base-url http://localhost:5000 --env-file .env [--cases 2,6]';
if (!argumentsList.includes('--run') || argumentsList.includes('--help')) {
  console.log(usage);
  console.log('Runs all eight synthetic cases by default. --cases selects case IDs 1–8. Case 7 injects a failed retrieval service while retaining the real model provider.');
  process.exit(0);
}

function argumentsForRun(args) {
  const options = { baseUrl: 'http://localhost:5000', envFile: null, caseIds: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--run') continue;
    if (!['--base-url', '--env-file', '--cases'].includes(argument) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(usage);
    }
    const value = args[++index];
    if (argument === '--cases') {
      const ids = value.split(',').map(id => id.trim());
      if (!ids.every(id => /^[1-8]$/.test(id))) throw new Error('--cases requires comma-separated case IDs from 1 to 8.');
      options.caseIds = [...new Set(ids.map(Number))];
    } else options[argument === '--base-url' ? 'baseUrl' : 'envFile'] = value;
  }
  const url = new URL(options.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('The acceptance base URL must be an HTTP(S) application URL without credentials, query parameters or a fragment.');
  }
  options.baseUrl = url.origin;
  return options;
}

const options = argumentsForRun(argumentsList);
const OUTPUT_DIRECTORY = resolve(ROOT, 'artifacts/career-advisor-live');
const startedAt = new Date().toISOString();
const outputPath = resolve(OUTPUT_DIRECTORY, `acceptance-${startedAt.replace(/[:.]/g, '-')}.json`);

function field(value, sourceType = 'user_form') {
  return { value, value_state: 'known', source_type: sourceType, confirmation_state: 'confirmed' };
}

const authorizedProfile = {
  consent: true,
  fields: {
    'education.major': field('能源与动力工程'),
    'education.degree': field('本科'),
    'education.stage': field('大三'),
    'experience.text': field('做过电池仿真实习，比较不同工况的仿真结果；参与过有机光伏稳定性科研，负责整理实验记录。', 'user_text'),
    'skills.self_report': field('会基础 Python 数据整理，尚未学习机器学习。', 'user_text'),
    'preferences.long_term_goal': field('希望探索能源与数据方法的交叉方向，先用小项目验证。'),
    'preferences.city': field('上海'),
  },
};

const partialProfile = {
  consent: true,
  fields: {
    'education.major': field('新能源科学与工程'),
    'experience.text': field('做过材料测试课程项目，记录并整理过测量结果。', 'user_text'),
  },
};

const cases = [
  {
    id: 1, name: '无画像时主动探索',
    request: { task: 'explore', message: '我不知道未来做什么。' },
    expectation: '直接提供多个通用探索方向与验证方式。',
  },
  {
    id: 2, name: '空资料三年规划',
    request: { task: 'plan', message: '帮我制定未来三年的成长路线。' },
    expectation: '给出近期、中期、远期行动和明确假设或条件。',
  },
  {
    id: 3, name: '能源实习经历探索',
    request: { task: 'explore', message: '我是能源专业本科生，做过电池仿真实习。' },
    expectation: '复用能源和仿真经历，探索具有区别的发展方向。',
  },
  {
    id: 4, name: '读研与就业比较',
    request: { task: 'compare', message: '我应该读研还是直接就业？' },
    expectation: '直接比较两条路线的成本、优点、限制与适合情景。',
  },
  {
    id: 5, name: '授权画像成长建议',
    request: { task: 'growth', message: '根据我的经历，我现在最应该做什么？', profile: authorizedProfile },
    expectation: '使用已提供的仿真、科研和技能自述，给出具体行动。',
    reuseTerms: /电池|仿真|光伏|Python/i,
  },
  {
    id: 6, name: '缺少年级的部分画像规划',
    request: { task: 'plan', message: '请结合个人画像制定成长路线。', profile: partialProfile },
    expectation: '使用材料测试项目背景，以初步规划或条件处理未知年级。',
    reuseTerms: /材料|测量|测试|新能源/,
  },
  {
    id: 7, name: '外部检索失败后继续提供建议', isolated: true,
    request: {
      task: 'explore', message: '我是能源专业本科生，做过电池仿真实习。请结合公开招聘信息探索发展方向。',
      researchEnabled: true, liveSearch: true, publicSearchQuery: '电池 仿真 校招 岗位要求',
    },
    expectation: '保留已有经历并给出初步建议，如实展示检索失败。',
  },
  {
    id: 8, name: '反向检验仍提供建设性建议',
    request: { task: 'explore', message: '我准备本科毕业后直接做 AI 算法工程师。', challengeMode: true },
    expectation: '指出薄弱假设、风险和验证方法，同时提供可执行路线。',
  },
];

const selectedCases = options.caseIds ? cases.filter(testCase => options.caseIds.includes(testCase.id)) : cases;

const report = {
  startedAt, completedAt: null, baseUrl: options.baseUrl, syntheticDataOnly: true,
  selectedCaseIds: selectedCases.map(testCase => testCase.id),
  evaluation: 'Live model responses through the production Career Intelligence API. Retrieval failure is injected only for case 7.',
  cases: [], metrics: null,
  manualReview: {
    required: true,
    scope: ['事实性断言是否有依据', '画像复用是否准确', '路线是否有实质区别', '行动是否适合给定约束', '可选问题是否确有必要'],
    unsupportedClaimRate: null,
    reason: '结构和词语检查无法证明事实断言正确。请依据完整的合成输入、实际回答和来源人工审核。',
  },
};

function outputText(result) {
  if (!result || typeof result !== 'object') return '';
  const pieces = [];
  const append = value => {
    if (typeof value === 'string') pieces.push(value);
    else if (Array.isArray(value)) value.forEach(append);
    else if (value && typeof value === 'object') Object.values(value).forEach(append);
  };
  for (const key of ['summary', 'profileInsights', 'branches', 'comparison', 'nextActions']) append(result[key]);
  return pieces.join('\n');
}

function sourceReferences(result) {
  return [
    ...(result.branches || []),
    ...(result.profileInsights?.documented || []),
    ...(result.comparison || []).flatMap(route => route.dimensions || []),
  ].flatMap(item => item.evidenceIds || []);
}

function checkResult(testCase, statusCode, result) {
  const requiredArrays = ['branches', 'comparison', 'nextActions', 'evidence'];
  const basicShape = statusCode === 200 && result?.task === testCase.request.task &&
    ['ready', 'needs_input'].includes(result.status) && typeof result.summary === 'string' && result.summary.trim().length > 0 &&
    typeof result.followUpQuestion === 'string' && requiredArrays.every(key => Array.isArray(result[key])) &&
    result.profileInsights && ['selfReported', 'inferred', 'missing'].every(key => Array.isArray(result.profileInsights[key]));
  const liveModel = Boolean(basicShape && /^insight_[\w-]+$/.test(result.id || '') && typeof result.model === 'string' && result.model && !/fixture|mock/i.test(result.model));
  if (!basicShape) return {
    passed: false, httpStatus: statusCode, basicShape: false, liveModel: false,
    errorCode: typeof result?.code === 'string' ? result.code : 'INVALID_RESPONSE',
  };

  const text = outputText(result);
  const followUpMarks = (result.followUpQuestion.match(/[?？]/g) || []).length;
  const questionCount = (text.match(/[?？]/g) || []).length + (result.followUpQuestion.trim() ? Math.max(1, followUpMarks) : 0);
  const actions = [
    ...result.nextActions,
    ...result.branches.flatMap(branch => [
      ...(branch.nextActions || []), ...(branch.stages || []).flatMap(stage => stage.actions || []),
    ]),
  ].filter(action => typeof action === 'string' && action.trim());
  const titles = result.branches.map(branch => branch.title?.trim());
  const branchesValid = result.branches.every(branch => branch.title && branch.description && branch.reason &&
    Array.isArray(branch.advantages) && Array.isArray(branch.skillGaps) && Array.isArray(branch.risks) &&
    Array.isArray(branch.nextActions) && branch.nextActions.length && branch.verification);
  const planStages = result.branches[0]?.stages || [];
  const taskShape = {
    explore: result.branches.length >= 3 && result.branches.length <= 5 && new Set(titles).size === titles.length && branchesValid,
    plan: result.branches.length === 1 && branchesValid && planStages.map(stage => stage.timeframe).join(',') === 'near,mid,long' &&
      planStages.every(stage => Array.isArray(stage.actions) && stage.actions.length >= 2 && stage.actions.length <= 3),
    compare: result.comparison.length >= 2 && result.comparison.length <= 5 && result.comparison.every(route =>
      route.routeTitle && route.tradeoff && Array.isArray(route.dimensions) && route.dimensions.length >= 6 && route.dimensions.every(item => item.assessment)),
    growth: result.nextActions.length >= 3,
  }[testCase.request.task];
  const evidenceIds = new Set(result.evidence.map(source => source.sourceId));
  const citationsValid = sourceReferences(result).every(id => evidenceIds.has(id));
  const profileReused = testCase.reuseTerms ? testCase.reuseTerms.test(text) : null;
  const conditionalityDetected = /如果|若|在校|毕业|已就业|情景|分支|假设|通用|初步/.test(text);
  const retrievalFailureHandled = testCase.isolated
    ? result.researchStatus?.degraded === true && result.researchStatus?.liveSearchPerformed !== true &&
      result.evidence.every(source => source.origin !== 'live_search') && citationsValid
    : null;
  const challengeConstructive = testCase.request.challengeMode
    ? result.branches.some(branch => branch.risks?.length && branch.verification) && /假设|基础|证据|验证|风险/.test(text)
    : null;
  const checks = {
    basicShape, liveModel, ready: result.status === 'ready', taskShape: Boolean(taskShape), citationsValid,
    actionable: actions.length > 0, zeroQuestions: questionCount === 0,
    ...(profileReused !== null ? { profileReused } : {}),
    ...([2, 6].includes(testCase.id) ? { conditionalityDetected } : {}),
    ...(retrievalFailureHandled !== null ? { retrievalFailureHandled } : {}),
    ...(challengeConstructive !== null ? { challengeConstructive } : {}),
  };
  return {
    passed: Object.values(checks).every(Boolean), httpStatus: statusCode, ...checks,
    questionCount, actionCount: actions.length, branchCount: result.branches.length, comparisonCount: result.comparison.length,
    nextActionCount: result.nextActions.length, planStageActionCounts: planStages.map(stage => stage.actions?.length || 0),
    summaryCharacters: result.summary.length, responseCharacters: text.length,
    profileReuseBasis: profileReused === null ? null : 'Response contains supplied background terms; semantic correctness still requires review.',
  };
}

function metric(items, predicate) {
  const numerator = items.filter(predicate).length;
  return { numerator, denominator: items.length, rate: items.length ? numerator / items.length : null };
}

function calculateMetrics() {
  const responses = report.cases.filter(item => item.checks.basicShape);
  const reuseCases = report.cases.filter(item => cases.find(testCase => testCase.id === item.id)?.reuseTerms);
  return {
    acceptancePassRate: metric(report.cases, item => item.checks.passed),
    firstTurnUsefulAnswerRate: metric(report.cases, item => item.checks.ready && item.checks.taskShape && item.checks.actionable),
    unnecessaryClarificationRate: {
      ...metric(responses, item => item.checks.questionCount > 0),
      unassessed: report.cases.length - responses.length,
      definition: 'The eight ordinary acceptance scenarios expect zero follow-up questions. Question punctuation and followUpQuestion are counted.',
    },
    existingContextReuseRate: {
      ...metric(reuseCases, item => item.checks.profileReused),
      definition: 'Automated supplied-term match for the two authorized-profile scenarios. Review the actual semantic use separately.',
    },
    actionabilityRate: metric(report.cases, item => item.checks.actionable),
    unsupportedClaimRate: null,
    unsupportedClaimReviewRequired: true,
  };
}

function publicError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { code: 'ACCEPTANCE_TIMEOUT', message: '模型验收请求超时。' };
  return { code: 'ACCEPTANCE_REQUEST_FAILED', message: '验收请求失败。请检查服务状态、模型配置或网络。' };
}

async function saveReport() {
  report.metrics = calculateMetrics();
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
}

async function failedRetrievalApp() {
  if (options.envFile) {
    const envPath = resolve(ROOT, options.envFile);
    if (!existsSync(envPath)) throw new Error('The supplied environment file does not exist.');
    try { process.loadEnvFile(envPath); }
    catch { throw new Error('Unable to load the model environment configuration.'); }
  }
  const [{ default: express }, { createJourneyRouter }] = await Promise.all([
    import('express'), import('../journey/server.js'),
  ]);
  const app = express();
  app.use('/api/journey', createJourneyRouter({
    env: process.env, rateLimitMs: 0,
    researchService: {
      catalog: () => ({ liveConfigured: true, sources: [] }),
      retrieve: async () => { throw Object.assign(new Error('Controlled retrieval outage for the synthetic acceptance case.'), { code: 'ECONNRESET' }); },
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }),
  };
}

console.log(`Starting ${selectedCases.length} real-model acceptance cases with synthetic inputs (${selectedCases.map(testCase => testCase.id).join(', ')}).`);
for (const testCase of selectedCases) {
  let isolated;
  const started = Date.now();
  const item = {
    id: testCase.id, name: testCase.name, expectation: testCase.expectation,
    request: { researchEnabled: false, liveSearch: false, history: [], ...testCase.request },
    injectedRetrievalFailure: Boolean(testCase.isolated),
  };
  try {
    if (testCase.isolated) isolated = await failedRetrievalApp();
    const baseUrl = isolated?.baseUrl || options.baseUrl;
    const response = await fetch(`${baseUrl}/api/journey/career-intelligence`, {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.request), signal: AbortSignal.timeout(180000),
    });
    const result = await response.json().catch(() => null);
    item.response = result;
    item.checks = checkResult(testCase, response.status, result);
  } catch (error) {
    item.error = publicError(error);
    item.checks = { passed: false, basicShape: false, liveModel: false };
  } finally { await isolated?.close(); }
  item.durationMs = Date.now() - started;
  report.cases.push(item);
  await saveReport();
  console.log(JSON.stringify({
    case: item.id, name: item.name, passed: item.checks.passed, model: item.response?.model || null,
    summary: typeof item.response?.summary === 'string' ? item.response.summary.slice(0, 240) : null,
    validShape: item.checks.basicShape, actionable: item.checks.actionable ?? false, zeroQuestions: item.checks.zeroQuestions ?? null,
    durationMs: item.durationMs, branchCount: item.checks.branchCount ?? 0,
    actionCount: item.checks.actionCount ?? 0, questionCount: item.checks.questionCount ?? null,
    failedChecks: Object.entries(item.checks).filter(([, value]) => value === false).map(([key]) => key),
  }));
}
report.completedAt = new Date().toISOString();
await saveReport();
console.log(JSON.stringify({
  passed: report.cases.filter(item => item.checks.passed).length, total: selectedCases.length,
  reportPath: outputPath, metrics: report.metrics, manualReviewRequired: true,
}, null, 2));
if (report.cases.some(item => !item.checks.passed)) process.exitCode = 1;
