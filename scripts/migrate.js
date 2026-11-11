import { migrate, pool } from '../src/db.js';
try { await migrate(); console.log('Database migrations applied'); }
catch(error) { console.error(error.code || 'MIGRATION_FAILED', error.message); process.exitCode=1; }
finally { await pool?.end(); }
