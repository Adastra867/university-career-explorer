/* Resume and practice responses stay in this browser. No user text is sent to a server. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORE = 'careerPredictorPrep';
  const KNOWLEDGE = [
    {topic:'简历', title:'国家大学生就业服务平台 · 就业指导', url:'https://wew.ncss.cn/zdxw', points:['针对岗位选择相关经历。','用真实行动和结果说明贡献，并核对时间线与错字。']},
    {topic:'笔试与面试', title:'国家大学生就业服务平台 · 求职指导', url:'https://wew.ncss.cn/zdxw', points:['提前理解岗位职责和考试形式。','练习具体表达，并在面试结束后复盘。']},
    {topic:'简历', title:'哈佛大学职业中心 · 简历与求职信', url:'https://careerservices.fas.harvard.edu/resources/hes-create-impactful-resumes-and-cover-letters/', points:['简历要简明展示与目标岗位相关的能力、教育和经历。','突出雇主看重的技能与影响。']},
    {topic:'面试', title:'宾夕法尼亚大学职业服务 · 面试建议', url:'https://careerservices.upenn.edu/blog/2022/10/05/interviewing-tips-general-tips/', points:['自我介绍聚焦与岗位有关的经历。','用情境、任务、行动和结果组织回答，并准备反问。']}
  ];
  const SKILLS = ['Excel','SQL','Python','Java','JavaScript','数据分析','可视化','统计','用户调研','竞品分析','需求分析','原型','用户运营','内容运营','活动策划','项目管理','沟通协调','销售','客户服务','新媒体','财务分析','机器学习','测试','设计','研究','建模','流程优化'];
  const INDUSTRIES = {
    internet:{name:'互联网与软件',case:'一款应用的新用户注册完成率连续两周下降。',points:['核对指标口径、渠道和版本变化。','定位用户在哪一步流失，提出可验证方案。','说明协作对象、观察周期及风险。']},
    finance:{name:'金融与银行',case:'某线上金融服务的申请完成率下降，同时客户投诉增加。',points:['区分流程体验、资料要求和风控因素。','兼顾合规、隐私和客户体验。','设计完成率、投诉率与风险指标。']},
    manufacturing:{name:'制造与工程',case:'一条生产线的返工率上升，交付周期变长。',points:['按批次、工序和物料定位异常。','验证根因并小范围试点改进。','兼顾质量、安全、成本和交付。']},
    retail:{name:'零售与电商',case:'某商品页面访问量稳定，但下单转化率下降。',points:['拆分流量、价格、库存和支付环节。','提出小范围对照试验。','同时观察转化、退货和利润。']},
    healthcare:{name:'医疗与健康',case:'门诊预约后的爽约率升高，影响服务安排。',points:['区分渠道、时间段和人群。','方案重视隐私、可及性与安全。','同时衡量爽约率和患者体验。']},
    education:{name:'教育与培训',case:'线上课程前两周的完成率下降。',points:['区分内容、节奏和学习支持问题。','通过访谈验证假设并试点调整。','衡量完成率与实际学习效果。']},
    general:{name:'通用业务',case:'团队接到一个目标不够清晰、时间有限的新任务。',points:['澄清目标、约束和交付标准。','拆解优先级与协作节点。','设定检查点和复盘方式。']}
  };
  const ROLE_BANK = {
    data:{name:'数据分析',questions:[
      ['给定订单表 orders(user_id, order_id, created_at, amount)，写出按日统计下单用户数和成交金额的 SQL 思路，并说明取消订单与重复记录如何处理。',['按业务口径过滤有效订单并确定时区。','对下单用户去重，按日期分组求和。','核查重复订单、取消订单与空值。']],
      ['业务指标本周下降 15%。写出你会检查的分组、验证原因的办法，以及向业务方汇报的结构。',['先检查指标定义与数据质量。','按渠道、地区或用户群拆分并比较基线。','区分相关性与因果，给出可验证建议。']]]},
    software:{name:'软件开发',questions:[
      ['设计“用户重复点击也只创建一条订单”的接口，说明流程、数据约束和失败重试。',['使用幂等键或唯一约束。','考虑并发、事务和重试时的返回行为。','覆盖重复请求、超时与失败测试。']],
      ['接口变慢但错误率不高。写出排查顺序和至少三类证据。',['先确认影响范围和最近变更。','检查调用链、数据库、外部依赖与资源。','提出止损和验证方法。']]]},
    product:{name:'产品管理',questions:[
      ['用户说“注册太麻烦”。写一份简短需求分析：目标用户、证据、方案假设和成功指标。',['先用访谈或漏斗数据验证问题。','说明用户场景和备选方案。','提出成功指标与副作用。']],
      ['支付失败修复、首页改版、新增分享功能同时等待排期。写出排序依据。',['考虑用户影响、业务风险和紧急程度。','核实成本、依赖与证据。','说明沟通和复盘方式。']]]},
    operations:{name:'运营与市场',questions:[
      ['为目标用户设计一场两周拉新或促活活动，写出渠道、预算约束和指标。',['明确目标人群和渠道。','说明执行节奏、预算与风险。','关注转化或留存，而不只看曝光。']],
      ['某活动曝光很高但报名很少。列出转化漏斗的检查点和两种可验证改进。',['检查触达、点击、落地页和报名。','提出小范围对照试验。','说明指标口径与复盘。']]]},
    finance:{name:'财务与金融分析',questions:[
      ['本月实际费用高于预算 12%。写出差异分析表的维度和解释差异的步骤。',['按费用、时间和部门拆分。','区分一次性和持续性因素。','提供可核实的改进建议。']],
      ['一个业务方案能增加收入，也会增加坏账或合规风险。写出评估框架。',['同时评估收益、成本、现金流和风险。','说明关键假设和敏感性分析。','列出审批与持续监测。']]]},
    engineering:{name:'工程与质量',questions:[
      ['某批次产品不良率从 1% 升至 4%。写出排查及临时控制方案。',['确认抽样口径并隔离风险批次。','按设备、物料和工序查因。','验证改进并考虑安全。']],
      ['设计一份工程改进试验计划，说明变量、样本、成功标准和回退条件。',['控制关键变量并保留对照。','样本和指标支撑判断。','设置安全约束和回退。']]]},
    design:{name:'设计与用户体验',questions:[
      ['改进手机端报名流程，写出问题发现、设计重点和验证方法。',['观察真实任务障碍。','考虑反馈、表单负担和无障碍。','用任务完成率和访谈验证。']],
      ['业务方要求“页面更高级”。怎样把要求转为可执行的设计目标？',['询问用户、品牌和业务目的。','提供可比较方案与标准。','说明交付和沟通方式。']]]},
    hr:{name:'人力资源',questions:[
      ['为初级岗位设计结构化面试提纲和评分标准，如何降低主观偏差？',['问题对应岗位能力。','统一问题与行为证据标准。','注意公平、隐私与记录。']],
      ['新人入职一个月仍不清楚职责。写出信息收集与流程改进方案。',['听取新人、主管和协作方反馈。','明确职责、培训和检查节点。','设置可观察的适应指标。']]]},
    sales:{name:'销售与客户成功',questions:[
      ['客户认可产品却迟迟不推进采购。写出需求澄清、跟进和下一步约定。',['了解决策链、预算和场景。','用真实证据回应顾虑。','约定可执行的下一步。']],
      ['客户续约率下降。怎样分层排查流失并提出两项服务改进？',['区分使用、价格和服务问题。','按客户群及阶段分析。','用续约率与活跃度验证。']]]},
    education:{name:'教学与教研',questions:[
      ['设计一节 30 分钟入门课：学习目标、互动环节和课后检验。',['目标可观察且适合基础。','活动与目标一致。','用具体任务检验理解。']],
      ['学生完成率不错，测验却不理想。你会如何诊断并调整？',['检查测验与教学目标。','分析错误类型并访谈。','补救教学后再评估。']]]}
  };
  const blank = () => ({stage:'',role:'',industry:'',confirmed:false,jd:'',resume:'',transcript:[],written:null});
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE) || '{}');
      const data = blank();
      data.stage = ['junior','senior','other'].includes(raw.stage) ? raw.stage : '';
      data.role = typeof raw.role === 'string' ? raw.role.slice(0,80) : '';
      data.industry = Object.prototype.hasOwnProperty.call(INDUSTRIES,raw.industry) ? raw.industry : '';
      data.confirmed = raw.confirmed === true;
      data.jd = typeof raw.jd === 'string' ? raw.jd.slice(0,12000) : '';
      data.resume = typeof raw.resume === 'string' ? raw.resume.slice(0,20000) : '';
      data.transcript = Array.isArray(raw.transcript) ? raw.transcript.filter(t => t && typeof t.question === 'string' && typeof t.answer === 'string').slice(-12) : [];
      if (raw.written && Array.isArray(raw.written.questions) && raw.written.questions.length === 3) {
        data.written = {industry:String(raw.written.industry||'').slice(0,40),group:String(raw.written.group||'').slice(0,40),role:String(raw.written.role||'').slice(0,80),questions:raw.written.questions.map(q => ({prompt:String(q.prompt||'').slice(0,1000),points:Array.isArray(q.points)?q.points.filter(x=>typeof x==='string').slice(0,5):[]})),answers:[0,1,2].map(i=>typeof raw.written.answers?.[i]==='string'?raw.written.answers[i].slice(0,5000):''),reviewed:raw.written.reviewed===true};
      }
      return data;
    } catch (_) { return blank(); }
  }
  const state = load();
  let session = null;
  function save() { try { localStorage.setItem(STORE,JSON.stringify(state)); } catch (_) { $('targetStatus').textContent='本地存储不可用，当前输入可能无法在刷新后保留。'; } }
  function text(parent,tag,value,className) { const el=document.createElement(tag);el.textContent=value;if(className)el.className=className;parent.appendChild(el);return el; }
  function result(parent,title,detail) { const box=text(parent,'div','', 'result');text(box,'strong',title);text(box,'p',detail); }
  function requireTarget(statusId) { if (!state.stage || !state.confirmed || !state.role.trim()) { $(statusId).textContent='请先选择阶段、确认方向并填写目标岗位。';$('role').focus();return false; } $(statusId).textContent='';return true; }
  function coreData() { try { return JSON.parse(localStorage.getItem('careerPredictor')||'{}'); } catch (_) { return {}; } }
  function importCore() {
    const core=coreData();if (!Object.keys(core).length) { $('targetStatus').textContent='没有找到现有测评资料，可手动填写。';return; }
    if (!state.role.trim() || !state.industry) {const first=Array.isArray(core.directionRanking)?core.directionRanking[0]:'';const snapshot=(Array.isArray(core.directionSnapshots)?core.directionSnapshots:[]).find(d=>d&&d.id===first);if(!state.role.trim())state.role=String(core.selectedRecommendedJob?.title||snapshot?.jobs?.[0]||snapshot?.direction||'').slice(0,80);if(!state.industry&&snapshot?.industry){const label=String(snapshot.industry);state.industry=/金融|银行|证券/.test(label)?'finance':/制造|工程|汽车|机械|能源/.test(label)?'manufacturing':/零售|电商|消费/.test(label)?'retail':/医疗|医药|健康/.test(label)?'healthcare':/教育|培训/.test(label)?'education':/互联网|软件|科技|游戏/.test(label)?'internet':'';}}
    if (!state.jd.trim()) state.jd=typeof core.manualJDText==='string'?core.manualJDText.slice(0,12000):'';
    if (!state.resume.trim()) state.resume=typeof core.experienceText==='string'?core.experienceText.slice(0,20000):'';
    fill();save();$('targetStatus').textContent=state.role||state.jd||state.resume?'已导入可用资料，请核对。':'现有资料没有岗位或经历，请手动填写。';
  }
  function useExperience() {const exp=coreData().experienceText;if (typeof exp!=='string'||!exp.trim()) {$('targetStatus').textContent='现有测评中没有经历原文。';return;}if(state.resume.trim()&&!confirm('用已保存经历替换当前简历文本？'))return;state.resume=exp.slice(0,20000);$('resume').value=state.resume;save();$('targetStatus').textContent='已填入经历，请按简历格式补充教育与技能。';}
  function jdTerms(jd) {return SKILLS.filter(term=>jd.toLowerCase().includes(term.toLowerCase())).slice(0,15);}
  function analyzeResume() {
    if(!requireTarget('targetStatus'))return;const out=$('diagnosis');out.replaceChildren();const resume=state.resume.trim();
    if(resume.length<40){result(out,'先补充简历正文','至少写一段教育、项目或实习经历，才能给出有依据的建议。');return;}
    result(out,'本次目标：'+state.role,'把最相关的经历放在显眼位置，并用证据解释岗位匹配。');
    if(!/教育|学历|本科|大学|研究生|硕士|毕业/.test(resume))result(out,'补充教育背景','写明学校、专业、学历和预计毕业时间。');
    if(!/实习|项目|科研|竞赛|社团|实践/.test(resume))result(out,'标明经历类别','注明名称、时间、角色和职责，便于快速定位。');
    if(!/负责|设计|搭建|分析|推动|协调|完成|优化|开发|策划|研究|组织/.test(resume))result(out,'把职责写成行动','说明你个人具体做过什么，避免只写“参与”或“熟悉”。');
    if(!/\d+\s*(%|％|人|次|份|个|万元?|小时|天|周|月)|提升|降低|节省|交付|反馈/.test(resume))result(out,'补充可核实的结果','可以写真实数字、交付物或反馈，不要编造数据。');
    if(!/技能|工具|证书|语言/.test(resume))result(out,'列出相关技能','仅写实际用过且能在面试中解释的工具和方法。');
    const terms=jdTerms(state.jd);if(terms.length){const present=terms.filter(t=>resume.toLowerCase().includes(t.toLowerCase()));const missing=terms.filter(t=>!present.includes(t));result(out,'JD 字面覆盖：'+present.length+'/'+terms.length,'这是术语检查，不代表能力或筛选通过率。只补充能用经历证明的要求。');if(present.length)text(out,'div','已体现：'+present.join('、'),'chip');if(missing.length)text(out,'div','待核对：'+missing.join('、'),'chip');}else result(out,'对照真实 JD','找出 3—5 项核心任务，逐条核对简历证据。');
    result(out,'改写句式','我负责【任务】，使用【方法】完成【产出】，带来【真实结果或反馈】。');result(out,'投递前人工复核','检查事实、时间线、错字和附件格式。');
  }
  function resolveIndustry() {if(state.industry)return state.industry;const value=state.role+' '+state.jd.slice(0,1500);if(/银行|证券|保险|基金|信贷|金融/.test(value))return 'finance';if(/制造|工厂|机械|汽车|生产线|供应链/.test(value))return 'manufacturing';if(/电商|零售|门店|快消/.test(value))return 'retail';if(/医疗|医药|医院|健康|护理/.test(value))return 'healthcare';if(/教育|教学|教研|培训|课程/.test(value))return 'education';if(/互联网|软件|平台|应用|游戏|开发/.test(value))return 'internet';return 'general';}
  function resolveGroup() {const role=state.role;if(/开发|程序|软件工程|前端|后端|测试工程|运维|developer|software engineer/i.test(role))return 'software';if(/数据分析|商业分析|算法|统计|BI\b|data analyst|data scientist/i.test(role))return 'data';if(/运营|市场|营销|推广|品牌|新媒体|marketing|operations/i.test(role))return 'operations';if(/产品经理|产品助理|用户研究|product manager/i.test(role))return 'product';if(/财务|会计|审计|投研|风控|accountant|financial analyst/i.test(role))return 'finance';if(/人力|招聘|组织发展|HR\b|recruiter/i.test(role))return 'hr';if(/销售|商务|客户成功|客户经理|sales|customer success/i.test(role))return 'sales';if(/设计|交互|视觉|UI\b|UX\b|designer/i.test(role))return 'design';if(/机械|工艺|质量|设备|制造|工程师|mechanical engineer/i.test(role))return 'engineering';if(/教师|教学|教研|讲师|teacher|instructor/i.test(role))return 'education';if(/SQL|Python|数据分析/.test(state.jd))return 'data';return 'general';}
  function generateWritten() {
    if(!requireTarget('writtenStatus'))return;if(state.written&&state.written.answers.some(a=>a.trim())&&!confirm('重新生成将清空当前笔试答案，继续吗？'))return;
    const industry=INDUSTRIES[resolveIndustry()],group=ROLE_BANK[resolveGroup()],role=state.role.trim(),term=jdTerms(state.jd)[0];
    const generic=[ [`结合${role}岗位${term?`对“${term}”的要求`:'的主要职责'}，说明如何完成一项典型任务。`,['拆解目标、约束和交付物。','说明方法与协作对象。','提出结果验证与复盘方式。']], [`如果${role}岗位的一项关键指标未达目标，怎样发现原因并制定下一步计划？`,['核对指标口径和数据。','区分可能原因并优先验证。','提出可执行方案及检查节点。']] ];
    const questions=[{prompt:`【${industry.name}情境题】${industry.case}请从“${role}”岗位的视角写出分析步骤、行动方案和衡量结果的方法。`,points:industry.points},...(group?group.questions:generic).map(([prompt,points])=>({prompt,points}))];
    state.written={industry:industry.name,group:group?.name||'通用岗位',role,questions,answers:['','',''],reviewed:false};save();renderWritten();
  }
  function renderWritten() {
    const box=$('writtenQuestions');box.replaceChildren();$('reviewWrittenBtn').classList.toggle('hidden',!state.written);if(!state.written)return;
    $('writtenStatus').textContent=`已匹配：${state.written.industry} · ${state.written.group}（${state.written.role}）`;
    state.written.questions.forEach((q,i)=>{const card=text(box,'div','', 'written-item');text(card,'strong','第 '+(i+1)+' 题');text(card,'p',q.prompt);const label=text(card,'label','', 'field');text(label,'span','你的答案');const answer=document.createElement('textarea');answer.id='writtenAnswer'+i;answer.maxLength=5000;answer.rows=4;answer.placeholder='写下分析过程、方案和判断依据';answer.value=state.written.answers[i];answer.addEventListener('input',()=>{state.written.answers[i]=answer.value;if(state.written.reviewed){state.written.reviewed=false;box.querySelectorAll('.review').forEach(el=>el.remove());}save();});label.appendChild(answer);if(state.written.reviewed){const review=text(card,'div','', 'review');text(review,'strong','参考要点');const list=document.createElement('ul');q.points.forEach(point=>text(list,'li',point));review.appendChild(list);}});
  }
  function reviewWritten() {if(!state.written)return;const missing=state.written.answers.findIndex(a=>a.trim().length<20);if(missing>=0){$('writtenStatus').textContent=`请先完成第 ${missing+1} 题（至少 20 字）。`;$('writtenAnswer'+missing).focus();return;}state.written.reviewed=true;save();renderWritten();$('writtenStatus').textContent='已显示参考要点，请逐题核对。';}
  function interviewQuestions(){const role=state.role.trim(),term=jdTerms(state.jd)[0];return [`请用约一分钟介绍自己，并说明为什么申请${role}。`,`请讲一段最能证明你适合${role}的项目、实习或校园经历。你具体做了什么？`,term?`岗位提到了“${term}”。如果入职后要用它解决新问题，你会如何推进并验证结果？`:`如果你入职${role}后接到目标不清晰的任务，你会怎样推进并验证结果？`,`如果你有机会向${role}团队提问，你最想了解什么？为什么？`];}
  function showQuestion(prompt){$('questionBox').classList.remove('hidden');$('roundLabel').textContent=session.followup?`第 ${session.round+1} 轮 · 追问`:`第 ${session.round+1} / 4 轮`;$('questionText').textContent=prompt||session.questions[session.round];}
  function startInterview(){if(!requireTarget('interviewStatus'))return;if(state.transcript.length&&!confirm('开始新面试将清空当前问答记录，继续吗？'))return;state.transcript=[];session={round:0,followup:false,questions:interviewQuestions()};$('answer').value='';$('answerWrap').classList.remove('hidden');showQuestion();renderTranscript();save();$('answer').focus();}
  function evaluate(round,answer){const notes=[];if(answer.length<80)notes.push('回答较短，可补充具体场景与个人贡献。');if(round===0){if(!answer.includes(state.role.trim()))notes.push('请把经历与目标岗位联系起来。');if(!/实习|项目|科研|竞赛|课程|社团/.test(answer))notes.push('加入一段相关经历作证据。');}else if(round===1){if(!/负责|设计|分析|协调|推动|完成|开发|组织|优化|策划/.test(answer))notes.push('说清你本人采取的行动。');if(!/结果|提升|降低|交付|完成|获得|反馈|\d/.test(answer))notes.push('补充真实结果或交付物。');}else if(round===2){if(!/目标|需求|问题|指标|确认/.test(answer))notes.push('先确认目标和成功标准。');if(!/验证|复盘|反馈|测试|评估|数据|结果/.test(answer))notes.push('说明如何验证方案。');}else if(!/团队|业务|岗位|目标|协作|成长|考核|项目/.test(answer))notes.push('反问可聚焦团队任务、岗位成功标准或协作。');if(!notes.length)notes.push('结构基本完整，继续用可核实的细节增强说服力。');return notes;}
  function submitAnswer(){if(!session)return;const answer=$('answer').value.trim();if(answer.length<12){$('interviewStatus').textContent='请先写出至少一句完整回答。';return;}const notes=evaluate(session.round,answer);state.transcript.push({question:$('questionText').textContent,answer,feedback:notes.join(' ')});$('answer').value='';renderTranscript();save();$('interviewStatus').textContent='';if(session.followup){session.followup=false;session.round++;}else if(session.round===1&&notes.some(n=>/本人采取|真实结果/.test(n))){session.followup=true;showQuestion('追问：请补充你本人采取的关键行动，以及可核实的结果或反馈。');$('answer').focus();return;}else session.round++;if(session.round>=4){session=null;$('questionBox').classList.add('hidden');$('answerWrap').classList.add('hidden');$('interviewStatus').textContent='四轮练习已完成，可下载记录后重练。';return;}showQuestion();$('answer').focus();}
  function renderTranscript(){const box=$('transcript');box.replaceChildren();if(!state.transcript.length)return;text(box,'h3','问答记录与反馈');state.transcript.forEach((turn,i)=>{const item=text(box,'div','', 'turn');text(item,'small','问题 '+(i+1));text(item,'p',turn.question);text(item,'small','你的回答');text(item,'p',turn.answer);text(item,'div',turn.feedback||'', 'feedback');});}
  function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportRecord(){if(!state.transcript.length&&!state.written){$('interviewStatus').textContent='请先练习面试或生成笔试题。';return;}const lines=[`目标岗位：${state.role}`,`阶段：${state.stage}`,`导出时间：${new Date().toLocaleString('zh-CN')}`,''];state.transcript.forEach((t,i)=>lines.push(`${i+1}. ${t.question}`,`回答：${t.answer}`,`反馈：${t.feedback}`,''));if(state.written){lines.push(`笔试练习：${state.written.industry} · ${state.written.group}`,'');state.written.questions.forEach((q,i)=>lines.push(`第 ${i+1} 题：${q.prompt}`,`回答：${state.written.answers[i]||'未作答'}`,`参考要点：${q.points.join('；')}`,''));}download('求职练习记录.txt',lines.join('\n'),'text/plain;charset=utf-8');}
  function renderSources(){const box=$('sources');KNOWLEDGE.forEach(item=>{const card=text(box,'div','', 'source');const link=text(card,'a',item.topic+' · '+item.title+' ↗');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';text(card,'p',item.points.join(' '));});}
  function fill(){['stage','role','industry','jd','resume'].forEach(id=>$(id).value=state[id]);$('confirmed').checked=state.confirmed;renderTranscript();renderWritten();}
  ['stage','role','industry','jd','resume'].forEach(id=>$(id).addEventListener('input',()=>{state[id]=$(id).value;save();}));$('confirmed').addEventListener('change',()=>{state.confirmed=$('confirmed').checked;save();});
  $('importBtn').addEventListener('click',importCore);$('experienceBtn').addEventListener('click',useExperience);$('analyzeBtn').addEventListener('click',analyzeResume);$('startBtn').addEventListener('click',startInterview);$('submitBtn').addEventListener('click',submitAnswer);$('generateWrittenBtn').addEventListener('click',generateWritten);$('reviewWrittenBtn').addEventListener('click',reviewWritten);$('exportBtn').addEventListener('click',exportRecord);$('downloadKbBtn').addEventListener('click',()=>download('职途星轨-求职知识包.json',JSON.stringify({title:'职途星轨求职知识包',description:'本站根据公开资料整理的练习要点，请通过链接阅读原文。',items:KNOWLEDGE},null,2),'application/json;charset=utf-8'));
  fill();renderSources();
})();
