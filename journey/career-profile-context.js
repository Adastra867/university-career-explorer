import { FIELD_PATHS } from '../p0/analysis.js';

export const PROFILE_CONTEXT_LIMITS = Object.freeze({ experience: 8000, field: 2000, total: 24000 });
const SOURCE_TYPES = new Set(['user_form', 'user_text', 'document_extract', 'legacy_import', 'ai_inference']);
const LOCAL_FIELDS = ['experience', 'interests', 'values', 'goals', 'constraints'];
const PREFERENCE_FIELDS = ['location', 'locations', 'industries', 'workStyle', 'schedule', 'values'];
const ALIASES = { education: 'education.degree', major: 'education.major', stage: 'education.stage', experience: 'experience.text', goals: 'preferences.long_term_goal' };
const CONFIRMED = new Set(['confirmed', 'corrected']);
const EXPERIENCE_GROUP_HEADING = /^(?:【(?:项目|科研|实习|工作|研究|竞赛|实践)(?:经历)?】|(?:项目|科研|实习|工作|研究|竞赛|实践)经历[：:]?)$/u;

export function redactProfileText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200d\ufeff]/g, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已省略]')
    .replace(/(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, '[联系电话已省略]')
    .replace(/\d{17}[\dXx](?!\d)/g, '[证件号已省略]')
    .replace(/(?:微信(?:号)?|QQ|学号|电话|手机|联系(?:方式|人))\s*[:：]\s*[^\s，,。；;]+/gi, '[联系资料已省略]')
    .trim();
}

const canonicalField = field => ALIASES[field] || field;
const normalizedValue = value => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const isExperience = fact => canonicalField(fact.field) === 'experience.text';
const safeSource = source => source === 'sqlite' ? 'sqlite' : 'browser';

function priority(fact) {
  if (fact.verificationStatus === 'inference') return 4;
  if (CONFIRMED.has(fact.confirmation)) return 0;
  if (fact.provenance === 'user_form') return 1;
  if (fact.provenance === 'document_extract') return 3;
  return 2;
}

function compareFacts(a, b) {
  return priority(a) - priority(b) || Number(b.source === 'sqlite') - Number(a.source === 'sqlite');
}

function cleanFact(fact, source) {
  const field = canonicalField(fact.field);
  const value = redactProfileText(fact.value ?? fact.name);
  if (!value) return null;
  const provenance = SOURCE_TYPES.has(fact.provenance) ? fact.provenance : fact.provenance || 'user_authorized_profile';
  const confirmation = CONFIRMED.has(fact.confirmation) ? fact.confirmation : 'unconfirmed';
  return {
    ...fact, field, ...(fact.name ? { name: value } : { value }), provenance, confirmation,
    verificationStatus: fact.verificationStatus === 'inference' || provenance === 'ai_inference' && !CONFIRMED.has(confirmation) ? 'inference' : 'self_reported',
    source: safeSource(source), sourceId: safeSource(source) + ':' + field,
  };
}

