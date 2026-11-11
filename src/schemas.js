import { z } from 'zod';
export const credentials=z.object({email:z.string().trim().email().max(254).transform(x=>x.toLowerCase()),password:z.string().min(10).max(128)});
export const uuid=z.string().uuid();
const jsonObject=z.record(z.string(),z.unknown());
const strings=z.array(z.string().max(1000)).max(100);
const analysis=z.object({keywords:strings,skills:strings,tools:strings,domains:strings,starItems:z.array(z.object({situation:z.string(),task:z.string(),action:z.string(),result:z.string()}).passthrough()).max(100),abilityScores:z.record(z.string(),z.number().min(0).max(100))}).passthrough();
const appData=z.object({
 studentProfile:z.object({major:z.string().max(120).optional(),education:z.enum(['','undergraduate','graduate']).optional(),employmentChoice:z.enum(['','same','cross','unsure']).optional()}).passthrough().optional(),
 experienceText:z.string().max(50000).optional(),manualJDText:z.string().max(50000).optional(),
 experienceAnalysis:analysis.nullable().optional(),
 jdMatchResult:z.object({matchScore:z.number().min(0).max(100).nullable(),matched:z.array(z.object({word:z.string(),cat:z.string()}).passthrough()),gaps:z.array(z.object({word:z.string(),cat:z.string()}).passthrough())}).passthrough().nullable().optional()
}).passthrough();
export const workspace=z.object({version:z.number().int().nonnegative(),appData,history:z.array(z.object({id:z.string().min(1).max(100),snapshot:appData}).passthrough()).max(100),prep:jsonObject}).superRefine((value,ctx)=>{
 if (new Set(value.history.map(x=>x.id)).size!==value.history.length) ctx.addIssue({code:'custom',message:'历史记录 ID 重复'});
});
export const chat=z.object({content:z.string().trim().min(1).max(6000),requestId:uuid,consent:z.literal(true)});
export const experience=z.object({text:z.string().trim().min(10).max(20000),consent:z.literal(true)});
export const extraction=z.object({skills:z.array(z.object({name:z.string().min(1).max(80),category:z.enum(['skill','tool','domain']),evidence:z.string().min(1).max(1000)})).max(40),starItems:z.array(z.object({situation:z.string().max(1000),task:z.string().max(1000),action:z.string().max(1000),result:z.string().max(1000)})).max(10),questions:z.array(z.string().max(300)).max(5)});
export const answer=z.object({answer:z.string().min(1).max(12000),citationIds:z.array(z.string()).max(5)});
export const matchInput=z.object({jd:z.string().trim().min(5).max(20000),text:z.string().trim().min(5).max(20000),consent:z.literal(true)});
export const matchOutput=z.object({requirements:z.array(z.object({requirement:z.string().min(1).max(1000),kind:z.enum(['skill','threshold']),evidence:z.string().max(1000),status:z.enum(['supported','insufficient','conflict']),explanation:z.string().max(500)})).max(30)});
