import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const stable = value => value === undefined ? 'null' : Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
export const opaque = () => randomBytes(32).toString('base64url');
export const id = prefix => `${prefix}_${randomBytes(12).toString('hex')}`;
export const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
export function check(condition, message = '请求格式不正确。', code = 'INVALID_REQUEST', status = 400) { if (!condition) throw failure(status, code, message); }
export function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function passwordMatches(password, encoded) { try { const [salt, hash] = encoded.split(':'); const actual = scryptSync(password, salt, 64), expected = Buffer.from(hash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); } catch { return false; } }
export function openCareerStore(path = resolve('data/career.sqlite')) {
  check(path !== ':memory:', 'P0 必须使用持久数据库。');
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;');
  db.exec(readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8'));
  if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(readFileSync(new URL('./migrations/002_turn_snapshot.sql', import.meta.url),'utf8'));db.exec('COMMIT'); }
    catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {
    db,
    get(sql, ...params) { return db.prepare(sql).get(...params); },
    all(sql, ...params) { return db.prepare(sql).all(...params); },
    run(sql, ...params) { return db.prepare(sql).run(...params); },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    close() { db.close(); },
  };
}
