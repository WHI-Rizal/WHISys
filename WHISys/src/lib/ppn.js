// Perhitungan PPN untuk Biro Perjalanan Wisata — mengikuti skema PPN dengan
// Besaran Tertentu (PMK No. 71/2022): DPP Nilai Lain = 10% dari Harga Jual,
// dikalikan tarif PPN 11%, sehingga PPN efektif = 1,1% dari Harga Jual.
//
// SKEMA: EXCLUDE — PPN DITAMBAHKAN DI ATAS HARGA.
// - "Harga Jual" / DPP di sini = harga akhir paket + biaya tambahan (dan
//   dikurangi diskon kalau ada) — nilai dasar SEBELUM pajak, per booking
//   (field yang dulu langsung jadi `totalAmount`).
// - PPN 1,1% dihitung dari DPP itu, lalu DITAMBAHKAN ke atasnya. Total yang
//   BENAR-BENAR ditagih ke jamaah & disimpan sebagai `totalAmount` booking
//   = DPP + PPN. PPN ini ditanggung customer (nambah total tagihan), bukan
//   lagi dianggap sudah nempel di harga jual seperti skema lama.
export const PPN_RATE = 0.011; // 1,1% efektif (11% x 10% Nilai Lain)

/**
 * Dipakai saat BIKIN BOOKING BARU / EDIT booking (recalculate) — dari harga
 * dasar (DPP = harga paket + biaya tambahan - diskon), hitung PPN 1,1% dan
 * tambahkan di atasnya jadi total akhir yang ditagih & disimpan sebagai
 * `totalAmount`.
 * @param {number} dpp - Harga akhir paket + biaya tambahan (DPP), SEBELUM PPN.
 * @returns {{ dpp: number, ppn: number, total: number }}
 *   dpp   = harga dasar sebelum pajak (input apa adanya)
 *   ppn   = PPN terutang (1,1% x dpp), DITAMBAHKAN ke total
 *   total = dpp + ppn — inilah yang ditagih ke jamaah & disimpan sebagai totalAmount
 */
export const addPPN = (dpp) => {
  const base = Number(dpp) || 0;
  const ppn = Math.round(base * PPN_RATE);
  return { dpp: base, ppn, total: base + ppn };
};

/**
 * Dipakai buat TAMPILAN breakdown dari `totalAmount` booking yang SUDAH
 * final/tersimpan (invoice, riwayat pembayaran, laporan Finance) — total di
 * sini sudah termasuk PPN di dalamnya, jadi DPP-nya diambil terbalik:
 * dpp = total / (1 + tarif). Berlaku juga buat booking versi lama (sebelum
 * PPN ditambahkan di atas harga) sebagai breakdown informasi, tanpa
 * mengubah nominal total yang sudah tersimpan.
 * @param {number} total - `totalAmount` booking / nominal transaksi yang sudah final.
 * @returns {{ dpp: number, ppn: number, total: number }}
 *   dpp   = perkiraan harga dasar sebelum pajak, dihitung mundur dari total
 *   ppn   = PPN yang terkandung di dalam total (total - dpp)
 *   total = sama dengan input, tidak berubah
 */
export const calculatePPN = (total) => {
  const finalTotal = Number(total) || 0;
  const dpp = Math.round(finalTotal / (1 + PPN_RATE));
  const ppn = finalTotal - dpp;
  return { dpp, ppn, total: finalTotal };
};
