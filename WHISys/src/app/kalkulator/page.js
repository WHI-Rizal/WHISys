'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calculator, Plus, Trash2, Printer, Copy, Check, Loader2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { formatTanggalPanjang } from '@/lib/publicCatalogFormat';
import { addPPN } from '@/lib/ppn';

// ============================================================================
// KALKULATOR HARGA PAKET (PUBLIK, TANPA LOGIN) — https://.../kalkulator
//
// Dipakai tim (termasuk di luar sales) pas pameran buat ngitung estimasi
// harga paket + biaya tambahan + diskon + PPN. Datanya dari endpoint publik
// yang sama dgn halaman /katalog (GET /api/public/catalog), jadi cuma
// nampilin harga jual & item "Harga Tidak Termasuk" — nggak ada data
// internal (HPP/margin).
//
// PPN: pakai addPPN() yang SAMA dgn form booking (src/lib/ppn.js), yaitu
// PPN 1,1% ditambahkan di atas (harga + tambahan - diskon). Jadi angka di
// kalkulator ini nyambung sama total yang nanti keluar di booking.
// ============================================================================

const rp = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const num = (v) => { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };

export default function KalkulatorHargaPage() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [pkgId, setPkgId] = useState('');
  const [pax, setPax] = useState({ main: '', triple: '', double: '', child: '' });
  const [exOn, setExOn] = useState({});
  const [exQty, setExQty] = useState({});
  const [exPrice, setExPrice] = useState({});
  const [custom, setCustom] = useState([]);
  const [discount, setDiscount] = useState('');
  const [discountNote, setDiscountNote] = useState('');
  const [withPpn, setWithPpn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [dp1, setDp1] = useState('');
  const [dp2Pct, setDp2Pct] = useState('30');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/public/catalog', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'gagal');
        if (!cancelled) setPackages(Array.isArray(data.packages) ? data.packages : []);
      } catch (e) {
        if (!cancelled) setErrorMsg('Gagal memuat data paket. Muat ulang halaman ini.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pkg = useMemo(() => packages.find((p) => p.id === pkgId) || null, [packages, pkgId]);

  // Reset input tiap ganti paket biar nggak kebawa dari hitungan sebelumnya.
  const pilihPaket = (id) => {
    setPkgId(id);
    setPax({ main: '', triple: '', double: '', child: '' });
    setExOn({});
    setExQty({});
    setExPrice({});
    setDp1('');
    setDp2Pct('30');
  };

  const rooms = useMemo(() => {
    if (!pkg) return [];
    const main = num(pkg.priceMain) || num(pkg.priceQuad);
    return [
      { key: 'main', label: 'Quad', price: main },
      { key: 'triple', label: 'Triple', price: num(pkg.priceTriple) },
      { key: 'double', label: 'Double', price: num(pkg.priceDouble) },
      { key: 'child', label: 'Anak', price: num(pkg.priceChild) },
    ].filter((r) => r.price > 0);
  }, [pkg]);

  // Item "Harga Tidak Termasuk" yang punya nominal (baris PPN & baris tanpa
  // angka cuma informasi, nggak dihitung di sini; PPN dihitung terpisah).
  const excludes = useMemo(() => {
    if (!pkg || !Array.isArray(pkg.priceExcludes)) return [];
    return pkg.priceExcludes
      .map((it, idx) => ({ ...(typeof it === 'string' ? { label: it } : it), idx }))
      .filter((it) => num(it.amount) > 0 && !/ppn/i.test(it.label || ''));
  }, [pkg]);

  const singleTier = rooms.length === 1;
  const totalPax = rooms.reduce((a, r) => a + num(pax[r.key]), 0);

  const roomLines = rooms
    .map((r) => ({ label: singleTier ? 'Paket' : `Paket ${r.label}`, qty: num(pax[r.key]), price: r.price }))
    .filter((l) => l.qty > 0)
    .map((l) => ({ ...l, total: l.qty * l.price }));

  const exLines = excludes
    .filter((it) => exOn[it.idx])
    .map((it) => {
      const qty = exQty[it.idx] !== undefined && exQty[it.idx] !== '' ? num(exQty[it.idx]) : totalPax;
      const price = exPrice[it.idx] !== undefined && exPrice[it.idx] !== '' ? num(exPrice[it.idx]) : num(it.amount);
      return { label: it.label, qty, price, total: qty * price };
    })
    .filter((l) => l.qty > 0);

  const customLines = custom
    .map((c) => ({ label: c.name || 'Biaya tambahan', qty: num(c.qty) || 1, price: num(c.amount), total: (num(c.qty) || 1) * num(c.amount) }))
    .filter((l) => l.price > 0);

  const subtotal = [...roomLines, ...exLines, ...customLines].reduce((a, l) => a + l.total, 0);
  const diskon = Math.min(num(discount), subtotal);
  const dpp = Math.max(0, subtotal - diskon);
  const { ppn, total: totalDenganPpn } = addPPN(dpp);
  const grandTotal = withPpn ? totalDenganPpn : dpp;
  const perPax = totalPax > 0 ? grandTotal / totalPax : 0;

  // Skema pembayaran: DP1 nominal custom, DP2 persen dari total invoice,
  // Pelunasan = sisanya.
  const dp1Val = Math.min(num(dp1), grandTotal);
  const dp2Rp = Math.min(Math.round(grandTotal * Math.min(num(dp2Pct), 100) / 100), Math.max(0, grandTotal - dp1Val));
  const pelunasan = Math.max(0, grandTotal - dp1Val - dp2Rp);
  const dp1Over = num(dp1) > grandTotal;

  // Penomoran section dinamis (section "Biaya Tambahan Paket" bisa nggak muncul)
  const nCustom = excludes.length > 0 ? 4 : 3;
  const nDisc = nCustom + 1;
  const nPay = nDisc + 1;

  const buildText = () => {
    const lines = [];
    lines.push('*ESTIMASI HARGA PAKET*');
    lines.push('Wisata Halal Internasional');
    lines.push('');
    lines.push(`Paket: ${pkg?.name || '-'}`);
    if (pkg?.departureDate) lines.push(`Keberangkatan: ${formatTanggalPanjang(pkg.departureDate)}`);
    lines.push('');
    [...roomLines, ...exLines, ...customLines].forEach((l) => {
      lines.push(`- ${l.label}: ${l.qty} x ${rp(l.price)} = ${rp(l.total)}`);
    });
    lines.push('');
    lines.push(`Subtotal: ${rp(subtotal)}`);
    if (diskon > 0) lines.push(`Diskon${discountNote ? ` (${discountNote})` : ''}: -${rp(diskon)}`);
    if (withPpn) lines.push(`PPN 1,1%: ${rp(ppn)}`);
    lines.push(`*TOTAL: ${rp(grandTotal)}*`);
    if (totalPax > 0) lines.push(`(${totalPax} pax, rata-rata ${rp(perPax)}/pax)`);
    if (dp1Val > 0 || dp2Rp > 0) {
      lines.push('');
      lines.push('*Skema Pembayaran*');
      if (dp1Val > 0) lines.push(`DP 1: ${rp(dp1Val)}`);
      if (dp2Rp > 0) lines.push(`DP 2 (${num(dp2Pct)}%): ${rp(dp2Rp)}`);
      lines.push(`Pelunasan: ${rp(pelunasan)}`);
    }
    lines.push('');
    lines.push('Estimasi harga, bisa berubah sewaktu-waktu. Harga final mengikuti saat booking.');
    return lines.join('\n');
  };

  const salin = async () => {
    try {
      await navigator.clipboard.writeText(buildText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      alert('Gagal menyalin. Salin manual dari tombol WhatsApp.');
    }
  };

  const kirimWA = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildText())}`, '_blank', 'noopener');
  };

  const addCustom = () => setCustom((c) => [...c, { id: Date.now() + Math.random(), name: '', amount: '', qty: '1' }]);
  const updCustom = (id, field, value) => setCustom((c) => c.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
  const delCustom = (id) => setCustom((c) => c.filter((x) => x.id !== id));

  const inputCls = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 print:hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5">
          <Link href="/katalog" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Katalog
          </Link>
          <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase mb-1">Wisata Halal Internasional</p>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Calculator className="w-6 h-6 text-emerald-700" /> Kalkulator Harga Paket
          </h1>
          <p className="text-sm text-slate-500 mt-1">Hitung estimasi harga paket, biaya tambahan, diskon, dan PPN.</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Memuat paket...</div>
        )}
        {errorMsg && (
          <div className="flex items-center gap-2 text-sm text-rose-600"><AlertTriangle className="w-4 h-4" /> {errorMsg}</div>
        )}

        {!loading && !errorMsg && (
          <>
            <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 print:hidden">
              <label className="block text-xs font-semibold text-slate-600 mb-1">1. Pilih Paket</label>
              <select value={pkgId} onChange={(e) => pilihPaket(e.target.value)} className={inputCls}>
                <option value="">-- Pilih paket --</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.departureDate ? ` (${formatTanggalPanjang(p.departureDate)})` : ''}
                  </option>
                ))}
              </select>
            </section>

            {pkg && (
              <>
                <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 print:hidden">
                  <h2 className="text-xs font-semibold text-slate-600 mb-3">2. Jumlah Peserta per Tipe Kamar</h2>
                  {rooms.length === 0 ? (
                    <p className="text-sm text-slate-500">Paket ini belum punya harga. Hubungi tim.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {rooms.map((r) => (
                        <div key={r.key}>
                          <label className="block text-xs text-slate-600 mb-1">
                            {singleTier ? 'Jumlah peserta' : r.label} <span className="text-slate-400">({rp(r.price)}/pax)</span>
                          </label>
                          <input
                            type="number" min="0" inputMode="numeric" placeholder="0"
                            className={inputCls}
                            value={pax[r.key]}
                            onChange={(e) => setPax({ ...pax, [r.key]: e.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {totalPax > 0 && <p className="text-xs text-slate-500 mt-3">Total peserta: <strong>{totalPax}</strong> pax</p>}
                </section>

                {excludes.length > 0 && (
                  <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 print:hidden">
                    <h2 className="text-xs font-semibold text-slate-600 mb-1">3. Biaya Tambahan Paket</h2>
                    <p className="text-[11px] text-slate-400 mb-3">Centang yang mau ditambahkan. Harga dan jumlahnya bisa diubah sesuai kebutuhan.</p>
                    <div className="space-y-3">
                      {excludes.map((it) => (
                        <div key={it.idx}>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox" className="w-4 h-4 accent-emerald-700"
                              checked={!!exOn[it.idx]}
                              onChange={(e) => setExOn({ ...exOn, [it.idx]: e.target.checked })}
                            />
                            <span className="text-sm text-slate-800">{it.label}</span>
                          </label>
                          {exOn[it.idx] && (
                            <div className="grid grid-cols-2 gap-3 mt-2 ml-7">
                              <div>
                                <label className="block text-[11px] text-slate-500 mb-1">Harga (Rp)</label>
                                <input
                                  type="number" min="0" inputMode="numeric"
                                  className={inputCls}
                                  value={exPrice[it.idx] !== undefined ? exPrice[it.idx] : num(it.amount)}
                                  onChange={(e) => setExPrice({ ...exPrice, [it.idx]: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className="block text-[11px] text-slate-500 mb-1">Jumlah</label>
                                <input
                                  type="number" min="0" inputMode="numeric"
                                  className={inputCls}
                                  value={exQty[it.idx] !== undefined ? exQty[it.idx] : totalPax}
                                  onChange={(e) => setExQty({ ...exQty, [it.idx]: e.target.value })}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 print:hidden">
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-xs font-semibold text-slate-600">{nCustom}. Tambahan Lain (Single Supplement, Extra Bed, dll)</h2>
                    <button type="button" onClick={addCustom} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
                      <Plus className="w-3.5 h-3.5" /> Tambah
                    </button>
                  </div>
                  {custom.length === 0 && <p className="text-[11px] text-slate-400">Belum ada. Klik Tambah kalau perlu.</p>}
                  <div className="space-y-2 mt-2">
                    {custom.map((c) => (
                      <div key={c.id} className="grid grid-cols-12 gap-2 items-center">
                        <input className={`${inputCls} col-span-5`} placeholder="Nama (cth: Single Supp)" value={c.name} onChange={(e) => updCustom(c.id, 'name', e.target.value)} />
                        <input type="number" min="0" inputMode="numeric" className={`${inputCls} col-span-4`} placeholder="Nominal" value={c.amount} onChange={(e) => updCustom(c.id, 'amount', e.target.value)} />
                        <input type="number" min="1" inputMode="numeric" className={`${inputCls} col-span-2`} placeholder="Qty" value={c.qty} onChange={(e) => updCustom(c.id, 'qty', e.target.value)} />
                        <button type="button" onClick={() => delCustom(c.id)} className="col-span-1 text-rose-500 hover:text-rose-700 flex justify-center">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 print:hidden">
                  <h2 className="text-xs font-semibold text-slate-600 mb-3">{nDisc}. Diskon & PPN</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Diskon (Rp, total)</label>
                      <input type="number" min="0" inputMode="numeric" placeholder="0" className={inputCls} value={discount} onChange={(e) => setDiscount(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">Keterangan diskon</label>
                      <input className={inputCls} placeholder="cth: Promo Pameran" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 mt-4 text-sm text-slate-700 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-emerald-700" checked={withPpn} onChange={(e) => setWithPpn(e.target.checked)} />
                    Tambahkan PPN 1,1% di total
                  </label>
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 print:hidden">
                  <h2 className="text-xs font-semibold text-slate-600 mb-1">{nPay}. Skema Pembayaran</h2>
                  <p className="text-[11px] text-slate-400 mb-3">DP 1 diisi nominal bebas, DP 2 dalam persen dari total invoice, pelunasan otomatis sisanya.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">DP 1 (Rp)</label>
                      <input type="number" min="0" inputMode="numeric" placeholder="0" className={inputCls} value={dp1} onChange={(e) => setDp1(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600 mb-1">DP 2 (% dari total invoice)</label>
                      <input type="number" min="0" max="100" inputMode="numeric" placeholder="30" className={inputCls} value={dp2Pct} onChange={(e) => setDp2Pct(e.target.value)} />
                    </div>
                  </div>
                  {dp1Over && <p className="text-[11px] text-rose-600 mt-2">DP 1 lebih besar dari total invoice, dibatasi sebesar total.</p>}
                </section>

                <section className="bg-white border-2 border-emerald-700 rounded-xl p-4 sm:p-5">
                  <p className="hidden print:block text-xs font-semibold tracking-wide text-emerald-700 uppercase">Wisata Halal Internasional</p>
                  <h2 className="text-base font-bold text-slate-900">Rincian Estimasi</h2>
                  <p className="text-xs text-slate-500 mb-3">
                    {pkg.name}{pkg.departureDate ? ` • ${formatTanggalPanjang(pkg.departureDate)}` : ''}
                  </p>

                  {subtotal === 0 ? (
                    <p className="text-sm text-slate-400">Isi jumlah peserta dulu.</p>
                  ) : (
                    <>
                      <div className="space-y-1.5 text-sm">
                        {[...roomLines, ...exLines, ...customLines].map((l, i) => (
                          <div key={i} className="flex justify-between gap-3">
                            <span className="text-slate-700">{l.label} <span className="text-slate-400">({l.qty} x {rp(l.price)})</span></span>
                            <span className="font-medium text-slate-900 whitespace-nowrap">{rp(l.total)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-slate-200 mt-3 pt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between"><span className="text-slate-600">Subtotal</span><span>{rp(subtotal)}</span></div>
                        {diskon > 0 && (
                          <div className="flex justify-between text-rose-600"><span>Diskon{discountNote ? ` (${discountNote})` : ''}</span><span>-{rp(diskon)}</span></div>
                        )}
                        {withPpn && (
                          <div className="flex justify-between"><span className="text-slate-600">PPN 1,1%</span><span>{rp(ppn)}</span></div>
                        )}
                        <div className="flex justify-between text-lg font-bold text-emerald-800 pt-1">
                          <span>TOTAL</span><span>{rp(grandTotal)}</span>
                        </div>
                        {totalPax > 0 && (
                          <p className="text-xs text-slate-500 text-right">{totalPax} pax, rata-rata {rp(perPax)}/pax</p>
                        )}
                      </div>
                      {grandTotal > 0 && (
                        <div className="border-t border-slate-200 mt-3 pt-3 space-y-1.5 text-sm">
                          <p className="text-xs font-semibold text-slate-600">Skema Pembayaran</p>
                          <div className="flex justify-between"><span className="text-slate-600">DP 1</span><span>{rp(dp1Val)}</span></div>
                          <div className="flex justify-between"><span className="text-slate-600">DP 2 ({num(dp2Pct)}%)</span><span>{rp(dp2Rp)}</span></div>
                          <div className="flex justify-between font-semibold text-slate-900"><span>Pelunasan</span><span>{rp(pelunasan)}</span></div>
                        </div>
                      )}
                      <p className="text-[10.5px] text-slate-400 mt-3">Estimasi harga, bisa berubah sewaktu-waktu. Harga final mengikuti saat booking.</p>
                    </>
                  )}
                </section>

                {subtotal > 0 && (
                  <div className="flex flex-col sm:flex-row gap-3 print:hidden">
                    <button type="button" onClick={kirimWA} className="flex-1 inline-flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-lg px-5 py-3 transition-colors">
                      Kirim via WhatsApp
                    </button>
                    <button type="button" onClick={salin} className="flex-1 inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-bold rounded-lg px-5 py-3 transition-colors">
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Tersalin' : 'Salin Teks'}
                    </button>
                    <button type="button" onClick={() => window.print()} className="flex-1 inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-bold rounded-lg px-5 py-3 transition-colors">
                      <Printer className="w-4 h-4" /> Cetak / PDF
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
