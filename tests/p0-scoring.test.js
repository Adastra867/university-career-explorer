import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CareerScoring, RULE_VERSION, normalizeProfile, normalizeJD, evaluate } from '../scripts/job-scoring.js';

const field = (value, extra = {}) => ({ value, value_state:'known', source_type:'user_text', source_refs:[], confirmation_state:'unconfirmed', ...extra });
const profile = { fields: { 'education.degree':field('本科', {source_type:'user_form'}), 'education.major':field('能源工程'), 'skills.self_report':field('会一点 Python'), 'experience.text':field('我用 Excel 记录实验数据，使用 SQL 查询结果。') } };
const jd = '本科及以上，能源工程相关专业。使用 Python、SQL、Excel、MATLAB 完成工作。';

test('fixed normalized profile/JD and rule version always produce exactly the same score and components', () => {
  const p = normalizeProfile(profile), j = normalizeJD(jd);
  const expected = evaluate(p,j);
  assert.equal(expected.rule_version, RULE_VERSION);
  assert.equal(expected.score,75);
  assert.equal(expected.keyword_coverage.total,4);
  assert.deepEqual(expected.matchedSkills,['Excel','Python','SQL']);
  for (let i=0; i<30; i++) assert.deepEqual(evaluate(p,j),expected);
  assert.deepEqual(evaluate({...profile, oldScore:99, softSkills:{communication:99}, directionRanking:['best']},jd),expected);
});

test('unknown or unusable evidence and an empty denominator return null, not a default score', () => {
  for (const p of [{},{experienceText:'大一，能源专业，没有项目和实习，不知道做什么'},{experienceAnalysis:{keywords:['Python'],abilityScores:{technicalSkill:99}}},{fields:{'experience.text':field('Python',{value_state:'unknown'})}}]) {
    const result=evaluate(p,'Python SQL');
    assert.equal(result.status,'not_evaluated');
    assert.equal(result.score,null);
  }
  assert.equal(evaluate(profile,'欢迎加入我们的工作团队').score,null);
  assert.equal(evaluate({experienceText:'Python'},'Excel').score,0);
  assert.equal(evaluate({experienceText:'Python'},'Python').score,100);
});

test('school prestige, intention ranking, campus wording and old inferred ability scores cannot add points', () => {
  const p={studentProfile:{education:'undergraduate',major:'能源工程',school:'测试名校'},experienceText:'使用 Excel',experienceAnalysis:{abilityScores:{technicalSkill:100}},softSkills:{communication:100},directionRanking:['first']};
  const a=evaluate(p,'SQL Excel 本科及以上');
  const b=evaluate({...p,softSkills:{communication:0},experienceAnalysis:null},'校招应届 SQL Excel 本科及以上');
  assert.equal(a.score,50);
  assert.equal(b.score,a.score);
});

test('basic proficiency remains a sourced self report, never a verified skill level', () => {
  const result=evaluate(profile,'要求精通 Python，熟练 SQL');
  const python=result.evidence.find(item=>item.term==='Python');
  assert.equal(python.quote,'会一点 Python');
  assert.equal(python.strength,'self_reported_basic');
  assert.equal(python.verified,false);
  assert.match(python.proficiency_note,/另行核实/);
  assert.doesNotMatch(JSON.stringify(result),/能力等级|熟练掌握|精通 Python。/);
  const raw='我会一点 Python，做过太阳能电池实验。';
  assert.ok(raw.includes(evaluate({experienceText:raw},'Python').evidence[0].quote));
});

test('negations, future learning plans and partial English matches do not become skill evidence', () => {
  for (const text of ['不会 Python','尚未掌握 Python','计划学习 Python','不具备 Python','没用过Python']) {
    const result=evaluate({experienceText:text},'Python');
    assert.deepEqual(result.matchedSkills,[]);
    assert.equal(result.score,null);
  }
  assert.equal(evaluate({experienceText:'JavaScript React'},'Java R').score,0);
  assert.deepEqual(evaluate({experienceText:'NoSQL report'},'SQL R').matchedSkills,[]);
  assert.deepEqual(normalizeJD('JavaScript').terms,['JavaScript']);
});