function fieldsFromProfile(profile, source, consent = true) {
  if (!profile || !consent) return [];
  const authorized = Array.isArray(profile.authorizedFields) ? new Set(profile.authorizedFields) : null;
  const facts = [];
  function addLegacy(fact, index = 0) {
    const cleaned = cleanFact(fact, source);
    if (cleaned) facts.push({ ...cleaned, sourceId: safeSource(source) + ':legacy:' + cleaned.field + ':' + index });
  }
  // The legacy API accepts a small explicit whitelist, never arbitrary localStorage.
  for (const field of ['education', 'major', 'stage']) {
    if (!authorized || authorized.has(field)) addLegacy({ field, value: profile[field], provenance: 'user_authorized_profile' });
  }
  if ((!authorized || authorized.has('skills')) && Array.isArray(profile.skills)) {
    profile.skills.forEach((skill, index) => {
      if (!skill || typeof skill !== 'object') return;
      addLegacy({ field: 'skill', name: skill.name, evidence: redactProfileText(skill.evidence), level: redactProfileText(skill.level),
        verificationStatus: skill.evidenceType === 'score' || skill.level === 'score_only' ? 'inference' : 'self_reported',
        provenance: 'user_authorized_profile_self_reported_not_certification' }, index);
    });
  }
  if ((!authorized || authorized.has('preferences')) && profile.preferences && typeof profile.preferences === 'object') {
    for (const field of PREFERENCE_FIELDS) {
      const raw = profile.preferences[field];
      const value = Array.isArray(raw) ? raw.map(redactProfileText).filter(Boolean).join('、') : raw;
      addLegacy({ field: 'preference.' + field, value, provenance: 'user_authorized_profile_preference_not_hiring_requirement' });
    }
    if (['same', 'cross', 'unsure'].includes(profile.preferences.employmentChoice)) {
      addLegacy({ field: 'preference.employmentChoice', value: profile.preferences.employmentChoice,
        provenance: 'user_authorized_profile_preference_not_hiring_requirement' });
    }
    if (Array.isArray(profile.preferences.directions)) profile.preferences.directions.forEach((direction, index) => {
      addLegacy({ field: 'preference.direction', value: direction?.title,
        jobs: Array.isArray(direction?.jobs) ? direction.jobs.map(redactProfileText).filter(Boolean) : [],
        provenance: 'user_authorized_profile_preference_not_hiring_requirement' }, index);
    });
  }
  for (const field of LOCAL_FIELDS) {
    if (authorized && !authorized.has(field)) continue;
    const fact = cleanFact({ field, value: profile[field], provenance: 'user_authorized_profile' }, source);
    if (fact) facts.push({ ...fact, sourceId: safeSource(source) + ':local:' + fact.field });
  }
  for (const field of FIELD_PATHS) {
    if (authorized && !authorized.has(field) && !authorized.has('fields')) continue;
    const record = profile.fields?.[field];
    if (record?.value_state !== 'known') continue;
    const fact = cleanFact({
      field, value: record.value, provenance: record.source_type,
      confirmation: record.confirmation_state,
    }, source);
    if (fact) facts.push({ ...fact, sourceId: safeSource(source) + ':fields:' + fact.field });
  }
  return facts;
}

