import { existsSync } from 'node:fs';
import { openCareerStore, id, passwordHash } from '../p0/store.js';

if (existsSync('.env') && process.env.JOURNEY_LOAD_ENV !== 'false') process.loadEnvFile('.env');
const username=process.env.CAREER_ADMIN_USERNAME?.trim(), password=process.env.CAREER_ADMIN_PASSWORD;
if(!username || username.length>80 || !password || password.length<12 || password.length>200 || (process.env.CAREER_ADMIN_DISPLAY_NAME||'').length>120) {
  console.error('设置 CAREER_ADMIN_USERNAME 和至少 12 位的 CAREER_ADMIN_PASSWORD 后重试。密码仅用于初始化，不会输出。'); process.exitCode=1;
} else {
  const store=openCareerStore(process.env.CAREER_DB_PATH);
  try {
    const old=store.get('SELECT id FROM admins WHERE username=?',username);
    store.transaction(()=>{
      if(old) {store.run('UPDATE admins SET password_hash=?,display_name=? WHERE id=?',passwordHash(password),process.env.CAREER_ADMIN_DISPLAY_NAME||username,old.id);store.run('DELETE FROM admin_sessions WHERE admin_id=?',old.id);}
      else store.run('INSERT INTO admins VALUES(?,?,?,?)',id('admin'),username,passwordHash(password),process.env.CAREER_ADMIN_DISPLAY_NAME||username);
    });
    console.log(old?'管理员密码已更新，既有登录已失效。':'管理员已创建。');
  } finally {store.close();}
}
