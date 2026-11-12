/* 관리자 로그인 · 비밀번호 · 로그인 유지(세션) · 실패 잠금 */

const ITER = 8000; // 무료 요금제 CPU 한도(요청당 10ms) 안에서 안전한 반복 횟수 (기존 저장값은 각자 저장된 횟수로 확인)
const SESSION_DAYS = 14; // 입실자 개인정보가 있어 2주마다 다시 로그인
const MAX_FAILS = 5;
const LOCK_MINUTES = 10;
export const COOKIE = 'dk_s';

const enc = new TextEncoder();

export function b64u(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// 저장 형식: pbkdf2$반복수$소금$해시
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, ITER);
  return 'pbkdf2$' + ITER + '$' + b64u(salt) + '$' + b64u(hash);
}

export async function verifyPassword(password, stored) {
  try {
    const [kind, iterStr, saltStr, hashStr] = String(stored).split('$');
    if (kind !== 'pbkdf2') return false;
    const hash = await pbkdf2(password, fromB64u(saltStr), Number(iterStr));
    return sameBytes(hash, fromB64u(hashStr));
  } catch (e) {
    return false;
  }
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return b64u(d);
}

export function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function isLocalHttp(request) {
  return new URL(request.url).protocol === 'http:';
}

export function sessionCookie(request, token) {
  const secure = isLocalHttp(request) ? '' : '; Secure';
  return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_DAYS * 86400 + secure;
}
export function clearCookie(request) {
  const secure = isLocalHttp(request) ? '' : '; Secure';
  return COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + secure;
}

export async function createSession(db, adminId) {
  const token = b64u(randomBytes(32));
  const th = await sha256(token);
  await db
    .prepare("INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, datetime('now', ?))")
    .bind(th, adminId, '+' + SESSION_DAYS + ' days')
    .run();
  // 만료된 세션 정리
  await db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  return token;
}

export async function currentAdmin(db, request) {
  const token = readCookie(request, COOKIE);
  if (!token || token.length > 100) return null;
  const th = await sha256(token);
  const row = await db
    .prepare(
      "SELECT a.id, a.username, a.name, a.role FROM sessions s JOIN admins a ON a.id = s.admin_id " +
        "WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND a.active = 1"
    )
    .bind(th)
    .first();
  return row || null;
}

export async function deleteSession(db, request) {
  const token = readCookie(request, COOKIE);
  if (!token || token.length > 100) return;
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

// 잠금은 계정(아이디) 기준입니다. 짧은 주소 중계를 거치면 모든 손님의 접속 주소가 같아 보이기 때문입니다.
export function lockKey(username) {
  return 'u:' + String(username || '').toLowerCase().slice(0, 40);
}

// 잠겨 있으면 남은 분(1 이상), 아니면 0
export async function lockedMinutes(db, key) {
  const row = await db
    .prepare("SELECT CAST((julianday(locked_until) - julianday('now')) * 1440 AS REAL) AS mins FROM login_fails WHERE k = ? AND locked_until > datetime('now')")
    .bind(key)
    .first();
  return row ? Math.max(1, Math.ceil(row.mins)) : 0;
}

export async function recordFail(db, key) {
  // 10분 넘게 지난 실패 기록은 새로 시작
  await db
    .prepare(
      "INSERT INTO login_fails (k, count, updated_at) VALUES (?, 1, datetime('now')) " +
        "ON CONFLICT(k) DO UPDATE SET " +
        "count = CASE WHEN updated_at < datetime('now', ?) THEN 1 ELSE count + 1 END, " +
        "updated_at = datetime('now')"
    )
    .bind(key, '-' + LOCK_MINUTES + ' minutes')
    .run();
  await db
    .prepare("UPDATE login_fails SET locked_until = datetime('now', ?), count = 0 WHERE k = ? AND count >= ?")
    .bind('+' + LOCK_MINUTES + ' minutes', key, MAX_FAILS)
    .run();
}

export async function clearFails(db, key) {
  await db.prepare('DELETE FROM login_fails WHERE k = ?').bind(key).run();
  // 하루 지난 실패 기록 정리
  await db.prepare("DELETE FROM login_fails WHERE updated_at < datetime('now', '-1 day') AND (locked_until IS NULL OR locked_until < datetime('now'))").run();
}
