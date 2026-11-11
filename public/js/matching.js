// One deterministic scoring function shared by both pages and the backend tests.
export function matchEvidence(jd,experience,catalog) {
 const lower=value=>String(value||'').toLowerCase();
 const source=lower(experience), target=lower(jd);
 const seen=new Set(), requirements=[];
 for(const [cat,words] of Object.entries(catalog))for(const word of words){
  const normalized=lower(word);
  if(!seen.has(normalized)&&target.includes(normalized)){
   seen.add(normalized);requirements.push({word,cat,evidence:source.includes(normalized)?word:null});
  }
 }
 const matched=requirements.filter(x=>x.evidence),gaps=requirements.filter(x=>!x.evidence);
 return {source:'manual',matchScore:requirements.length&&source.trim()?Math.round(100*matched.length/requirements.length):null,totalKeywords:requirements.length,matched,gaps,jdKeywords:requirements,method:'关键词证据覆盖率 v1；不代表录用概率，硬门槛需逐项核验'};
}
