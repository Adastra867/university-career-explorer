import { existsSync } from 'node:fs';
if(existsSync('.env') && process.env.JOURNEY_LOAD_ENV !== 'false') process.loadEnvFile('.env');
const { createCareerRouter }=await import('../p0/api.js');
const router=createCareerRouter();
try {router.locals.cleanup();console.log('已按保存期限清理云资料、提交及过期预览。');} finally {router.locals.close();}
