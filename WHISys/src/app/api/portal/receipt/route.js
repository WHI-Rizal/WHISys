import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { verifyPortalToken } from '@/lib/portalSession';

// Ganti dari query payments_income + getDoc(jamaah) langsung di browser
// customer ke sini — dulu ini salah satu sumber kebocoran (payments_income
// & jamaah kebuka publik lewat rule). Sekarang di-generate kwitansinya
// tetap di browser (jsPDF, nggak berubah), tapi datanya diambil lewat
// endpoint ini yang udah verifikasi sesi + kepemilikan booking dulu.
export async function POST(req) {
  try {
    const { token, bookingId } = await req.json();

    const session = verifyPortalToken(token);
    if (!session) {
      return NextResponse.json({ error: 'Sesi udah habis atau nggak valid, silakan login ulang.' }, { status: 401 });
    }

    if (!bookingId) {
      return NextResponse.json({ error: 'Booking nggak ditemukan.' }, { status: 400 });
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
      return NextResponse.json({ error: 'Kamu nggak punya akses ke booking ini.' }, { status: 403 });
    }

    const paySnap = await db.collection('payments_income').where('bookingId', '==', String(bookingId)).get();
    const payments = paySnap.docs
      .map((d) => {
        const p = d.data();
        return {
          id: d.id,
          createdAt: p.createdAt || null,
          paymentMethod: p.paymentMethod || '',
          notes: p.notes || '',
          amount: Number(p.amount) || 0,
        };
      })
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    // Kode Jamaah punya SI PESERTA booking ini, bisa beda dari yang login
    // (Pemesan rombongan bisa login & cetak kwitansi peserta lain).
    let paxCustomerCode = session.customerCode || '-';
    if (booking.jamaahId && booking.jamaahId !== session.jamaahId) {
      try {
        const paxSnap = await db.collection('jamaah').doc(String(booking.jamaahId)).get();
        if (paxSnap.exists) {
          paxCustomerCode = paxSnap.data().customerCode || '-';
        }
      } catch {
        // Nggak fatal — kwitansi tetap bisa dibuat, cuma kode jamaahnya '-'.
      }
    }

    return NextResponse.json({
      payments,
      paxCustomerCode,
      booking: {
        bookingCode: booking.bookingCode || '',
        packageName: booking.packageName || '',
        departureDate: booking.departureDate || '',
        status: booking.status || 'active',
        jamaahName: booking.jamaahName || '',
        totalAmount: Number(booking.totalAmount) || 0,
        totalPaid: Number(booking.totalPaid) || 0,
      },
    });
  } catch (err) {
    console.error('Portal receipt fetch error:', err);
    return NextResponse.json({ error: err.message || 'Gagal memuat data kwitansi, coba lagi sebentar lagi.' }, { status: 500 });
  }
}
