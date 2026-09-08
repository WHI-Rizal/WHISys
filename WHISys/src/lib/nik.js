// Utilitas buat "baca" tanggal lahir & jenis kelamin langsung dari NIK KTP,
// TANPA OCR / API pihak ketiga sama sekali — murni logic, gratis, instan.
//
// NIK Indonesia formatnya baku 16 digit:
//   PPKKCC DDMMYY SSSS
//   - digit 1-6   : kode wilayah (provinsi/kota/kecamatan)
//   - digit 7-8   : tanggal lahir (kalau perempuan, ditambah 40 — jadi 41-71)
//   - digit 9-10  : bulan lahir
//   - digit 11-12 : 2 digit terakhir tahun lahir
//   - digit 13-16 : nomor urut registrasi
//
// Dipakai buat autofill field "Tanggal Lahir" begitu staf/customer ngetik
// NIK yang valid — nggak nunggu upload dokumen atau OCR berbayar.

/**
 * @param {string} nikRaw
 * @returns {{ birthDate: string, gender: 'L' | 'P' } | null}
 *   birthDate format 'YYYY-MM-DD' (cocok buat <input type="date"> / DateFieldID).
 *   Return null kalau NIK-nya nggak 16 digit atau tanggalnya nggak valid.
 */
export function parseNikBirthInfo(nikRaw) {
  const nik = String(nikRaw || '').replace(/\D/g, '');
  if (nik.length !== 16) return null;

  let dd = parseInt(nik.slice(6, 8), 10);
  const mm = parseInt(nik.slice(8, 10), 10);
  const yy = parseInt(nik.slice(10, 12), 10);
  if (Number.isNaN(dd) || Number.isNaN(mm) || Number.isNaN(yy)) return null;

  let gender = 'L';
  if (dd > 40) {
    gender = 'P';
    dd -= 40;
  }
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;

  // NIK cuma nyimpen 2 digit tahun — coba anggap 20YY dulu, tapi kalau
  // hasilnya jadi tanggal di masa depan (mustahil buat tanggal lahir),
  // baru dianggap 19YY. Heuristik umum yang dipakai buat kasus kayak ini.
  const now = new Date();
  let fullYear = 2000 + yy;
  if (fullYear > now.getFullYear()) fullYear = 1900 + yy;

  // Validasi tanggalnya beneran ada (misal nolak 30 Februari)
  const dateObj = new Date(fullYear, mm - 1, dd);
  if (
    dateObj.getFullYear() !== fullYear ||
    dateObj.getMonth() !== mm - 1 ||
    dateObj.getDate() !== dd
  ) {
    return null;
  }

  const pad = (n) => String(n).padStart(2, '0');
  return { birthDate: `${fullYear}-${pad(mm)}-${pad(dd)}`, gender };
}
