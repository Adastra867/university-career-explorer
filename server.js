import { app } from './src/app.js';
import { pool, migrate } from './src/db.js';
const port = process.env.PORT || process.env.DEPLOY_RUN_PORT || 5000;
if (pool && process.env.AUTO_MIGRATE === 'true') await migrate();
const server = app.listen(port, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${port}`));
server.on('error', error => { console.error('Server startup failed:', error.code); process.exit(1); });
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => { await pool?.end(); clearTimeout(timeout); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
