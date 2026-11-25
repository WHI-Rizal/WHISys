// =====================================================================
// Pintu masuk khusus untuk Jarvis (AI "Hallo WHI") ke data WHISys.
// HANYA boleh diimpor dari API routes (src/app/api/jarvis/**).
//
// Prinsip keamanan (sengaja ketat):
// 1. Jarvis TIDAK PERNAH diberi kunci Firebase / Service Account. Dia
//    cuma pegang SATU token (env var JARVIS_API_TOKEN) yang cuma bisa
//    manggil endpoint /api/jarvis/* — semuanya BACA SAJA dan cuma ngembaliin
//    field whitelist (nggak ada NIK, nomor paspor, nomor HP, alamat,
//    nominal uang, HPP/margin).
// 2. Token dibandingin pakai timingSafeEqual (anti tebak lewat selisih waktu).
// 3. Ada rate limit sederhana (in-memory, per instance server) biar bot
//    yang error/looping nggak ngabisin kuota baca Firestore.
// 4. Pesan dari grup WhatsApp dianggap input yang nggak dipercaya. Karena
//    endpoint ini baca-saja, aturan "jangan percaya teks chat" nggak bisa
//    dipakai buat ngubah data apa pun.
//
// SETUP (sekali): di Vercel -> Settings -> Environment Variables, tambah
//   Name : JARVIS_API_TOKEN
//   Value: string acak minimal 32 karakter, misal hasil `openssl rand -hex 32`
// lalu redeploy, dan kasih nilai yang SAMA ke konfigurasi Jarvis.
// =====================================================================

import crypto from 'crypto';
import { NextResponse } from 'next/server';

const RATE_MAX = 60; // maksimal request
const RATE_WINDOW_MS = 60 * 1000; // per menit (global untuk token ini)
let hits = [];

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export const jarvisJson = (data, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

// Return null kalau lolos, atau NextResponse error kalau ditolak.
export function authorizeJarvis(req) {
  const secret = process.env.JARVIS_API_TOKEN;
  if (!secret || secret.length < 32) {
    return jarvisJson({ error: 'Akses Jarvis belum aktif di server (JARVIS_API_TOKEN belum di-set atau kurang dari 32 karakter).' }, 503);
  }
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !crypto.timingSafeEqual(sha(token), sha(secret))) {
    return jarvisJson({ error: 'Token tidak valid.' }, 401);
  }
  const now = Date.now();
  hits = hits.filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    return jarvisJson({ error: `Terlalu banyak permintaan. Maksimal ${RATE_MAX} per menit, coba lagi sebentar.` }, 429);
  }
  hits.push(now);
  return null;
}

// Log ringkas ke log Vercel (tanpa data pribadi) biar kelihatan Jarvis manggil apa.
export const logJarvis = (route, params) => {
  try { console.log(`[jarvis] ${route} ${JSON.stringify(params || {})}`); } catch (e) { /* abaikan */ }
};
