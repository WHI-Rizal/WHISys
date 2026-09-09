// =====================================================================
// Firebase Admin SDK — HANYA boleh diimpor dari kode server (API routes
// di src/app/api/**), NGGAK BOLEH diimpor dari komponen 'use client'.
// Beda sama src/lib/firebase.js (Firebase client SDK, yang tunduk sama
// Firestore Security Rules), Admin SDK ini jalan pakai Service Account
// dan otomatis MELEWATI semua Firestore Rules — jadi endpoint yang
// makai file ini WAJIB nge-cek sendiri siapa yang boleh akses apa
// (lihat src/lib/portalSession.js buat verifikasi sesi Portal Customer).
//
// Kenapa dibutuhkan: Portal Customer (/portal) login-nya cuma pakai Kode
// Jamaah + Tanggal Lahir (nggak ada akun Firebase Auth beneran), jadi
// sebelumnya data jamaah/booking/setoran kepaksa dibikin bisa dibaca
// publik langsung dari browser lewat Firestore Rules — itu celah keamanan
// (siapa aja bisa baca SEMUA data customer). Sekarang portal baca/tulis
// data lewat API route di server (pakai Admin SDK di sini), yang
// nge-verifikasi dulu sesi login-nya sebelum ngasih data — bukan lagi
// query Firestore langsung dari browser customer.
//
// SETUP YANG DIBUTUHKAN (sekali doang, dilakukan yang pegang akses
// Firebase Console & Vercel project ini):
// 1. Buka https://console.firebase.google.com -> pilih project WHISys ->
//    klik ikon gerigi (Project Settings) -> tab "Service accounts".
// 2. Klik "Generate new private key" -> unduh file JSON-nya (SIMPAN
//    BAIK-BAIK, ini kredensial penuh ke Firestore project ini, jangan
//    pernah di-commit ke git atau dikirim ke tempat nggak aman).
// 3. Buka isi file JSON itu, copy SELURUH isinya (masih dalam format
//    JSON, satu baris juga nggak masalah).
// 4. Di Vercel -> Project ini -> Settings -> Environment Variables,
//    tambahin variable baru:
//      Name : FIREBASE_SERVICE_ACCOUNT_KEY
//      Value: (paste seluruh isi file JSON tadi)
//    Terapkan ke semua environment (Production/Preview/Development),
//    lalu redeploy.
// 5. Tambahin 1 variable lagi buat nandatangani sesi login Portal:
//      Name : PORTAL_SESSION_SECRET
//      Value: string acak yang panjang & rahasia (misal 40+ karakter
//      campuran huruf-angka — bisa generate di
//      https://1password.com/password-generator/ atau command
//      `openssl rand -hex 32` kalau punya akses terminal).
// =====================================================================

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let cachedDb = null;

export const getAdminDb = () => {
  if (cachedDb) return cachedDb;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY belum di-set di Environment Variables server. ' +
      'Lihat komentar di src/lib/firebaseAdmin.js buat cara bikinnya.'
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY isinya bukan JSON yang valid — pastikan yang di-paste seluruh isi file kunci Service Account tanpa diubah.');
  }

  const app = getApps().length > 0 ? getApps()[0] : initializeApp({ credential: cert(serviceAccount) });
  cachedDb = getFirestore(app);
  return cachedDb;
};