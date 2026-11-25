import { authorizeJarvis, jarvisJson } from '@/lib/jarvisAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Halaman "petunjuk pemakaian" untuk Jarvis sendiri (dibaca AI sebagai kamus endpoint).
export async function GET(req) {
  const denied = authorizeJarvis(req);
  if (denied) return denied;
  return jarvisJson({
    name: 'WHISys Jarvis API',
    version: 1,
    mode: 'BACA SAJA. Tidak ada endpoint untuk mengubah data.',
    auth: 'Header Authorization: Bearer <JARVIS_API_TOKEN>',
    privacy: 'Tidak pernah mengembalikan NIK, nomor paspor, nomor HP, alamat, nominal uang, atau HPP/margin. Jangan minta atau menebak data itu.',
    endpoints: [
      {
        path: '/api/jarvis/packages',
        use: 'Daftar paket keberangkatan, sisa seat, jumlah booking aktif. Tambah id= atau code= untuk detail satu paket (harga per tipe kamar, jadwal penerbangan, itinerary ringkas).',
        params: { q: 'cari nama/kode/kota', id: 'id paket', code: 'kode paket, mis. PKG-000037', days: 'berangkat dalam N hari ke depan (default 365)', includePast: '1 = ikut paket yang sudah berangkat', catalog: 'active = hanya yang aktif di katalog publik', limit: 'default 20, maks 50' },
      },
      {
        path: '/api/jarvis/manifest',
        use: 'Kesiapan manifest satu paket: jumlah peserta, tipe kamar, siapa yang datanya masih kurang (paspor, tanggal lahir, dll).',
        params: { packageId: 'id paket', code: 'kode paket', docs: 'dokumen wajib dipisah koma, default passport,ktp_foto. Pilihan: passport,ktp_foto,family_cert,sponsor_letter,bank_statement,vaccine_cert,visa,ticket', minMonths: 'minimal masa berlaku paspor setelah berangkat, default 6' },
      },
      {
        path: '/api/jarvis/reminders',
        use: 'Bahan pengingat otomatis: paspor bermasalah, dokumen belum lengkap, tagihan DP 2 dan Pelunasan yang lewat atau segera jatuh tempo (tanpa nominal).',
        params: { type: 'all | passport | documents | payments (default all)', packageId: 'batasi ke satu paket', days: 'untuk tagihan: dianggap segera jatuh tempo kalau dalam N hari (default 7)', horizon: 'hanya paket yang berangkat dalam N hari ke depan (default 120)', docsDays: 'cek dokumen untuk paket yang berangkat dalam N hari (default 60)', docs: 'dokumen wajib, default passport,ktp_foto', minMonths: 'default 6' },
      },
    ],
    notes: [
      'Jatuh tempo DP 2 = 30 hari setelah booking dibuat. Jatuh tempo Pelunasan = 40 hari sebelum tanggal berangkat.',
      'Daftar dipotong maksimal 50 baris per kategori, lihat field total untuk jumlah sebenarnya.',
      'Data di-cache sampai 60 detik.',
    ],
  });
}
