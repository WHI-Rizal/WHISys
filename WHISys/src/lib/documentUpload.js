// ============================================================================
// Konfigurasi & helper upload dokumen jamaah (paspor/KTP/dll) — DIPAKAI
// BARENG oleh 2 tempat: Portal Jamaah (src/app/portal/page.js, jamaah upload
// sendiri) dan Dashboard Staf (src/app/dashboard/BookingsModule.jsx, modul
// "Checklist Dokumen Jamaah" — OP bantu upload buat jamaah lansia/yang nggak
// paham buka Portal). Disatuin di sini (21 Sep 2026) biar APPS_SCRIPT_URL
// & daftar dokumen cuma perlu di-setting SEKALI, nggak dobel-dobel.
//
// File disimpen ke GOOGLE DRIVE (bukan Firebase Storage) — sengaja, biar
// nggak perlu upgrade project Firebase ke plan Blaze (butuh kartu kredit).
// Caranya: file dikirim dari browser (baik dari Portal jamaah maupun dari
// Dashboard staf) ke sebuah Google Apps Script Web App (jembatan yang jalan
// atas nama akun Drive WHISys sendiri), yang nyimpen filenya ke folder Drive
// lalu balikin link-nya.
//
// *** WAJIB DI-SETUP DULU biar fitur upload (Portal MAUPUN Dashboard staf)
// beneran bisa jalan: ***
// 1. Buka https://script.google.com, bikin project baru.
// 2. Copas isi file 'Code.gs' (udah pernah dikirim terpisah) ke situ.
// 3. Deploy > New deployment > Web app. "Execute as": Me. "Who has access":
//    Anyone.
// 4. Copas URL hasil deploy-nya, tempel ganti nilai APPS_SCRIPT_URL di bawah
//    ini.
// Selama masih placeholder, tombol upload di Portal MAUPUN Dashboard staf
// bakal langsung nolak dengan pesan error yang jelas — bukan diem-diem
// gagal.
export const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzTZnbKhIBzBK3vpJOHqVmulyAP_KTGzIkbr9I4vxdkxFtP_aih1KXQ705z89ApS4A/exec';

// Daftar 8 dokumen persyaratan standar travel — key HARUS sama persis
// dengan field 'documents.{key}' / 'documentFiles.{key}' di collection
// 'bookings' (dipakai juga di REQUIRED_DOCUMENTS milik BookingsModule.jsx).
export const DOC_LABELS = {
  passport: 'Paspor',
  ktp_foto: 'Foto KTP',
  family_cert: 'Kartu Keluarga',
  sponsor_letter: 'Surat Sponsor',
  bank_statement: 'Rekening Koran',
  vaccine_cert: 'Sertifikat Vaksin',
  visa: 'Visa',
  ticket: 'Tiket',
};
export const DOC_KEYS = Object.keys(DOC_LABELS);

// Batas upload — jaga-jaga biar nggak ada yang ngirim file gede/aneh-aneh
// (foto kamera HP jaman sekarang bisa belasan MB). PDF & foto biasa udah
// lebih dari cukup di bawah batas ini.
export const MAX_UPLOAD_MB = 8;
export const ALLOWED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

// Ubah File jadi base64 murni (tanpa prefix "data:...;base64,") — format
// yang dipahami Code.gs di sisi Apps Script buat di-decode balik jadi file.
export const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    const base64 = result.includes(',') ? result.split(',')[1] : result;
    resolve(base64);
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// Validasi file sebelum dikirim (dipakai baik dari Portal maupun Dashboard
// staf) — balikin pesan error (string) kalau nggak valid, atau null kalau OK.
export const validateUploadFile = (file, label) => {
  if (!file) return null;
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return `File "${label}" harus berupa foto (JPG/PNG/HEIC) atau PDF.`;
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `File "${label}" kebesaran (maks ${MAX_UPLOAD_MB}MB). Coba kompres/foto ulang dulu.`;
  }
  return null;
};

// Kirim file ke Google Apps Script Web App, balikin { url, fileName } kalau
// sukses. Melempar Error kalau APPS_SCRIPT_URL belum di-setup atau upload
// gagal — pemanggil (Portal/Dashboard) yang nangkep & tampilin pesannya.
export const uploadDocumentFile = async ({ bookingId, bookingCode, docKey, file }) => {
  if (APPS_SCRIPT_URL.startsWith('GANTI_DENGAN')) {
    throw new Error('Fitur upload belum aktif — URL Google Apps Script belum dipasang (lihat komentar di src/lib/documentUpload.js).');
  }
  const base64Data = await fileToBase64(file);
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    // SENGAJA tanpa header Content-Type eksplisit (jadi browser default-nya
    // text/plain) — biar request-nya dianggap "simple request" jadi nggak
    // butuh preflight OPTIONS (Google Apps Script Web App nggak nanganin
    // preflight CORS itu). Code.gs tetap parse isinya sebagai JSON.
    body: JSON.stringify({
      bookingId,
      bookingCode: bookingCode || '',
      docKey,
      fileName: file.name,
      mimeType: file.type,
      base64Data,
    }),
  });
  if (!res.ok) {
    throw new Error(`Server upload merespons status ${res.status}.`);
  }
  const result = await res.json();
  if (!result.success || !result.url) {
    throw new Error(result.error || 'Upload gagal tanpa keterangan.');
  }
  return { url: result.url, fileName: file.name };
};
