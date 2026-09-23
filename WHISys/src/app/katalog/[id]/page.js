'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Printer, MapPin, Calendar, Plane, Hotel, CheckCircle2, XCircle,
  Loader2, AlertTriangle, MessageCircle, Users,
} from 'lucide-react';
import {
  formatTanggalPanjang, formatRupiah, hargaMulai, waLinkUntukPaket,
} from '@/lib/publicCatalogFormat';

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

// Helper Format Tanggal dd/mm/yyyy — sama persis kayak yang dipakai tombol
// "Cetak" di Modul Paket Travel & LA (dashboard), biar format tanggal di
// cetakan publik ini konsisten sama versi staf.
function formatDateDDMMYYYY(dateString) {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// ============================================================================
// Cetak "Detail Paket" ala dokumen resmi — PERSIS pola yang dipakai tombol
// "Cetak" itinerary di Modul Paket Travel & LA (dashboard, handlePrintItinerary
// di PackagesModule.jsx): kop surat, halaman 1 flyer (object-fit:cover TAPI
// di kotak besar 46% lebar & max-height 420px, jadi croppingnya nggak separah
// versi hero <img> di halaman ini yang cuma max-h-96 mepet), Fasilitas &
// Layanan, halaman 2 Deskripsi+Flight, halaman 3 Itinerary.
//
// SEBELUMNYA tombol "Cetak / Simpan PDF" di halaman ini cuma manggil
// window.print() ke halaman web yang lagi tampil — flyer di hero section
// (className="w-full object-cover max-h-96") kepotong parah pas dicetak
// karena box-nya sempit & rasio gambarnya sering potret/nggak pas 16:9.
// Sekarang dibikin dokumen cetak TERPISAH (iframe tersembunyi, sama kayak
// versi dashboard) biar hasilnya konsisten dan nggak kepotong sepihak.
//
// CATATAN: nggak ada akses ke `companyInfo` dari Firestore 'settings' di
// sini (itu koleksi privat, cuma kebaca staf login) — dipakai fallback
// default yang SAMA PERSIS kayak default di handlePrintItinerary, jadi
// hasilnya identik selama staf belum override Data Perusahaan di
// pengaturan (kalau nanti butuh sinkron beneran, tinggal expose field itu
// lewat public_catalog atau endpoint publik terpisah).
// ============================================================================
function handlePrintKatalog(pkg) {
  const compName = 'PT. WISATA HALAL INTERNASIONAL';
  const compAddress = 'Ruko Graha Cirendeu No.1C Jl. Cirendeu Raya, Tangerang Selatan, Banten, Indonesia, 15445';
  const compPhone = '-';
  const compEmail = 'admin@wisatahalalindonesia.id';

  const priceMainNum = Number(pkg.priceMain) || 0;
  const fmtRp = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
  const days = Array.isArray(pkg.itinerary) ? pkg.itinerary : [];

  const includesList = (Array.isArray(pkg.priceIncludes) && pkg.priceIncludes.length > 0) ? pkg.priceIncludes : [];
  const excludesList = (Array.isArray(pkg.priceExcludes) && pkg.priceExcludes.length > 0) ? pkg.priceExcludes : [];
  const includesHtml = includesList.length > 0
    ? includesList.map(v => `<li>${v}</li>`).join('')
    : '<li style="color:#94a3b8;list-style:none;">Belum diisi.</li>';
  const excludesHtml = excludesList.length > 0
    ? excludesList.map(it => {
        const amountPart = Number(it.amount) > 0 ? ` : ${fmtRp(it.amount)}${it.note ? ` ${it.note}` : ''}` : (it.note ? ` ${it.note}` : '');
        return `<li>${typeof it === 'string' ? it : `${it.label}${amountPart}`}</li>`;
      }).join('')
    : '<li style="color:#94a3b8;list-style:none;">Belum diisi.</li>';

  const hasFlyer = !!pkg.flyerImageDataUrl;
  const detailCardsHtml = `
    <div class="detail-card">
      <div class="card-bar">DETAIL PAKET WISATA</div>
      <table class="info-grid">
        <tr><td class="info-label">Nama Paket</td><td class="info-value">${pkg.name || '-'}</td></tr>
        <tr><td class="info-label">Jenis Paket</td><td class="info-value">${pkg.type || '-'}</td></tr>
        <tr><td class="info-label">Tujuan / Destinasi</td><td class="info-value">${pkg.destinationCity || '-'}</td></tr>
        <tr><td class="info-label">Durasi Wisata</td><td class="info-value">${pkg.durationDays || '-'}</td></tr>
        <tr><td class="info-label">Waktu Keberangkatan</td><td class="info-value">${formatDateDDMMYYYY(pkg.departureDate)}</td></tr>
        <tr><td class="info-label">Harga Paket</td><td class="info-value price-cell">${fmtRp(priceMainNum)} / Pax</td></tr>
      </table>
    </div>
    <div class="detail-card">
      <div class="card-bar">INFORMASI PEMESANAN</div>
      <div class="card-body">
        <p>Kantor Pusat: <strong>${compName}</strong></p>
        <p>Telepon / WA: <strong>${compPhone}</strong></p>
        <p>Email: <strong>${compEmail}</strong></p>
      </div>
    </div>
  `;

  const page1 = `
    <div class="kop-header">
      <img src="/logo.png" class="kop-logo" onerror="this.style.display='none'" />
      <div class="kop-text">
        <h1 class="company-logo-title">${compName}</h1>
        <p class="company-address">${compAddress}</p>
      </div>
    </div>

    <div class="page1-body ${hasFlyer ? 'with-flyer' : ''}">
      ${hasFlyer ? `<img src="${pkg.flyerImageDataUrl}" class="flyer-image" alt="Flyer ${pkg.name || ''}" />` : ''}
      <div class="page1-right">${detailCardsHtml}</div>
    </div>

    <h3 class="section-title">Fasilitas & Layanan</h3>
    <div class="facilities-grid">
      <div class="facility-box facility-include">
        <h4>Harga Termasuk</h4>
        <ul>${includesHtml}</ul>
      </div>
      <div class="facility-box facility-exclude">
        <h4>Harga Tidak Termasuk</h4>
        <ul>${excludesHtml}</ul>
      </div>
    </div>
  `;

  const segments = (Array.isArray(pkg.flightSegments) && pkg.flightSegments.length > 0) ? pkg.flightSegments : [];
  const flightRowsHtml = segments.length > 0
    ? segments.map((s, idx) => `
        <tr>
          <td>${idx + 1}.</td>
          <td>${s.flightNumber || '-'}</td>
          <td>${formatDateDDMMYYYY(s.date)}</td>
          <td>${s.route || '-'}</td>
          <td>${s.depTime || '-'} - ${s.arrTime || '-'}</td>
        </tr>`).join('')
    : `<tr><td colspan="5" style="color:#94a3b8;">Belum ada rincian penerbangan.</td></tr>`;

  const page2 = `
    <h2 class="doc-title">DESKRIPSI PAKET</h2>
    <p class="desc-package-name">${pkg.name || '-'}</p>
    <p class="desc-sub">Periode: ${formatDateDDMMYYYY(pkg.departureDate)} &bull; Durasi ${pkg.durationDays || '-'}</p>
    <p class="desc-price">${fmtRp(priceMainNum)} / Pax</p>

    <h3 class="section-title">Flight by ${pkg.airline || '-'}</h3>
    <table class="flight-table">
      <thead><tr><th></th><th>No. Flight</th><th>Tanggal</th><th>Rute</th><th>Jam (Berangkat - Tiba)</th></tr></thead>
      <tbody>${flightRowsHtml}</tbody>
    </table>

    ${pkg.specialNote ? `
      <div class="note-box">
        <h5>Catatan</h5>
        <p style="white-space:pre-wrap;">${pkg.specialNote}</p>
      </div>` : ''}
  `;

  const dayRowsHtml = days.map((d, idx) => `
    <div class="itinerary-day">
      <h3>Hari ke-${idx + 1}${d.title ? ' &mdash; ' + d.title : ''}</h3>
      <p class="itinerary-desc">${d.description || '-'}</p>
      <div class="itinerary-meta">
        ${d.hotel ? `🏨 Hotel: <strong>${d.hotel}</strong><br/>` : ''}
        ${d.meals ? `🍽️ Makan: <strong>${d.meals}</strong>` : ''}
      </div>
    </div>
  `).join('');

  const page3 = `
    <h2 class="doc-title">ITINERARY PROGRAM</h2>
    ${dayRowsHtml || '<p style="color:#94a3b8;">Belum ada itinerary.</p>'}
    <p class="footer-note">Catatan: Itinerary tidak mengikat, sewaktu-waktu bisa berubah menyesuaikan situasi & kondisi saat di lapangan.</p>
  `;

  const docContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Detail Paket - ${pkg.name}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#1e293b; margin:0; padding:0; }
          .doc-page { padding:26px 35px; }
          .kop-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; border-bottom:3px double #059669; padding-bottom:10px; margin-bottom:18px; }
          .kop-logo { width:165px; height:165px; object-fit:contain; flex-shrink:0; }
          .kop-text { text-align:right; padding-top:6px; }
          .company-logo-title { font-size:20px; font-weight:800; color:#059669; margin:0; letter-spacing:0.3px; }
          .company-address { font-size:10px; color:#64748b; margin:3px 0 0 0; max-width:420px; margin-left:auto; line-height:1.5; }
          .doc-title { font-size:15px; font-weight:800; color:#0f172a; text-align:center; letter-spacing:0.5px; margin:0 0 16px 0; }
          .section-title { font-size:12px; font-weight:800; color:#059669; text-transform:uppercase; letter-spacing:0.5px; margin:18px 0 8px 0; border-bottom:1px solid #e2e8f0; padding-bottom:4px; }
          .page1-body { display:flex; gap:16px; margin-bottom:6px; }
          .page1-body.with-flyer .page1-right { flex:1; display:flex; flex-direction:column; gap:12px; min-width:0; }
          .page1-body:not(.with-flyer) .page1-right { width:100%; display:flex; flex-direction:column; gap:12px; }
          .flyer-image { width:46%; flex-shrink:0; object-fit:cover; border-radius:10px; border:1px solid #e2e8f0; max-height:420px; }
          .detail-card { border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; page-break-inside:avoid; }
          .card-bar { background:#047857; color:#fff; font-size:11.5px; font-weight:800; letter-spacing:0.5px; padding:8px 14px; }
          .detail-card .info-grid { margin-bottom:0; }
          .detail-card .card-body { padding:10px 14px; font-size:11px; color:#334155; }
          .detail-card .card-body p { margin:3px 0; }
          .info-grid { width:100%; border-collapse:collapse; }
          .info-grid td { padding:7px 14px; font-size:11.5px; border-bottom:1px solid #f1f5f9; }
          .info-label { color:#64748b; width:42%; }
          .info-value { color:#0f172a; font-weight:600; }
          .price-cell { color:#059669; font-size:13px; }
          .facilities-grid { display:flex; gap:14px; margin-bottom:14px; }
          .facility-box { flex:1; border-radius:8px; padding:12px 14px; font-size:11px; page-break-inside:avoid; }
          .facility-include { background:#f0fdf4; border:1px solid #bbf7d0; }
          .facility-exclude { background:#fff7ed; border:1px solid #fed7aa; }
          .facility-box h4 { margin:0 0 6px 0; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; }
          .facility-include h4 { color:#047857; }
          .facility-exclude h4 { color:#c2410c; }
          .facility-box ul { margin:0; padding-left:16px; }
          .facility-box li { margin-bottom:3px; }
          .desc-package-name { font-size:16px; font-weight:800; color:#0f172a; margin:0 0 2px 0; }
          .desc-sub { font-size:11px; color:#64748b; margin:0 0 8px 0; }
          .desc-price { font-size:14px; font-weight:800; color:#059669; margin:0 0 6px 0; }
          .flight-table { width:100%; border-collapse:collapse; font-size:11px; margin-top:4px; }
          .flight-table th { background:#f1f5f9; text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; color:#475569; border-bottom:2px solid #cbd5e1; }
          .flight-table td { padding:6px 8px; border-bottom:1px solid #f1f5f9; }
          .note-box { margin-top:16px; background:#fffbeb; border:1px dashed #fbbf24; border-radius:8px; padding:10px 14px; font-size:10.5px; color:#78350f; }
          .note-box h5 { margin:0 0 4px 0; font-size:11px; }
          .itinerary-day { margin-bottom:16px; padding-bottom:12px; border-bottom:1px dashed #e2e8f0; page-break-inside:avoid; }
          .itinerary-day h3 { margin:0 0 6px 0; font-size:13px; color:#065f46; }
          .itinerary-desc { margin:0 0 6px 0; font-size:12px; color:#334155; white-space:pre-wrap; }
          .itinerary-meta { font-size:11px; color:#64748b; }
          .footer-note { text-align:center; font-size:10px; color:#94a3b8; margin-top:20px; border-top:1px solid #f1f5f9; padding-top:10px; }
          @media print { .doc-page { padding:16px 30px; } }
        </style>
      </head>
      <body>
        <div class="doc-page">${page1}</div>
        <div class="doc-page">${page2}</div>
        <div class="doc-page">${page3}</div>
      </body>
    </html>
  `;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc2 = iframe.contentWindow.document;
  doc2.open();
  doc2.write(docContent);
  doc2.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    document.body.removeChild(iframe);
  }, 500);
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
  const wa = waLinkUntukPaket(pkg);

  const hargaRows = [
    { label: 'Harga Utama', value: pkg.priceMain },
    { label: 'Quad (4 orang/kamar)', value: pkg.priceQuad },
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

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 mb-4">
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
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:items-start gap-3">
              <div>
                <p className="text-xs text-emerald-700 font-medium">Harga mulai</p>
                <p className="text-2xl font-bold text-emerald-800">
                  {harga ? `${formatRupiah(harga)} /pax` : 'Hubungi kami'}
                </p>
              </div>
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="print:hidden w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-lg px-5 py-3 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Konsultasi / Pesan via WhatsApp
              </a>
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
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-lg px-5 py-3 transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            Konsultasi / Pesan Paket Ini
          </a>
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
