import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebaseAdmin';

// =====================================================================
// Endpoint PUBLIK (TANPA login) — dipanggil dari luar sistem WHISys,
// yaitu website utama wisatahalalindonesia.com (dikelola terpisah, kayak
// WordPress dll) buat nampilin Katalog Produk paket keberangkatan. Beda
// dari /api/portal/* yang butuh token sesi Portal Customer, endpoint ini
// SENGAJA nggak pakai autentikasi sama sekali — datanya emang buat
// ditampilkan ke publik/calon customer, sama kayak brosur/katalog cetak.
//
// KARENA PUBLIK, ada 2 aturan ketat yang WAJIB dijaga tiap kali endpoint
// ini diubah:
// 1. Cuma paket yang `isActive !== false` yang boleh keikut (lihat toggle
//    "Status Katalog Produk" di PackagesModule.jsx) — paket yang
//    dinonaktifkan staf TIDAK BOLEH nongol di sini walau statusnya masih
//    ada di Firestore.
// 2. Field yang dibalikin WAJIB lewat whitelist manual di
//    `pickPublicPackageFields` di bawah — JANGAN PERNAH `...data.data()`
//    mentah-mentah. Field kayak `budgetFixedCostItems`,
//    `budgetVariableCostItems`, `budgetCostTotal` (rencana anggaran &
//    margin internal) dan `revenueRecognized` (status akuntansi) itu
//    RAHASIA DAGANG — kalau bocor ke publik, kompetitor/customer bisa
//    liat berapa margin keuntungan tiap paket.
//
// CORS: dibuka lebar (`Access-Control-Allow-Origin: *`) karena endpoint
// ini read-only, tanpa cookie/token, dan datanya emang buat konsumsi
// publik — aman diakses dari domain manapun (termasuk browser JS di
// wisatahalalindonesia.com). Kalau website utama manggil dari sisi
// server (PHP/wp_remote_get dst, bukan browser), CORS ini nggak
// berpengaruh sama sekali (cuma dicek browser).
// =====================================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // Cache 5 menit di CDN/browser — katalog nggak butuh real-time detik-
  // detikan, tapi tetep cukup update kalau staf baru aja ubah harga/status.
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600',
};

// Whitelist ketat field yang aman & relevan buat katalog publik. Lihat
// catatan panjang di atas file ini kenapa ini WAJIB whitelist, bukan
// spread mentah dari dokumen Firestore-nya.
const pickPublicPackageFields = (id, data) => ({
  id,
  code: data.code || '',
  name: data.name || '',
  type: data.type || '',
  departureDate: data.departureDate || '',
  durationDays: data.durationDays || '',
  airline: data.airline || '',
  hotelMakkah: data.hotelMakkah || '',
  hotelMadinah: data.hotelMadinah || '',
  destinationCity: data.destinationCity || '',
  hotelTour: data.hotelTour || '',
  laScope: data.laScope || '',
  quotaTotal: Number(data.quotaTotal) || 0,
  quotaRemaining: Number(data.quotaRemaining ?? data.quotaTotal ?? 0),
  priceMain: Number(data.priceMain || data.priceQuad) || 0,
  priceQuad: Number(data.priceQuad || data.priceMain) || 0,
  priceTriple: Number(data.priceTriple) || 0,
  priceDouble: Number(data.priceDouble) || 0,
  priceChild: Number(data.priceChild) || 0,
  priceIncludes: Array.isArray(data.priceIncludes) ? data.priceIncludes : [],
  priceExcludes: Array.isArray(data.priceExcludes) ? data.priceExcludes : [],
  flightSegments: Array.isArray(data.flightSegments) ? data.flightSegments : [],
  itinerary: Array.isArray(data.itinerary) ? data.itinerary : [],
  specialNote: data.specialNote || '',
  flyerImageDataUrl: data.flyerImageDataUrl || '',
});

export async function GET() {
  try {
    const db = getAdminDb();
    const snap = await db.collection('packages').get();
    const packages = snap.docs
      .filter((d) => d.id !== '_destination_categories_config') // doc konfigurasi, bukan paket beneran
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter(({ data }) => data.isActive !== false) // aturan #1 — cuma paket Aktif
      .map(({ id, data }) => pickPublicPackageFields(id, data))
      .sort((a, b) => new Date(a.departureDate || 0) - new Date(b.departureDate || 0));

    return NextResponse.json({ packages, count: packages.length }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('Gagal mengambil katalog publik:', err);
    return NextResponse.json(
      { error: 'Gagal mengambil data katalog. Coba lagi sebentar lagi.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// Preflight CORS — browser ngirim OPTIONS dulu sebelum GET lintas-origin
// kalau requestnya pakai header non-simple. Endpoint ini GET polos tanpa
// header custom, jadi biasanya browser nggak bakal preflight, tapi
// disediain buat jaga-jaga (beberapa setup WordPress/plugin fetch bisa
// nambahin header yang mancing preflight).
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
