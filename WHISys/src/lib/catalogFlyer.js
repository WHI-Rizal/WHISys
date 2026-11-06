// Helper flyer katalog publik.
//
// Dulu flyer (gambar base64 sampai ~500KB per paket) ikut terkirim di dalam
// JSON /api/public/catalog dan /api/public/waiting-screen. Sekali panggil bisa
// ~11MB, dan itu yang menghabiskan kuota Fast Origin Transfer Vercel (Nov 2026).
// Sekarang JSON cuma bawa `flyerUrl` (alamat gambar), dan gambarnya sendiri
// disajikan terpisah oleh /api/public/catalog/flyer/[id] dengan cache panjang.
export const flyerUrlOf = (p, base = '') => {
  if (!p || !p.id || !p.flyerImageDataUrl) return '';
  const v = String(p.updatedAt || p.flyerImageDataUrl.length).replace(/[^0-9A-Za-z]/g, '');
  return `${base}/api/public/catalog/flyer/${encodeURIComponent(p.id)}?v=${v}`;
};

// Salinan paket TANPA data base64, diganti flyerUrl.
export const stripFlyer = (p, base = '') => {
  const { flyerImageDataUrl, ...rest } = p || {};
  return { ...rest, flyerUrl: flyerUrlOf(p, base) };
};
