// =====================================================================
// Sesi login Portal Customer — token pendek yang ditandatangani server
// (HMAC-SHA256), BUKAN Firebase Auth beneran (portal emang sengaja
// didesain tanpa akun staf/password, cuma Kode Jamaah + Tanggal Lahir).
//
// Alurnya: /api/portal/login verifikasi Kode Jamaah + Tanggal Lahir ke
// Firestore (lewat Admin SDK, lihat firebaseAdmin.js), kalau cocok
// nerbitin token ini. Browser nyimpen token itu (gantiin sessionStorage
// yang dulu nyimpen data mentah jamaah). Tiap request Portal berikutnya
// (/api/portal/data, /api/portal/documents) WAJIB nyertain token ini,
// server verifikasi tanda tangan & masa berlakunya sebelum ngasih/nerima
// data apapun — jadi customer A nggak akan pernah bisa nyamar jadi
// customer B cuma dengan ngasal nebak/ubah id di request.
//
// SETUP: butuh env var PORTAL_SESSION_SECRET (string acak panjang &
// rahasia) — lihat instruksi lengkap di src/lib/firebaseAdmin.js.
// =====================================================================

import crypto from 'crypto';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam — cukup buat 1x sesi kunjungan portal, nggak perlu login ulang tiap buka halaman lagi dalam hari yang sama.

const getSecret = () => {
  const secret = process.env.PORTAL_SESSION_SECRET;
  if (!secret) {
    throw new Error('PORTAL_SESSION_SECRET belum di-set di Environment Variables server. Lihat komentar di src/lib/firebaseAdmin.js buat cara bikinnya.');
  }
  return secret;
};

const base64url = (input) => Buffer.from(input).toString('base64url');

// payload: { jamaahId, customerCode, fullName } — data minimal yang
// dibutuhkan buat scoping request-request berikutnya, TIDAK termasuk
// data sensitif lain (tanggal lahir, dst).
export const signPortalToken = (payload) => {
  const secret = getSecret();
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const bodyB64 = base64url(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', secret).update(bodyB64).digest('base64url');
  return `${bodyB64}.${signature}`;
};

// Balikin payload kalau token valid (tanda tangan cocok & belum
// kedaluwarsa), atau null kalau nggak valid — pemanggil WAJIB nolak
// request kalau hasilnya null, jangan pernah lanjut proses.
export const verifyPortalToken = (token) => {
  try {
    const secret = getSecret();
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;

    const [bodyB64, signature] = token.split('.');
    const expectedSignature = crypto.createHmac('sha256', secret).update(bodyB64).digest('base64url');

    const sigBuf = Buffer.from(signature || '');
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const body = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    if (!body.exp || body.exp < Date.now()) return null;
    if (!body.jamaahId) return null;

    return body;
  } catch {
    return null;
  }
};