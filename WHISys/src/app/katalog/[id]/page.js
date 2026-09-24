'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Printer, MapPin, Calendar, Plane, Hotel, CheckCircle2, XCircle,
  Loader2, AlertTriangle, Users,
} from 'lucide-react';
import {
  formatTanggalPanjang, formatRupiah, hargaMulai,
} from '@/lib/publicCatalogFormat';
import { printItineraryDocument } from '@/lib/itineraryPrintDoc';

// ============================================================================
// DETAIL PAKET PUBLIK — halaman ala "cetakan itinerary/brosur", diakses
// publik TANPA login di https://sys.wisatahalalindonesia.com/katalog/[id].
//
// Referensi tampilan: contoh halaman detail paket wisatahalaltour.com yang
// dikasih user (16 Sep 2026, malam) — bagian utama yang direplikasi: judul +
// gambar flyer, info periode & harga mulai, jadwal penerbangan, rincian
// harga per tipe kamar, Harga Termasuk/Tidak Termasuk, dan (yang jadi inti
// permintaan "cetakan itinerary") jadwal hari demi hari.
//
// Datanya diambil dari endpoint yang SAMA kayak halaman /katalog, GET
// /api/public/catalog (bukan bikin endpoint detail terpisah) — cari paket
// yang id-nya cocok dari daftar yang dibalikin. Dataset paket aktif
// biasanya kecil (puluhan), jadi ini lebih sederhana daripada bikin
// endpoint GET /api/public/catalog/[id] baru; kalau nanti jumlah paket aktif
// udah ratusan dan ini kerasa berat, gampang dipisah jadi endpoint sendiri
// tanpa ubah apapun di halaman /katalog.
// ============================================================================

// ============================================================================
// Cetak "Detail Paket" ala dokumen resmi. Dulu di sini nulis ulang manual
// ~200 baris HTML/CSS yang isinya nyaris kembar sama tombol "Cetak"
// itinerary di dashboard (PackagesModule.jsx) — sekarang keduanya manggil
// `printItineraryDocument()` yang sama dari src/lib/itineraryPrintDoc.js,
// jadi kalau format cetakan diubah, dua-duanya otomatis ikut sinkron.
//
// CATATAN: nggak ada akses ke `companyInfo` dari Firestore 'settings' di
// sini (itu koleksi privat, cuma kebaca staf login) — jadi `companyInfo`
// dibiarkan kosong dan otomatis pakai fallback default di
// itineraryPrintDoc.js (kalau nanti butuh sinkron beneran, tinggal expose
// field itu lewat endpoint publik terpisah dan oper ke sini). Ukuran logo
// kop surat (64px) tetap dipertahankan seperti sebelumnya, beda dari versi
// dashboard yang 165px.
// ============================================================================
function handlePrintKatalog(pkg) {
  const days = Array.isArray(pkg.itinerary) ? pkg.itinerary : [];
  printItineraryDocument(pkg, days, { logoSize: 64 });
}

function renderMeals(meals) {
  if (!meals) return null;
  if (typeof meals === 'string') return meals || null;
  if (typeof meals === 'object') {
    const labels = { breakfast: 'Sarapan', lunch: 'Makan Siang', dinner: 'Makan Malam' };
    const parts = Object.entries(meals)
      .filter(([, v]) => v)
      .map(([k, v]) => `${labels[k] || k}: ${v}`);
    return parts.length ? parts.join(' · ') : null;
  }
  return null;
}

