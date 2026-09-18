import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getAdminAuth } from '../../../lib/firebaseAdmin';

// Perbaikan 18 Sep 2026 (temuan audit MEDIUM, 9 Sep & 17 Sep) — endpoint
// ini sebelumnya nerima `promptText` dan langsung manggil Gemini API tanpa
// cek siapa yang manggil sama sekali. Siapapun yang tau URL-nya bisa
// nembak endpoint ini berkali-kali dan ngabisin kuota/biaya API Gemini
// WHISys tanpa login. Sekarang WAJIB kirim header
// `Authorization: Bearer <Firebase ID Token>` staf yang lagi login di
// dashboard (bukan token Portal Customer — portal punya sesinya sendiri
// & TIDAK dikasih akses endpoint ini). Verifikasi tokennya butuh Admin SDK
// (`FIREBASE_SERVICE_ACCOUNT_KEY` di Environment Variables server — LIHAT
// CATATAN PENTING di src/lib/firebaseAdmin.js kalau env var ini belum
// pernah di-set: fitur Portal Customer & endpoint ini butuh itu buat jalan).
//
// Rate limit di bawah ini SENGAJA simpel (in-memory, per uid, per proses
// server) — bukan solusi sempurna, soalnya di Vercel tiap serverless
// function instance punya memory sendiri-sendiri & bisa "cold start"
// (memory-nya kereset) kapan aja, jadi batasnya nggak 100% akurat kalau
// trafiknya kebagi ke banyak instance. Tujuannya cuma buat nahan 1 user
// yang nge-spam klik/nembak endpoint ini beruntun dari 1 sesi — bukan
// pengganti rate-limiter beneran (mis. Upstash Redis) kalau nanti butuh
// yang lebih akurat/terdistribusi.
const RATE_LIMIT_MAX = 15; // maksimal 15 request
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // per 5 menit, per uid
const rateLimitMap = new Map(); // uid -> [timestamp, ...]

const isRateLimited = (uid) => {
  const now = Date.now();
  const hits = (rateLimitMap.get(uid) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(uid, hits);
    return true;
  }
  hits.push(now);
  rateLimitMap.set(uid, hits);
  return false;
};

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) {
      return NextResponse.json({ error: 'Belum login — endpoint ini cuma bisa dipanggil dari dashboard yang sudah login.' }, { status: 401 });
    }

    let decoded;
    try {
      decoded = await getAdminAuth().verifyIdToken(idToken);
    } catch (authErr) {
      console.error('AI Chat: token tidak valid:', authErr.message);
      return NextResponse.json({ error: 'Sesi login sudah tidak valid — coba refresh halaman & login ulang.' }, { status: 401 });
    }

    if (isRateLimited(decoded.uid)) {
      return NextResponse.json(
        { error: `Terlalu banyak permintaan ke AI Analyzer dalam waktu singkat — coba lagi beberapa menit lagi (maksimal ${RATE_LIMIT_MAX} pertanyaan per 5 menit).` },
        { status: 429 }
      );
    }

    const { promptText } = await req.json();

    // Mengambil API Key secara aman dari Server Environment
    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key Gemini belum dipasang di Environment Variables.' },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Pakai Interactions API (pengganti resmi generateContent) & model
    // Gemini 3 yang masih aktif untuk akun/API key baru.
    const interaction = await ai.interactions.create({
      model: 'gemini-3.5-flash-lite',
      input: promptText,
    });

    const aiAnswer = interaction.output_text || 'Tidak ada hasil analisis.';

    return NextResponse.json({ text: aiAnswer });
  } catch (err) {
    console.error('Server AI Chat Error:', err);
    return NextResponse.json(
      { error: err.message || 'Terjadi kesalahan pada Server AI.' },
      { status: 500 }
    );
  }
}
