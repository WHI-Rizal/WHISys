import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { verifyPortalToken } from '@/lib/portalSession';

// Ganti dari updateDoc langsung di browser customer ke sini — server yang
// nge-verifikasi dulu sesi login DAN mastiin booking yang mau diupdate
// emang beneran milik jamaah yang login (jamaahId ATAU ordererId cocok),
// baru nulis field dokumen. Field yang boleh ditulis dibatasin ketat,
// niruin persis batasan yang dulu ditegakin firestore rule
// (.hasOnly(['documents', 'documentFiles', 'updatedAt'])).
export async function POST(req) {
  try {
    const { token, bookingId, docKey, fileUrl, fileName } = await req.json();

    const session = verifyPortalToken(token);
    if (!session) {
      return NextResponse.json({ error: 'Sesi udah habis atau nggak valid, silakan login ulang.' }, { status: 401 });
    }

    if (!bookingId || !docKey || !fileUrl) {
      return NextResponse.json({ error: 'Data upload nggak lengkap.' }, { status: 400 });
    }

    const db = getAdminDb();
    const bookingRef = db.collection('bookings').doc(String(bookingId));
    const bookingSnap = await bookingRef.get();

    if (!bookingSnap.exists) {
      return NextResponse.json({ error: 'Booking nggak ditemukan.' }, { status: 404 });
    }

    const booking = bookingSnap.data();
    const isOwner = booking.jamaahId === session.jamaahId || booking.ordererId === session.jamaahId;
    if (!isOwner) {
      // Nggak dikasih tahu alasan detail (nggak "bukan booking kamu") biar
      // nggak ngasih info yang bisa dipakai buat nebak-nebak data booking
      // orang lain.
      return NextResponse.json({ error: 'Kamu nggak punya akses ke booking ini.' }, { status: 403 });
    }

    const updatedAt = new Date().toISOString();
    await bookingRef.update({
      [`documents.${docKey}`]: true,
      [`documentFiles.${docKey}`]: {
        url: fileUrl,
        fileName: fileName || '',
        uploadedAt: updatedAt,
        uploadedBy: 'portal_customer',
      },
      updatedAt,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Portal document upload error:', err);
    return NextResponse.json({ error: err.message || 'Gagal simpan dokumen, coba lagi sebentar lagi.' }, { status: 500 });
  }
}
