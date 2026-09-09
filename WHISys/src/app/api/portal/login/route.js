import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { signPortalToken } from '@/lib/portalSession';

// Login Portal Customer: Kode Jamaah + Tanggal Lahir doang, TANPA
// password/akun staf. Semua verifikasi & rate-limit sekarang jalan di
// server (Admin SDK, lewat sini) — bukan lagi query Firestore langsung
// dari browser customer kayak sebelumnya (itu yang bikin data jamaah &
// booking kebuka publik, lihat audit keamanan 9 Sep 2026).

const ATTEMPT_LIMIT = 5;
const LOCK_MINUTES = 15;

// Dipakai sebagai document ID buat rate-limit counter — sanitize dulu
// biar nggak ada karakter aneh yang bikin path Firestore invalid, sama
// biar kode yang beda casing/spasi nggak bisa dipakai buat "reset"
// counter kode yang sama (mirip logic customerCode.toUpperCase() yang
// udah ada di sisi client).
const sanitizeCodeForDocId = (code) => String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 100);

// Sama persis pola normalisasi tanggal yang dulu ada di portal/page.js —
// beberapa data jamaah lama kesimpen dengan format yang beda dikit
// (embel-embel waktu ISO, dst), jadi dibandingin cuma bagian YYYY-MM-DD.
const normalizeDateOnly = (val) => {
  if (!val) return '';
  const s = String(val).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export async function POST(req) {
  try {
    const { customerCode, birthDate } = await req.json();
    const code = String(customerCode || '').trim().toUpperCase();

    if (!code || !birthDate) {
      return NextResponse.json({ error: 'Isi Kode Jamaah dan Tanggal Lahir dulu ya.' }, { status: 400 });
    }

    const db = getAdminDb();
    const attemptDocId = sanitizeCodeForDocId(code);
    const attemptRef = db.collection('portalLoginAttempts').doc(attemptDocId);

    const attemptSnap = await attemptRef.get();
    if (attemptSnap.exists) {
      const data = attemptSnap.data();
      if (data.lockedUntil && new Date(data.lockedUntil).getTime() > Date.now()) {
        const remainingMin = Math.max(1, Math.ceil((new Date(data.lockedUntil).getTime() - Date.now()) / 60000));
        return NextResponse.json(
          { error: `Terlalu banyak percobaan gagal buat kode ini. Coba lagi dalam ${remainingMin} menit, atau hubungi kami kalau butuh bantuan.` },
          { status: 429 }
        );
      }
    }

    // CATATAN: idealnya Kode Jamaah unik per orang, tapi ada data lama yang
    // sempat kesimpen dobel dengan customerCode yang sama persis — jadi cek
    // SEMUA dokumen yang punya kode itu, bukan cuma yang pertama ketemu.
    const jamaahSnap = await db.collection('jamaah').where('customerCode', '==', code).get();

    let matched = null;
    jamaahSnap.forEach((docSnap) => {
      if (matched) return;
      const data = docSnap.data();
      if (data.birthDate && normalizeDateOnly(data.birthDate) === normalizeDateOnly(birthDate)) {
        matched = { id: docSnap.id, customerCode: data.customerCode, fullName: data.fullName || '' };
      }
    });

    if (!matched) {
      // Transaction biar aman dari race condition kalau ada 2 percobaan
      // gagal hampir bersamaan dari kode yang sama.
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(attemptRef);
        const prevCount = snap.exists ? (Number(snap.data().count) || 0) : 0;
        const count = prevCount + 1;
        const payload = { count, updatedAt: new Date().toISOString() };
        if (count >= ATTEMPT_LIMIT) {
          payload.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
          payload.count = 0;
        }
        tx.set(attemptRef, payload, { merge: true });
      });

      // Pesan sengaja nggak nyebut "kode salah" atau "tanggal salah" secara
      // spesifik — biar orang luar nggak bisa nebak-nebak kode jamaah mana
      // yang valid cuma dari respons error-nya.
      return NextResponse.json(
        { error: 'Kode Jamaah atau Tanggal Lahir belum cocok. Coba cek lagi, atau hubungi tim kami kalau butuh bantuan.' },
        { status: 401 }
      );
    }

    // Login berhasil — reset counter (gagal reset bukan hal fatal).
    attemptRef.set({ count: 0, updatedAt: new Date().toISOString() }, { merge: true }).catch(() => {});

    const token = signPortalToken({
      jamaahId: matched.id,
      customerCode: matched.customerCode,
      fullName: matched.fullName,
    });

    return NextResponse.json({
      token,
      jamaahId: matched.id,
      customerCode: matched.customerCode,
      fullName: matched.fullName,
    });
  } catch (err) {
    console.error('Portal login error:', err);
    return NextResponse.json({ error: err.message || 'Gagal memproses login, coba lagi sebentar lagi.' }, { status: 500 });
  }
}
