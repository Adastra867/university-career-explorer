// Chinese summaries of O*NET occupation descriptions. These records do not represent vacancies.
const occupations = [
  {
    code: '17-2131.00', title: '材料工程师', english: 'Materials Engineers',
    content: '评估材料并开发生产工艺，以达到产品设计与性能要求。工作任务包括材料或产品测试、监测材料性能和退化，以及用计算机模拟材料特性。',
    keywords: ['材料', '电池', '光伏', '复合材料', '性能测试', '材料研发', '材料仿真', '退化'],
  },
  {
    code: '17-2199.03', title: '能效工程师', english: 'Energy Engineers, Except Wind and Solar',
    content: '为建筑及工业场景分析能源消耗，开展能源审计和能效建模，并评估节能措施。工作涉及现场测量、工程软件和能源项目报告。',
    keywords: ['能源', '节能', '能效', '能源审计', '能源建模', '能源管理', '建筑', '暖通'],
  },
  {
    code: '15-2051.00', title: '数据科学家', english: 'Data Scientists',
    content: '运用编程、数据建模、机器学习和可视化，从结构化或非结构化数据中提取有用信息，并解释和报告结果。',
    keywords: ['数据科学', '数据分析', '机器学习', '建模', '可视化', '材料信息学', '人工智能', 'Python'],
  },
  {
    code: '15-2031.00', title: '运筹分析师', english: 'Operations Research Analysts',
    content: '通过数学建模、仿真与优化比较决策方案。应用场景包括工期、成本和物流网络，需要定义约束、分析数据并向决策方说明模型结果。',
    keywords: ['运筹', '调度', '优化', '物流', '供应链', '成本', '仿真', '决策分析'],
  },
  {
    code: '15-1252.00', title: '软件开发工程师', english: 'Software Developers',
    content: '分析用户需求并设计、开发或更新软件。部分任务涉及硬件与软件集成、性能规格或团队内的数据库开发协调。',
    keywords: ['软件开发', '软件工程', '编程', '计算机', '应用开发', '系统集成', '后端', '前端'],
  },
  {
    code: '13-1161.00', title: '市场研究与营销分析师', english: 'Market Research Analysts and Marketing Specialists',
    content: '调查市场并整理产品、客户、竞争者或价格信息，用于估计销售潜力和制定营销计划。部分工作涉及网站指标及搜索可见度分析。',
    keywords: ['市场研究', '营销', '市场调研', '市场分析', '品牌', '用户研究', '竞争', '产品'],
  },
];

export const careerOccupationSources = occupations.map(({ code, title, english, content, keywords }) => ({
  id: `onet_${code.replace('.', '_')}`,
  title: `O*NET · ${title}`,
  publisher: 'O*NET OnLine / U.S. Department of Labor',
  url: `https://www.onetonline.org/link/details/${code}`,
  checkedAt: '2026-11-12',
  region: '美国职业分类',
  language: 'en',
  license: 'O*NET OnLine 原文的中文事实转述，保留官方来源链接。',
  locator: `${english} (${code}) → Overview / Tasks`,
  excerpt: content,
  content,
  applicability: '用于比较职责与可迁移技能。招聘门槛、开放状态与市场需求请核对目标地区的正式招聘资料。',
  keywords: [english, ...keywords],
  category: 'occupation',
  refreshAfterDays: 180,
  trustLevel: 'official',
}));
