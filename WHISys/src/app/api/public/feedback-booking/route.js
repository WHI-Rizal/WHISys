import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';

// Verifikasi kode booking buat form feedback PUBLIK (/feedback/[kode]).
// Collection `bookings` di Firestore Rules tertutup buat yang belum login,
// jadi halaman publik nggak bisa query langsung dari browser customer (yang
// kebuka cuma buat staf yang lagi login, makanya di sisi staf kelihatan
// normal tapi di customer muncul "Kode Booking Tidak Ditemukan"). Endpoint
// ini pakai Admin SDK di server dan cuma ngebalikin 3 field minimal.
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const code = (new URL(request.url).searchParams.get('code') || '').trim();
    if (!code || code.length > 100) {
      return NextResponse.json({ found: false }, { status: 400 });
    }
    const snap = await getAdminDb().collection('bookings').where('bookingCode', '==', code).limit(1).get();
    if (snap.empty) {
      return NextResponse.json({ found: false }, { status: 404 });
    }
    const bk = snap.docs[0].data();
    return NextResponse.json({
      found: true,
      jamaahName: bk.jamaahName || '',
      packageName: bk.packageName || '',
      packageId: bk.packageId || '',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Gagal verifikasi kode booking feedback:', err);
    return NextResponse.json({ found: false, error: 'server' }, { status: 500 });
  }
}
