// Helper format bersama buat halaman publik katalog (`/katalog`) dan detail
// paket (`/katalog/[id]`) — dipisah ke sini biar nggak duplikat logic antar
// 2 halaman itu. Murni fungsi format/parsing, nggak ada fetch/state di sini.

export const BULAN_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function parseDeparture(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function formatTanggalPanjang(iso) {
  const d = parseDeparture(iso);
  if (!d) return '-';
  return `${String(d.getDate()).padStart(2, '0')} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthYearKey(iso) {
  const d = parseDeparture(iso);
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthYearLabel(key) {
  const [year, month] = key.split('-');
  return `${BULAN_ID[Number(month) - 1]} ${year}`;
}

export function formatRupiah(n) {
  if (!n || !isFinite(n)) return null;
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

export function hargaMulai(pkg) {
  const candidates = [pkg.priceQuad, pkg.priceTriple, pkg.priceDouble, pkg.priceMain]
    .map((v) => Number(v))
    .filter((v) => v > 0);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

export const WA_NUMBER = '628123456789'; // TODO: ganti ke nomor CS asli

export function waLinkUntukPaket(pkg) {
  const teks = `Assalamu'alaikum, saya tertarik dengan paket "${pkg.name || pkg.code}", boleh minta info detailnya?`;
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(teks)}`;
}
