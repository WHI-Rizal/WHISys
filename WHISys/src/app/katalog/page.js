'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, MapPin, Calendar, FileText, Loader2, AlertTriangle } from 'lucide-react';
import {
  formatTanggalPanjang, monthYearKey, monthYearLabel, formatRupiah, hargaMulai,
} from '@/lib/publicCatalogFormat';

// ============================================================================
// KATALOG PRODUK PUBLIK — halaman ini SENGAJA ditaro langsung di dalam
// WHISys (bukan di website WordPress terpisah), diakses publik TANPA login,
// URL lengkapnya: https://sys.wisatahalalindonesia.com/katalog
//
// Datanya diambil dari endpoint yang sudah ada, GET /api/public/catalog
// (src/app/api/public/catalog/route.js), yang baca dari collection Firestore
// `public_catalog` — mirror publik dari `packages` yang cuma berisi field
// marketing-safe (lihat PUBLIC_CATALOG_FIELDS di PackagesModule.jsx). Cuma
// paket yang statusnya Aktif yang ada di situ, jadi halaman ini otomatis
// cuma nampilin paket Aktif tanpa perlu filter tambahan.
//
// Tombol "DETAIL PAKET" di tiap kartu mengarah ke /katalog/[id] (lihat
// src/app/katalog/[id]/page.js) — halaman detail ala cetakan itinerary,
// bukan lagi ke WhatsApp langsung.
// ============================================================================

export default function KatalogPublikPage() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [filterBulan, setFilterBulan] = useState('');
  const [filterTujuan, setFilterTujuan] = useState('');
  const [filterJenis, setFilterJenis] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg('');
      try {
        const res = await fetch('/api/public/catalog', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Gagal mengambil data katalog.');
        }
        if (!cancelled) {
          setPackages(Array.isArray(data.packages) ? data.packages : []);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg('Gagal memuat katalog paket. Silakan muat ulang halaman ini.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const opsiBulan = useMemo(() => {
    const map = new Map();
    packages.forEach((pkg) => {
      const key = monthYearKey(pkg.departureDate);
      if (key && !map.has(key)) map.set(key, monthYearLabel(key));
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [packages]);

  const opsiTujuan = useMemo(() => {
    const set = new Set();
    packages.forEach((pkg) => {
      if (pkg.destinationCity) set.add(pkg.destinationCity);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [packages]);

  const opsiJenis = useMemo(() => {
    const set = new Set();
    packages.forEach((pkg) => {
      if (pkg.type) set.add(pkg.type);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [packages]);

  const filteredPackages = useMemo(() => {
    return packages.filter((pkg) => {
      if (filterBulan && monthYearKey(pkg.departureDate) !== filterBulan) return false;
      if (filterTujuan && pkg.destinationCity !== filterTujuan) return false;
      if (filterJenis && pkg.type !== filterJenis) return false;
      return true;
    });
  }, [packages, filterBulan, filterTujuan, filterJenis]);

  const resetFilter = () => {
    setFilterBulan('');
    setFilterTujuan('');
    setFilterJenis('');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <p className="text-xs font-semibold tracking-wide text-emerald-700 uppercase mb-1">
            Wisata Halal Internasional
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Katalog Paket Keberangkatan</h1>
          <p className="text-sm text-slate-500 mt-1">
            Pilih paket Umroh, Haji, atau Wisata Halal Internasional yang sesuai jadwal dan tujuan Anda.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Filter bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Keberangkatan</label>
              <select
                value={filterBulan}
                onChange={(e) => setFilterBulan(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">- Semua Data -</option>
                {opsiBulan.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Jenis Tujuan</label>
              <select
                value={filterTujuan}
                onChange={(e) => setFilterTujuan(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">- Semua Data -</option>
                {opsiTujuan.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Jenis Paket</label>
              <select
                value={filterJenis}
                onChange={(e) => setFilterJenis(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">- Semua Data -</option>
                {opsiJenis.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={resetFilter}
                className="w-full inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
              >
                <Search className="w-4 h-4" />
                Reset Filter
              </button>
            </div>
          </div>
        </div>

        {/* Status */}
        {loading && (
          <div className="flex items-center justify-center gap-2 text-slate-500 py-16">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Memuat katalog paket...</span>
          </div>
        )}

        {!loading && errorMsg && (
          <div className="flex flex-col items-center justify-center gap-2 text-center py-16 text-slate-600">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm">{errorMsg}</p>
          </div>
        )}

        {!loading && !errorMsg && filteredPackages.length === 0 && (
          <div className="text-center py-16 text-slate-500 text-sm">
            {packages.length === 0
              ? 'Belum ada paket yang tersedia saat ini. Silakan cek kembali nanti.'
              : 'Tidak ada paket yang cocok dengan filter yang dipilih.'}
          </div>
        )}

        {!loading && !errorMsg && filteredPackages.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPackages.map((pkg) => {
              const harga = hargaMulai(pkg);
              return (
                <div
                  key={pkg.id}
                  className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="bg-slate-100 flex items-center justify-center">
                    {pkg.flyerImageDataUrl ? (
                      // Sengaja TANPA tinggi tetap + object-cover, biar gambar flyer
                      // (biasanya udah didesain penuh dengan judul/harga di dalamnya)
                      // nggak kepotong. Tingginya ngikutin rasio asli gambar
                      // (w-full + h-auto), jadi tinggi kartu antar paket bisa
                      // sedikit beda-beda tergantung rasio flyernya masing-masing.
                      <img
                        src={pkg.flyerImageDataUrl}
                        alt={pkg.name || 'Paket'}
                        className="w-full h-auto block"
                      />
                    ) : (
                      <span className="text-slate-400 text-xs h-44 flex items-center">Tidak ada gambar</span>
                    )}
                  </div>
                  <div className="p-4 flex flex-col gap-2 flex-1">
                    <h3 className="font-bold text-slate-900 text-sm leading-snug">
                      {pkg.name || pkg.code}
                    </h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatTanggalPanjang(pkg.departureDate)}
                      </span>
                      {pkg.destinationCity && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {pkg.destinationCity}
                        </span>
                      )}
                    </div>
                    <p className="text-xs italic text-slate-400 inline-flex items-start gap-1">
                      <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      {pkg.specialNote ? pkg.specialNote : 'Deskripsi paket belum tersedia'}
                    </p>
                    <div className="mt-1 border-t border-slate-100 pt-2 flex items-center justify-between text-xs">
                      {typeof pkg.quotaRemaining === 'number' && (
                        <span className="text-amber-600 font-medium">Sisa Seat: {pkg.quotaRemaining}</span>
                      )}
                    </div>
                    <div className="text-sm">
                      Harga mulai:{' '}
                      <strong className="text-emerald-700">
                        {harga ? formatRupiah(harga) : 'Hubungi kami'}
                      </strong>
                    </div>
                    <Link
                      href={`/katalog/${pkg.id}`}
                      className="mt-auto inline-flex items-center justify-center bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg px-4 py-2.5 transition-colors"
                    >
                      DETAIL PAKET
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-slate-400 py-8">
        &copy; {new Date().getFullYear()} PT. Wisata Halal Internasional
      </footer>
    </div>
  );
}
