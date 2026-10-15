import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { getAdminDb } from '@/lib/firebaseAdmin';

// =====================================================================
// Endpoint PUBLIK (TANPA login) — dipanggil dari luar sistem WHISys,
// yaitu website utama wisatahalalindonesia.com (dikelola terpisah, kayak
// WordPress dll) buat nampilin Katalog Produk paket keberangkatan. Beda
// dari /api/portal/* yang butuh token sesi Portal Customer, endpoint ini
// SENGAJA nggak pakai autentikasi sama sekali — datanya emang buat
// ditampilkan ke publik/calon customer, sama kayak brosur/katalog cetak.
//
// CATATAN DOMAIN: WHISys jalan di subdomain `sys.wisatahalalindonesia.com`,
// dan website utama publiknya ada di `wisatahalalindonesia.com` (dikelola
// terpisah oleh Tim Web). CORS di bawah sengaja dibuka lebar (`*`) supaya
// nggak masalah domain mana pun yang akhirnya manggil endpoint ini.
//
// KENAPA PAKAI CLIENT SDK (BUKAN ADMIN SDK) — beda dari /api/portal/*:
// Endpoint ini awalnya pakai Firebase Admin SDK (getAdminDb(), sama
// kayak /api/portal/*), tapi itu butuh `FIREBASE_SERVICE_ACCOUNT_KEY`.
// Pembuatan Service Account Key baru buat project ini TERBLOKIR Org
// Policy Google Workspace punya perusahaan (`wisatahalalindonesia.com`,
// error "Key creation is not allowed on this service account... policy
// restricted by organization policies") — dan ini bukan hal yang bisa
// dibenerin dari sisi kode, butuh Google Workspace Super Admin buat
// melonggarkan policy itu (belum ketemu orangnya sampai sekarang).
// Makanya endpoint ini didesain ULANG biar SAMA SEKALI nggak butuh
// Service Account Key: baca collection terpisah `public_catalog`
// (bukan `packages` asli) pakai Client SDK yang sama kayak dipakai staf
// login di dashboard — bedanya, buat collection `public_catalog` ini
// Firestore Security Rules-nya dibuka PUBLIC READ (lihat catatan di
// PackagesModule.jsx bagian `syncPublicCatalog`/`buildPublicCatalogDoc`,
// itu yang nulis/nyinkron dokumen di collection ini tiap kali staf
// ubah/simpan/toggle/hapus paket). Collection `packages` ASLI sendiri
// TETAP tertutup dari akses publik seperti biasa.
//
// ATURAN KETAT yang WAJIB dijaga tiap kali endpoint ini diubah:
// 1. Yang dibaca CUMA `public_catalog` — JANGAN PERNAH balik baca
//    collection `packages` asli langsung dari sini (itu bakal ketauan
//    Firestore Rules & ditolak karena publik, TAPI juga karena data di
//    `packages` asli berisi field internal/margin yang nggak boleh
//    bocor). Penyaringan Aktif/Nonaktif udah kejadian duluan pas nulis
//    ke `public_catalog` (lihat `syncPublicCatalog` di
//    PackagesModule.jsx) — paket Nonaktif otomatis DIHAPUS dari
//    `public_catalog`, jadi di sini nggak perlu filter lagi.
// 2. Kalau nanti ada kebutuhan nambah field baru ke katalog publik,
//    perubahannya HARUS dilakuin di whitelist `PUBLIC_CATALOG_FIELDS`/
//    `buildPublicCatalogDoc` di PackagesModule.jsx (yang nulis dokumen
//    `public_catalog`), BUKAN di file ini — file ini cuma baca apa
//    adanya yang udah ada di `public_catalog`.
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
  // Cache 30 detik di CDN/browser (awalnya 5 menit — dipendekin 16 Sep 2026
  // malam, soalnya user butuh ngecek paket baru muncul di katalog nggak
  // lama setelah disave/toggle di WHISys, terutama pas lagi backfill paket
  // lama). 30 detik masih cukup buat nahan lonjakan trafik ke Firestore
  // kalau katalognya rame dibuka, tapi delay-nya udah jauh lebih kerasa
  // cepet dibanding 5 menit sebelumnya.
  'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
};

// SISA SEAT HARUS LIVE (diperbaiki 15 Okt 2026): `public_catalog` cuma di-update pas staf Paket
// menyimpan paket, sedangkan sisa seat berubah tiap ada booking/batal/reschedule (yang cuma
// ngubah `packages.quotaRemaining`, dan staf Sales/Finance nggak boleh nulis ke public_catalog).
// Akibatnya angka di katalog bisa basi. Sekarang, kalau Admin SDK tersedia, sisa seat (dan
// status aktif) diambil LIVE dari `packages` — cuma field itu yang dibaca & dikirim, field
// internal paket tetap nggak ikut keluar. Kalau Admin SDK gagal, jatuh ke data cermin.
async function overlayLiveSeats(packages) {
  try {
    const adb = getAdminDb();
    const refs = packages.map((p) => adb.collection('packages').doc(p.id));
    if (refs.length === 0) return packages;
    const snaps = await adb.getAll(...refs, { fieldMask: ['quotaRemaining', 'quotaTotal', 'isActive'] });
    const live = new Map(snaps.map((sn) => [sn.id, sn]));
    return packages
      .filter((p) => {
        const sn = live.get(p.id);
        return !(sn && (!sn.exists || sn.get('isActive') === false));
      })
      .map((p) => {
        const sn = live.get(p.id);
        if (!sn || !sn.exists) return p;
        const total = Number(sn.get('quotaTotal') ?? p.quotaTotal) || 0;
        const remaining = Number(sn.get('quotaRemaining') ?? sn.get('quotaTotal') ?? p.quotaRemaining ?? 0);
        return { ...p, quotaTotal: total, quotaRemaining: Math.max(0, remaining) };
      });
  } catch (err) {
    console.error('Gagal ambil sisa seat live, pakai data cermin:', err);
    return packages;
  }
}

export async function GET() {
  try {
    const snap = await getDocs(collection(db, 'public_catalog'));
    const mirrored = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(a.departureDate || 0) - new Date(b.departureDate || 0));
    const packages = await overlayLiveSeats(mirrored);

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
