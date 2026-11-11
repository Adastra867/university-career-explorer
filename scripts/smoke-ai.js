// Deliberately opt-in. Normal CI never imports or runs this script.
import { ask, extract, matchJD } from '../src/ai.js';
if (!process.env.LLM_API_KEY) throw new Error('Configure LLM_API_KEY; live smoke tests make a small number of billable calls');
const text = '在课程项目中使用SQL完成分析，提交一份分析报告。没有Python使用经验。';
await ask([], '如何把课程项目写进简历？');
console.log('Live career chat: passed schema and citation checks');
await extract(text);
console.log('Live extraction: passed literal evidence checks');
await matchJD('要求熟悉SQL，掌握Python。', text);
console.log('Live JD analysis: passed literal evidence checks');
console.log('These smoke tests do not replace human semantic evaluation');
