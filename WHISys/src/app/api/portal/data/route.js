import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';
import { verifyPortalToken } from '@/lib/portalSession';

const DEFAULT_COMPANY_PROFILE = {
  name: 'PT. WISATA HALAL INTERNASIONAL',
  ppiuNumber: '',
  address: '',
  phone: '',
  email: ''
};

// Field booking yang BOLEH dibalikin ke Portal Customer — whitelist
// sengaja dipilih ketat (bukan seluruh dokumen booking apa adanya),
// biar field internal (createdByUid, closingSource*, leadSource,
// passportNumber duplikat, dst) nggak ikut kebocor ke browser customer
// walau dia berhak liat booking itu.
const pickBookingFields = (id, data) => ({
  id,
  bookingCode: data.bookingCode || '',
  packageName: data.packageName || '',
  departureDate: data.departureDate || '',
  status: data.status || 'active',
  jamaahId: data.jamaahId || '',
  jamaahName: data.jamaahName || '',
  ordererId: data.ordererId || '',
  totalAmount: Number(data.totalAmount) || 0,
  totalPaid: Number(data.totalPaid) || 0,
  documents: data.documents || {},
  documentFiles: data.documentFiles || {},
  createdAt: data.createdAt || null,
});

// Ambil semua booking milik jamaah yang login — dobel query, jamaahId
// (booking di mana dia jadi PESERTA) ATAU ordererId (booking yang DIA
// PESANKAN) — sama persis logic yang dulu jalan di browser, cuma sekarang
// dieksekusi di server pakai identitas yang UDAH DIVERIFIKASI dari token,
// bukan dari input yang bisa diutak-atik client.
async function fetchBookingsForJamaah(db, jamaahId) {
  const [asPaxSnap, asOrdererSnap] = await Promise.all([
    db.collection('bookings').where('jamaahId', '==', jamaahId).get(),
    db.collection('bookings').where('ordererId', '==', jamaahId).get(),
  ]);
  const merged = new Map();
  asPaxSnap.forEach((d) => merged.set(d.id, pickBookingFields(d.id, d.data())));
  asOrdererSnap.forEach((d) => merged.set(d.id, pickBookingFields(d.id, d.data())));
  return Array.from(merged.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

export async function POST(req) {
  try {
    const { token } = await req.json();
    const session = verifyPortalToken(token);
    if (!session) {
      return NextResponse.json({ error: 'Sesi udah habis atau nggak valid, silakan login ulang.' }, { status: 401 });
    }

    const db = getAdminDb();
    const [bookings, profileSnap] = await Promise.all([
      fetchBookingsForJamaah(db, session.jamaahId),
      db.collection('settings').doc('company_profile').get(),
    ]);

    let companyProfile = DEFAULT_COMPANY_PROFILE;
    if (profileSnap.exists && profileSnap.data().company) {
      companyProfile = { ...DEFAULT_COMPANY_PROFILE, ...profileSnap.data().company };
    }

    return NextResponse.json({ bookings, companyProfile });
  } catch (err) {
    console.error('Portal data fetch error:', err);
    return NextResponse.json({ error: err.message || 'Gagal memuat data, coba lagi sebentar lagi.' }, { status: 500 });
  }
}