test('AI inferred fields never qualify a hard gate or prove skills, even if marked confirmed', () => {
  const p={fields:{'education.degree':field('博士',{source_type:'ai_inference',confirmation_state:'confirmed'}),'skills.self_report':field('Python',{source_type:'ai_inference',confirmation_state:'confirmed'})}};
  const result=evaluate(p,'学历要求博士，Python');
  assert.equal(result.eligibility,'uncertain');
  assert.equal(result.hard_gates[0].status,'unknown');
  assert.equal(result.score,null);
  assert.deepEqual(result.evidence,[]);
});

test('entry-level sources in skills arrays are preserved and inferred entries excluded', () => {
  const p={fields:{'skills.self_report':field([{name:'Python',level:'会一点',source_type:'user_form'},{name:'SQL',source_type:'ai_inference'}])}};
  const result=evaluate(p,'Python SQL');
  assert.equal(result.score,50);
  assert.equal(result.evidence[0].strength,'self_reported_basic');
  assert.deepEqual(result.gapSkills,['SQL']);
});

test('hard eligibility is independent of coverage and unknown degree never means ineligible', () => {
  const unknown=evaluate({experienceText:'Python'},'硕士及以上，Python');
  assert.equal(unknown.score,100);
  assert.equal(unknown.eligibility,'uncertain');
  const ineligible=evaluate({experienceText:'Python',degree:'本科'},'学历要求博士，Python');
  assert.equal(ineligible.score,100);
  assert.equal(ineligible.eligibility,'ineligible');
  assert.equal(evaluate({degree:'本科',experienceText:'Python'},'硕士优先，本科及以上，Python').eligibility,'eligible');
  assert.notEqual(evaluate({degree:'本科',experienceText:'Python'},'博士优先，Python').eligibility,'ineligible');
  assert.equal(evaluate({degree:'硕士',experienceText:'Python'},'仅限本科生，Python').eligibility,'ineligible');
});

function pageContext(filename) {
  const elements=new Map();
  const doc={addEventListener(){},createElement(){return {textContent:'',get innerHTML(){return this.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}};},getElementById(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',classList:{contains(){return false;},add(){},remove(){}}});return elements.get(id);}};
  const context=vm.createContext({window:{CareerScoring,addEventListener(){}},document:doc,console,Intl,URL});
  const scripts=[...readFileSync(new URL('../'+filename,import.meta.url),'utf8').matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('src='));
  vm.runInContext(scripts.at(-1)[2],context,{filename});
  return context;
}

test('actual homepage, independent job search, both manual JD paths and report invoke identical scoring', () => {
  const home=pageContext('index.html'), old=pageContext('job-search.html');
  home.cloud=structuredClone(profile); old.cloud=structuredClone(profile);
  home.jdText=jd; old.jdText=jd;
  vm.runInContext('window.CareerProfile={profile:cloud};saveToLocalStorage=function(){};renderJDResult=function(result){globalThis.manualResult=result;};appData.manualJDText=jdText;document.getElementById("jdInput").value=jdText;',home);
  vm.runInContext('window.CareerProfile={profile:cloud};document.getElementById("manualJD").value=jdText;',old);
  const a=vm.runInContext('analyzeRecommendedJob({title:"",snippet:jdText})',home);
  const b=vm.runInContext('analyzeSearchJob({title:"",snippet:jdText})',old);
  const c=vm.runInContext('matchJD();manualResult',home);
  const d=vm.runInContext('calculateOverallScoreForData(appData)',home);
  vm.runInContext('analyzeManualJD()',old);
  assert.equal(a.matchScore,75);
  assert.equal(b.matchScore,a.matchScore);
  assert.equal(c.matchScore,a.matchScore);
  assert.equal(d,a.matchScore);
  assert.equal(a.rule_version,b.rule_version);
  assert.ok(vm.runInContext('document.getElementById("manualResult").innerHTML',old).includes('75%'));
});
