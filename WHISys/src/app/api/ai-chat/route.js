import { NextResponse } from 'next/server';
import { getAdminAuth } from '../../../lib/firebaseAdmin';

// Perbaikan 18 Sep 2026 — AI Analyzer dipindah dari Gemini API ke Claude
// (Anthropic API), atas permintaan user. Dipanggil langsung pakai fetch()
// ke REST API Anthropic (BUKAN pakai SDK `@anthropic-ai/sdk`) — sengaja
// biar nggak nambah dependency npm baru sama sekali, setelah kejadian
// bug `jose`/`jwks-rsa` (ERR_REQUIRE_ESM) yang bikin Portal Customer &
// endpoint ini mati total gara-gara masalah kompatibilitas paket pihak
// ketiga. fetch() ke REST API murni jauh lebih kecil resikonya.
//
// SETUP YANG DIBUTUHKAN: env var `ANTHROPIC_API_KEY` di Vercel (dari
// https://console.anthropic.com -> Settings -> API Keys). Model default
// `claude-haiku-4-5-20251001` (cepat & murah, cocok buat jawaban singkat
// 2-3 kalimat kayak yang dipakai AI Analyzer) — bisa di-upgrade ke model
// lain (mis. `claude-sonnet-5`) lewat env var `ANTHROPIC_MODEL` kalau
// butuh analisis yang lebih tajam, tanpa perlu ubah kode ini.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

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
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY belum dipasang di Environment Variables server — ambil dari console.anthropic.com > Settings > API Keys, lalu tambahin di Vercel.' },
        { status: 400 }
      );
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: promptText }],
      }),
    });

    const anthropicData = await anthropicRes.json();

    if (!anthropicRes.ok) {
      // Format error Anthropic: { type: 'error', error: { type, message } }
      const apiErrMsg = anthropicData?.error?.message || `Anthropic API mengembalikan status ${anthropicRes.status}.`;
      console.error('Anthropic API error:', anthropicData);
      return NextResponse.json({ error: apiErrMsg }, { status: anthropicRes.status });
    }

    const aiAnswer = (anthropicData.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
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
