// Perhitungan PPN untuk Biro Perjalanan Wisata — mengikuti skema PPN dengan
// Besaran Tertentu (PMK No. 71/2022): DPP Nilai Lain = 10% dari Harga Jual,
// dikalikan tarif PPN 11%, sehingga PPN efektif = 1,1% dari Harga Jual.
//
// PENTING soal konsep harga di WHISys:
// - "Harga Jual" / DPP di sini = harga akhir paket + biaya tambahan (dan
//   dikurangi diskon kalau ada) — nilai akhir yang benar-benar ditagihkan
//   ke jamaah untuk 1 booking (field `totalAmount` pada dokumen booking).
// - Harga yang ditagihkan ke jamaah SUDAH TERMASUK PPN ini (PPN ditanggung
//   customer, sudah include di harga jual) — jadi PPN ini murni breakdown
//   informasi (buat kwitansi/invoice, detail booking, dan laporan pajak di
//   Finance), BUKAN nominal tambahan yang menambah total tagihan.
export const PPN_RATE = 0.011; // 1,1% efektif (11% x 10% Nilai Lain)

/**
 * @param {number} hargaJual - Harga akhir paket + biaya tambahan (DPP), per booking.
 * @returns {{ dpp: number, ppn: number, total: number }}
 *   dpp  = Harga Jual (dasar pengenaan pajak, sesuai definisi WHISys)
 *   ppn  = PPN terutang (1,1% x dpp), sudah termasuk di dalam harga jual
 *   total = sama dengan dpp — total tagihan TIDAK berubah, PPN cuma breakdown
 */
export const calculatePPN = (hargaJual) => {
  const dpp = Number(hargaJual) || 0;
  const ppn = Math.round(dpp * PPN_RATE);
  return { dpp, ppn, total: dpp };
};
