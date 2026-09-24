// ============================================================================
// Dokumen cetak "Detail Paket Wisata" (kop surat + info paket + Fasilitas &
// Layanan + Deskripsi/Flight + Itinerary Program) — dipakai bareng oleh DUA
// tombol cetak yang sebelumnya masing-masing nulis ulang ~200 baris HTML/CSS
// sendiri-sendiri dan gampang beda kalau salah satu lupa diupdate:
//   1. Dashboard, tombol "Cetak" di Modul Paket Travel & LA (PackagesModule.jsx)
//   2. Halaman katalog publik /katalog/[id] (tanpa login)
//
// Sekarang keduanya manggil `printItineraryDocument()` di sini. Kalau nanti
// mau ubah format cetakan (tambah kolom, ganti layout, dst), cukup diubah
// SEKALI di file ini — otomatis kesinkron ke dua tempat cetaknya.
//
// Beda yang MEMANG disengaja antara dashboard & publik (bukan bug, jadi tetap
// dibikin bisa diatur lewat parameter, BUKAN dihilangkan):
// - `companyInfo`: dashboard ambil dari Firestore 'settings' (privat, cuma
//   kebaca staf login). Halaman publik nggak punya akses ke situ, jadi selalu
//   pakai fallback default (lihat DEFAULT_COMPANY_INFO). Kalau nanti data
//   perusahaan mau ikut sinkron ke publik juga, tinggal expose field itu
//   lewat endpoint publik terpisah dan oper ke `companyInfo` di sini.
// - `logoSize`: dashboard pakai logo kop surat lebih besar (165px) biar
//   senada sama contoh flyer promosi; versi publik tetap 64px seperti semula.
// ============================================================================

export const DEFAULT_COMPANY_INFO = {
  name: 'PT. WISATA HALAL INTERNASIONAL',
  address: 'Ruko Graha Cirendeu No.1C Jl. Cirendeu Raya, Tangerang Selatan, Banten, Indonesia, 15445',
  phone: '-',
  email: 'admin@wisatahalalindonesia.id',
};

export function formatDateDDMMYYYY(dateString) {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

const fmtRp = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;

// Bangun string HTML dokumen lengkap (3 halaman). Fungsi murni — nggak
// nyentuh DOM sama sekali — biar gampang dites/dipreview kalau perlu.
export function buildItineraryPrintHtml(pkg, days, options = {}) {
  const {
    companyInfo = null,
    logoSize = 165,
  } = options;

  const compName = companyInfo?.name || DEFAULT_COMPANY_INFO.name;
  const compAddress = companyInfo?.address || DEFAULT_COMPANY_INFO.address;
  const compPhone = companyInfo?.phone || DEFAULT_COMPANY_INFO.phone;
  const compEmail = companyInfo?.email || DEFAULT_COMPANY_INFO.email;

  const priceMainNum = Number(pkg.priceMain) || 0;
  const dayList = Array.isArray(days) ? days : [];

  // ===== HALAMAN 1: Detail Paket + Fasilitas & Layanan =====
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

  // ===== HALAMAN 2: Deskripsi Paket + Rincian Penerbangan =====
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

  // ===== HALAMAN 3+: Itinerary Program =====
  const dayRowsHtml = dayList.map((d, idx) => `
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

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Detail Paket - ${pkg.name}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color:#1e293b; margin:0; padding:0; }
          .doc-page { padding:26px 35px; }
          .kop-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; border-bottom:3px double #059669; padding-bottom:10px; margin-bottom:18px; }
          .kop-logo { width:${logoSize}px; height:${logoSize}px; object-fit:contain; flex-shrink:0; }
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
          .flight-table { width:100%; border-collapse:collapse; font-size:11px; margin-top:4px; page-break-inside:avoid; }
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
}

// Bangun dokumen + langsung cetak lewat iframe tersembunyi (satu-satunya
// bagian yang nyentuh DOM/`window`, jadi cuma boleh dipanggil di client).
export function printItineraryDocument(pkg, days, options = {}) {
  const docContent = buildItineraryPrintHtml(pkg, days, options);

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