export default function DetailPaketPage({ params }) {
  // Next.js 14.2.x: `params` di sini masih objek biasa (sinkron), BUKAN
  // Promise seperti di Next.js 15 — jadi cukup destructure langsung, nggak
  // perlu React.use(). Kalau proyek ini nanti di-upgrade ke Next 15+, baris
  // ini yang perlu disesuaikan (bungkus params dengan React.use()).
  const { id } = params;

  const [pkg, setPkg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg('');
      try {
        const res = await fetch('/api/public/catalog', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Gagal mengambil data katalog.');
        const found = (Array.isArray(data.packages) ? data.packages : []).find((p) => p.id === id);
        if (!cancelled) {
          if (!found) {
            setErrorMsg('Paket tidak ditemukan, mungkin sudah tidak aktif atau sudah dihapus.');
          } else {
            setPkg(found);
          }
        }
      } catch (err) {
        if (!cancelled) setErrorMsg('Gagal memuat detail paket. Silakan muat ulang halaman ini.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (id) load();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center gap-2 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Memuat detail paket...</span>
      </div>
    );
  }

  if (errorMsg || !pkg) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3 text-center px-4">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <p className="text-sm text-slate-600">{errorMsg || 'Paket tidak ditemukan.'}</p>
        <Link href="/katalog" className="text-emerald-700 text-sm font-semibold hover:underline">
          &larr; Kembali ke Katalog
        </Link>
      </div>
    );
  }

  const harga = hargaMulai(pkg);
  const isLAOnly = pkg.type === 'Land Arrangement (LA) Only';
  const isUmrohHaji = pkg.type === 'Umroh Regular' || pkg.type === 'Umroh VIP / Plus' || pkg.type === 'Haji Khusus / Furoda';

  const hargaRows = [
    { label: 'Harga Utama', value: pkg.priceMain },
    { label: 'Triple (3 orang/kamar)', value: pkg.priceTriple },
    { label: 'Double (2 orang/kamar)', value: pkg.priceDouble },
    { label: 'Anak-anak', value: pkg.priceChild },
  ].filter((r) => Number(r.value) > 0);

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {/* Toolbar - disembunyikan pas print */}
      <div className="bg-white border-b border-slate-200 print:hidden">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/katalog" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-emerald-700">
            <ArrowLeft className="w-4 h-4" />
            Kembali ke Katalog
          </Link>
          <button
            type="button"
            onClick={() => handlePrintKatalog(pkg)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-emerald-700 border border-slate-300 rounded-lg px-3 py-1.5"
          >
            <Printer className="w-4 h-4" />
            Cetak / Simpan PDF
          </button>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Hero — flyer di kiri (ukuran ringkas, ikut lebar kolom, nggak
            di-crop) dan info paket di kanan, niru layout dokumen PDF
            "Detail Paket Wisata" biar nggak makan tempat kayak sebelumnya. */}
        <div className="flex flex-col sm:flex-row gap-5 mb-6">
          {pkg.flyerImageDataUrl && (
            <div className="sm:w-[42%] shrink-0 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 flex items-start justify-center">
              <img src={pkg.flyerImageDataUrl} alt={pkg.name} className="w-full h-auto block" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase mb-1">
              {pkg.type || 'Paket Perjalanan'}{pkg.code ? ` · ${pkg.code}` : ''}
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">{pkg.name}</h1>

            {/* Ke bawah (bukan menyamping) — dulu flex-wrap sejajar, sekarang
                ditumpuk satu kolom biar rapi soal tombol WA di kotak harga
                udah dihapus jadi kotaknya nggak longgar-longgar amat. */}
            <div className="flex flex-col gap-1.5 text-sm text-slate-600 mb-4">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-emerald-700" />
                Keberangkatan {formatTanggalPanjang(pkg.departureDate)}
                {pkg.durationDays ? ` · ${pkg.durationDays}` : ''}
              </span>
              {pkg.destinationCity && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-700" />
                  {pkg.destinationCity}
                </span>
              )}
              {typeof pkg.quotaRemaining === 'number' && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-700" />
                  Sisa Seat: {pkg.quotaRemaining}
                </span>
              )}
              {pkg.airline && (
                <span className="inline-flex items-center gap-1.5">
                  <Plane className="w-4 h-4 text-emerald-700" />
                  {pkg.airline}
                </span>
              )}
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
              <p className="text-xs text-emerald-700 font-medium">Harga mulai</p>
              <p className="text-2xl font-bold text-emerald-800">
                {harga ? `${formatRupiah(harga)} /pax` : 'Hubungi kami'}
              </p>
            </div>
          </div>
        </div>

        {pkg.specialNote && (
          <div className="mb-6 text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-lg p-4 whitespace-pre-wrap">
            {pkg.specialNote}
          </div>
        )}

        {/* Info penerbangan */}
        {Array.isArray(pkg.flightSegments) && pkg.flightSegments.length > 0 && (
          <section className="mb-8">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 mb-3">
              <Plane className="w-4 h-4 text-emerald-700" />
              Jadwal Penerbangan {pkg.airline ? `(${pkg.airline})` : ''}
            </h2>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">No. Penerbangan</th>
                    <th className="text-left font-semibold px-3 py-2">Tanggal</th>
                    <th className="text-left font-semibold px-3 py-2">Rute</th>
                    <th className="text-left font-semibold px-3 py-2">Berangkat</th>
                    <th className="text-left font-semibold px-3 py-2">Tiba</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pkg.flightSegments.map((f, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2">{f.flightNumber || '-'}</td>
                      <td className="px-3 py-2">{f.date || '-'}</td>
                      <td className="px-3 py-2">{f.route || '-'}</td>
                      <td className="px-3 py-2">{f.depTime || '-'}</td>
                      <td className="px-3 py-2">{f.arrTime || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Hotel */}
        {(pkg.hotelMakkah || pkg.hotelMadinah || pkg.hotelTour || pkg.laScope) && (
          <section className="mb-8">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 mb-3">
              <Hotel className="w-4 h-4 text-emerald-700" />
              {isLAOnly ? 'Cakupan Land Arrangement' : 'Akomodasi'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {isUmrohHaji && pkg.hotelMakkah && (
                <div className="border border-slate-200 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Hotel Makkah</p>
                  <p className="font-medium text-slate-800">{pkg.hotelMakkah}</p>
                </div>
              )}
              {isUmrohHaji && pkg.hotelMadinah && (
                <div className="border border-slate-200 rounded-lg p-3">
                  <p className="text-xs text-slate-500 mb-0.5">Hotel Madinah</p>
                  <p className="font-medium text-slate-800">{pkg.hotelMadinah}</p>
                </div>
              )}
              {!isUmrohHaji && !isLAOnly && pkg.hotelTour && (
                <div className="border border-slate-200 rounded-lg p-3 sm:col-span-2">
                  <p className="text-xs text-slate-500 mb-0.5">Hotel</p>
                  <p className="font-medium text-slate-800">{pkg.hotelTour}</p>
                </div>
              )}
              {isLAOnly && pkg.laScope && (
                <div className="border border-slate-200 rounded-lg p-3 sm:col-span-2 whitespace-pre-wrap">
                  <p className="text-xs text-slate-500 mb-0.5">Cakupan Layanan</p>
                  <p className="font-medium text-slate-800">{pkg.laScope}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Itinerary hari demi hari — ini inti "cetakan itinerary" */}
        {Array.isArray(pkg.itinerary) && pkg.itinerary.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-bold text-slate-900 mb-3">Jadwal Perjalanan (Itinerary)</h2>
            <div className="space-y-4">
              {pkg.itinerary.map((day, idx) => {
                const meals = renderMeals(day.meals);
                return (
                  <div key={idx} className="border border-slate-200 rounded-lg p-4">
                    <p className="font-bold text-slate-900 text-sm mb-1">{day.title || `Hari ke-${idx + 1}`}</p>
                    {day.description && (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap mb-2">{day.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      {meals && <span>🍽️ {meals}</span>}
                      {day.hotel && <span>🏨 {day.hotel}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Rincian harga per tipe kamar */}
        {hargaRows.length > 0 && (
          <section className="mb-8">
            <h2 className="text-base font-bold text-slate-900 mb-3">Rincian Harga per Pax</h2>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {hargaRows.map((r) => (
                    <tr key={r.label}>
                      <td className="px-3 py-2 text-slate-600">{r.label}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatRupiah(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Harga termasuk / tidak termasuk */}
        {((Array.isArray(pkg.priceIncludes) && pkg.priceIncludes.length > 0) ||
          (Array.isArray(pkg.priceExcludes) && pkg.priceExcludes.length > 0)) && (
          <section className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
            {Array.isArray(pkg.priceIncludes) && pkg.priceIncludes.length > 0 && (
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  Harga Termasuk
                </h2>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  {pkg.priceIncludes.map((item, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="text-emerald-600">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(pkg.priceExcludes) && pkg.priceExcludes.length > 0 && (
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 mb-3">
                  <XCircle className="w-4 h-4 text-rose-500" />
                  Harga Tidak Termasuk
                </h2>
                <ul className="space-y-1.5 text-sm text-slate-700">
                  {pkg.priceExcludes.map((item, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="text-rose-500">•</span>
                      <span>
                        {typeof item === 'string'
                          ? item
                          : [item.label, item.amount ? formatRupiah(item.amount) : null, item.note]
                              .filter(Boolean)
                              .join(' — ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* CTA bawah */}
        <div className="print:hidden flex flex-col sm:flex-row gap-3 mt-8">
          <Link
            href="/katalog"
            className="flex-1 inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-bold rounded-lg px-5 py-3 transition-colors"
          >
            Lihat Paket Lainnya
          </Link>
        </div>
      </main>

      <footer className="print:hidden text-center text-xs text-slate-400 py-8">
        &copy; {new Date().getFullYear()} PT. Wisata Halal Internasional
      </footer>
    </div>
  );
}