function experienceHeading(line) {
  const text = line.trim();
  const formatted = /^(?:#{1,6}\s+|(?:\d+[.)、]|[一二三四五六七八九十]+[、.)）]|[（(][一二三四五六七八九十\d]+[)）])\s*)(.+)$/u.exec(text);
  const title = formatted ? formatted[1] : text;
  const typed = /^(?:【(?:项目|科研|实习|工作|研究|竞赛|实践)[^\n】]{0,90}】|(?:项目|科研|实习|工作|研究|竞赛|实践)(?:经历|名称|课题|单位)?(?:[一二三四五六七八九十\d]+)?\s*[：:])/u.test(title);
  if (!typed && (!formatted || title.length > 140 || /[。！？]/u.test(title))) return null;
  if (!/项目|科研|实习|工作|研究|竞赛|实践/u.test(title)) return null;
  if (/^(?:(?:项目|科研|实习|工作|研究|竞赛|实践)(?:的)?\s*)?(?:背景|目标|职责|任务|技术方案|技术路线|方法|过程|成果|收获|产出|总结|内容)(?:[：:]|$)/u.test(title)) return null;
  if (!typed && /^(?:我|负责|参与|使用|采用|完成|设计|开发|记录)/u.test(title)) return null;
  return title;
}

function splitExperiences(fact) {
  const value = fact.value;
  const headings = [];
  let position = 0;
  for (const line of value.split('\n')) {
    const title = experienceHeading(line);
    if (title) headings.push({ start: position, lineEnd: position + line.length, title });
    position += line.length + 1;
  }
  const boundaries = headings.filter((heading, index) => {
    const groupLabel = EXPERIENCE_GROUP_HEADING.test(heading.title);
    const next = headings[index + 1];
    return !groupLabel || !next || Boolean(value.slice(heading.lineEnd, next.start).trim());
  });
  if (!boundaries.length) boundaries.push({ start: 0 });
  return boundaries.map((heading, index) => {
    const start = index === 0 ? 0 : heading.start;
    const end = boundaries[index + 1]?.start ?? value.length;
    return { ...fact, value: value.slice(start, end).trim(), sourceId: fact.sourceId + ':' + (index + 1),
      sourceLocator: { field: 'experience.text', start, end, coordinateSpace: 'redacted_normalized_text' } };
  });
}

function mergeFacts(candidates, profile) {
  const cleared = new Set(FIELD_PATHS.filter(field => {
    const record = profile?.fields?.[field];
    return record && record.value === null && record.source_type === 'user_form' && CONFIRMED.has(record.confirmation_state);
  }));
  const grouped = new Map();
  for (const candidate of candidates) {
    const field = canonicalField(candidate.field);
    if (cleared.has(field)) continue;
    const list = grouped.get(field) || [];
    const entries = isExperience(candidate) ? splitExperiences(candidate) : [candidate];
    list.push(...entries);
    grouped.set(field, list);
  }
  const facts = [];
  const conflicts = [];
  for (const [field, entries] of grouped) {
    const unique = new Map();
    for (const entry of entries.sort(compareFacts)) {
      const key = normalizedValue(entry.value ?? entry.name);
      const original = unique.get(key);
      if (original) {
        original.sources = [...new Set([...(original.sources || [original.source]), entry.source])];
      } else unique.set(key, { ...entry });
    }
    const options = [...unique.values()];
    if (field === 'experience.text' || field === 'skill' || field === 'preference.direction') {
      facts.push(...options);
      continue;
    }
    const [selected, ...alternatives] = options;
    if (alternatives.length) {
      const conflict = { field, requiresConfirmation: true, selectedSourceId: selected.sourceId,
        alternatives: alternatives.map(({ value, name, source, sourceId, provenance, confirmation, verificationStatus }) => ({
          value: value ?? name, source, sourceId, provenance, confirmation, verificationStatus,
        })) };
      selected.conflict = conflict;
      conflicts.push(conflict);
    }
    facts.push(selected);
  }
  return { facts: facts.sort(compareFacts), conflicts, cleared };
}

function keywords(question) {
  const text = redactProfileText(question).toLowerCase();
  const words = new Set(text.match(/[a-z][a-z0-9+#.-]{1,40}/g) || []);
  for (const part of new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text)) {
    if (part.isWordLike && part.segment.length > 1) words.add(part.segment);
  }
  return [...words].filter(word => !['经历', '项目', '个人', '根据', '结合', '规划', '成长', '路线', '如何', '请帮', '本次'].includes(word));
}

function relevance(value, terms) {
  const text = value.toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function excerpt(value, limit, terms) {
  if (value.length <= limit) return { text: value, ranges: [{ start: 0, end: value.length }] };
  if (limit < 80) return { text: '', ranges: [] };
  const chunkSize = Math.min(800, Math.floor(limit / 3));
  const chunks = [];
  for (let start = 0; start < value.length; start += chunkSize) {
    const end = Math.min(value.length, start + chunkSize);
    chunks.push({ start, end, score: relevance(value.slice(start, end), terms) });
  }
  // Include both the introduction and the outcome, then prioritize relevant work.
  const ordered = [chunks[0], chunks.at(-1), ...chunks.slice(1, -1).sort((a, b) => b.score - a.score || a.start - b.start)];
  const selected = [];
  let length = 0;
  for (const chunk of ordered) {
    if (selected.some(item => item.start === chunk.start)) continue;
    const separator = selected.length ? 7 : 0;
    const remaining = limit - length - separator;
    if (remaining < 80) continue;
    const size = Math.min(chunk.end - chunk.start, remaining);
    selected.push({ start: chunk.start, end: chunk.start + size });
    length += size + separator;
  }
  const ranges = selected.sort((a, b) => a.start - b.start);
  return { text: ranges.map(range => value.slice(range.start, range.end)).join('\n[摘录]\n'), ranges };
}

function budgetFacts(facts, question, conflicts, limits) {
  const terms = keywords(question);
  const ordered = [...facts].sort((a, b) => compareFacts(a, b) ||
    Number(isExperience(a)) - Number(isExperience(b)) || relevance(b.value || b.name, terms) - relevance(a.value || a.name, terms));
  const output = [];
  const truncatedFields = [];
  const metadata = [];
  const alternativeGroups = [];
  let remaining = limits.total;
  for (const fact of ordered) {
    const value = fact.value ?? fact.name;
    const limit = Math.min(isExperience(fact) ? limits.experience : limits.field, remaining);
    const selected = excerpt(value, limit, terms);
    const included = selected.text.length;
    if (included < value.length) {
      truncatedFields.push({ field: fact.field, sourceId: fact.sourceId, originalCharacters: value.length,
        includedCharacters: included, reason: limit < (isExperience(fact) ? limits.experience : limits.field) ? 'total_budget' : 'field_budget',
        strategy: 'relevance_excerpt' });
    }
    if (!included) continue;
    const next = { ...fact, ...(fact.name ? { name: selected.text } : { value: selected.text }) };
    for (const key of ['evidence', 'level', 'jobs']) delete next[key];
    if (included < value.length) next.excerpt = { strategy: 'relevance_excerpt', originalCharacters: value.length, sourceId: fact.sourceId,
      coordinateSpace: 'redacted_normalized_text', ranges: selected.ranges };
    remaining -= included;
    if (next.conflict) {
      next.conflict = { ...next.conflict, alternatives: [], alternativeCount: next.conflict.alternatives.length };
      alternativeGroups.push({ field: fact.field, original: fact.conflict.alternatives, target: next.conflict.alternatives });
    }
    output.push(next);
    metadata.push({ original: fact, target: next });
  }
  // Resolve the main facts first so conflicting older values cannot consume their budget.
  for (const { field, original, target } of alternativeGroups) {
    for (const alternative of original) {
      const selected = excerpt(alternative.value, Math.min(limits.field, remaining), terms);
      if (selected.text.length < alternative.value.length) truncatedFields.push({ field, sourceId: alternative.sourceId,
        originalCharacters: alternative.value.length, includedCharacters: selected.text.length,
        reason: 'conflict_budget', strategy: 'relevance_excerpt' });
      if (selected.text) target.push({ ...alternative, value: selected.text });
      remaining -= selected.text.length;
    }
  }
  // Secondary skill evidence and suggested job names use the remaining budget.
  for (const { original, target } of metadata) {
    for (const key of ['evidence', 'level', 'jobs']) {
      const values = Array.isArray(original[key]) ? original[key] : [original[key]];
      const included = [];
      for (const value of values.filter(value => typeof value === 'string' && value)) {
        const selected = excerpt(value, Math.min(limits.field, remaining), terms);
        if (selected.text.length < value.length) truncatedFields.push({ field: original.field,
          sourceId: original.sourceId + ':' + key, originalCharacters: value.length, includedCharacters: selected.text.length,
          reason: 'metadata_budget', strategy: 'relevance_excerpt' });
        if (selected.text) included.push(selected.text);
        remaining -= selected.text.length;
      }
      if (included.length) target[key] = Array.isArray(original[key]) ? included : included[0];
    }
  }
  return { profile: output, truncatedFields, totalCharacters: limits.total - remaining, conflictCount: conflicts.length };
}

function structured(profile, cleared) {
  const byField = new Map(profile.map(fact => [fact.field, fact.value ?? fact.name]));
  const tokens = value => typeof value === 'string' ? value.split(/[、，,；;\n]+/).map(item => item.trim()).filter(Boolean) : [];
  return {
    education: Object.fromEntries(['stage', 'degree', 'major', 'school'].map(field => [field, byField.get('education.' + field) || null])),
    experiences: profile.filter(isExperience).map(fact => ({
      type: /科研|研究|论文/.test(fact.value.slice(0, 100)) ? 'research' : /实习/.test(fact.value.slice(0, 100)) ? 'internship' : /项目/.test(fact.value.slice(0, 100)) ? 'project' : 'experience',
      title: (fact.value.split('\n').map(experienceHeading).find(title => title && !EXPERIENCE_GROUP_HEADING.test(title)) || '').slice(0, 120),
      description: fact.value, skills: [], achievements: [], source: fact.source, sourceId: fact.sourceId,
      confirmation: fact.confirmation, sourceLocator: fact.sourceLocator, ...(fact.excerpt ? { excerpt: fact.excerpt } : {}),
    })),
    skills: [...new Set([...tokens(byField.get('skills.self_report')), ...profile.filter(fact => fact.field === 'skill').map(fact => fact.name)])],
    interests: tokens(byField.get('interests')),
    careerPreferences: { longTermGoal: byField.get('preferences.long_term_goal') || null, city: byField.get('preferences.city') || null,
      directions: profile.filter(fact => fact.field === 'preference.direction').map(fact => fact.value) },
    constraints: tokens(byField.get('constraints')),
    unknownFields: [...FIELD_PATHS, 'interests', 'constraints'].filter(field => !byField.has(field)),
    clearedFields: [...cleared],
    conflicts: profile.filter(fact => fact.conflict).map(fact => fact.conflict),
  };
}

export function buildCareerProfileContext({ body = {}, resolvedProfile, limits = PROFILE_CONTEXT_LIMITS } = {}) {
  const disabled = body.profileUsage?.enabled === false;
  const connectionStatus = resolvedProfile?.status || (resolvedProfile?.authenticated ? 'connected' : 'not_connected');
  const sqliteAuthorized = !disabled && resolvedProfile?.authenticated === true && resolvedProfile?.consent === true;
  const localAuthorized = !disabled && body.profile?.consent === true &&
    (body.profileUsage?.localConsent === true || body.profileUsage === undefined);
  const database = sqliteAuthorized ? resolvedProfile.profile : null;
  const candidates = [
    ...fieldsFromProfile(database, 'sqlite', sqliteAuthorized),
    ...fieldsFromProfile(body.profile, 'browser', localAuthorized),
  ];
  const merged = mergeFacts(candidates, database);
  const budget = budgetFacts(merged.facts, body.message ?? body.question, merged.conflicts, limits);
  const summary = structured(budget.profile, merged.cleared);
  const sources = new Set(budget.profile.flatMap(fact => [
    ...(fact.sources || [fact.source]), ...(fact.conflict?.alternatives.map(alternative => alternative.source) || []),
  ]));
  const authorized = sqliteAuthorized || localAuthorized;
  let status = budget.profile.length ? 'available' : authorized ? 'empty' : 'not_authorized';
  if (!authorized && ['not_connected', 'session_expired', 'storage_unavailable', 'load_failed'].includes(connectionStatus)) status = connectionStatus;
  if (!budget.profile.length && ['session_expired', 'storage_unavailable', 'load_failed'].includes(connectionStatus)) status = connectionStatus;
  if (disabled) status = 'not_requested';
  const profileDiagnostics = {
    status, connectionStatus, authenticated: resolvedProfile?.authenticated === true,
    sqliteRead: resolvedProfile?.authenticated === true && Boolean(resolvedProfile?.profile), authorized,
    profileAvailable: budget.profile.length > 0,
    source: sources.size > 1 ? 'mixed' : [...sources][0] || 'none', sourceCount: sources.size,
    fieldCount: new Set(budget.profile.map(fact => fact.field)).size,
    experienceCount: summary.experiences.length, historyCount: Array.isArray(body.history) ? body.history.slice(-8).length : 0,
    totalCharacters: budget.totalCharacters,
    educationCount: Object.values(summary.education).filter(Boolean).length,
    skillCount: summary.skills.length,
    preferenceCount: budget.profile.filter(fact => fact.field.startsWith('preference.') || fact.field.startsWith('preferences.')).length,
    conflictCount: budget.conflictCount,
    truncatedFields: budget.truncatedFields,
    usedByModel: false,
  };
  return { profile: budget.profile, profileDiagnostics, structuredProfile: summary };
}
