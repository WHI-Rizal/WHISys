import { NextResponse } from 'next/server';
import { getAdminAuth } from '../../../lib/firebaseAdmin';

// 12 Okt 2026 — AI Analyzer dikembalikan ke Gemini API (atas permintaan
// user, sebelumnya sempat pindah ke Claude/Anthropic). Dipanggil langsung
// pakai fetch() ke REST API Gemini, TANPA SDK `@google/genai`, biar nggak
// nambah dependency npm (belajar dari bug `jose`/`jwks-rsa`).
//
// SETUP: env var `GEMINI_API_KEY` di Vercel (dari https://aistudio.google.com
// -> Get API key). Model default `gemini-3.8-flash`, bisa diganti lewat env
// var `GEMINI_MODEL` tanpa ubah kode. Kalau muncul error "prepayment credits
// are depleted", itu saldo/billing project Google AI Studio-nya, bukan kode.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
// Model cadangan kalau model utama lagi penuh/sibuk. Bisa diganti lewat env var GEMINI_FALLBACK_MODEL.
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest';

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
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY belum dipasang di Environment Variables server — ambil dari aistudio.google.com > Get API key, lalu tambahin di Vercel.' },
        { status: 400 }
      );
    }

    // Panggil Gemini. Kalau model lagi "high demand" (503) atau kena batas
    // sementara (429), coba lagi sekali di model yang sama, lalu pindah ke
    // model cadangan. Error lain (key salah, saldo habis, dll) langsung
    // dikembalikan apa adanya.
    const callGemini = async (model) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptText }] }] }),
        }
      );
      const data = await res.json().catch(() => ({}));
      return { res, data };
    };
    const isBusy = (r) => r.res.status === 503 || r.res.status === 429;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    let result = await callGemini(GEMINI_MODEL);
    if (!result.res.ok && isBusy(result)) {
      await sleep(1500);
      result = await callGemini(GEMINI_MODEL);
    }
    if (!result.res.ok && isBusy(result) && GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
      result = await callGemini(GEMINI_FALLBACK_MODEL);
    }
    const geminiRes = result.res;
    const geminiData = result.data;

    if (!geminiRes.ok) {
      // Format error Gemini: { error: { code, message, status } }
      const apiErrMsg = geminiData?.error?.message || `Gemini API mengembalikan status ${geminiRes.status}.`;
      console.error('Gemini API error:', geminiData);
      return NextResponse.json({ error: apiErrMsg }, { status: geminiRes.status });
    }

    const aiAnswer = (geminiData.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || '')
      .join('\n')
      .trim() || 'Tidak ada hasil analisis.';

    return NextResponse.json({ text: aiAnswer });
  } catch (err) {
    console.error('Server AI Chat Error:', err);
    return NextResponse.json(
      { error: err.message || 'Terjadi kesalahan pada Server AI.' },
      { status: 500 }
    );
  }
}
