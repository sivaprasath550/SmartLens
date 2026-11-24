import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function newSessionId() {
  return `ses_${randomBytes(9).toString('base64url')}`;
}

/** A per-session secret that authorises location writes for that session only. */
export function newSessionToken() {
  return randomBytes(24).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
