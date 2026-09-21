'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

// ============================================================================
// SearchableSelect — dropdown dengan kotak cari, pengganti <select> polos
// buat daftar panjang (misal daftar Paket Keberangkatan yang bisa puluhan
// item). Native <select> browser cuma dukung "type-ahead" per huruf awal,
// nggak bisa nyari potongan kata di tengah nama paket (misal ngetik
// "thailand" buat nemuin "SHOPPING ESCAPE THAILAND HALAF TRIP") — makanya
// dibikin komponen sendiri.
//
// Dipakai pertama kali di FinanceModule.jsx (dropdown "Paket Keberangkatan
// Terkait" di modal Catat Pembayaran Vendor & Tagihan Vendor) — feedback
// dari staf: daftar paketnya udah puluhan dan susah dicari manual sambil
// scroll. Ditulis generik (bukan spesifik "paket") biar gampang dipakai
// ulang di dropdown panjang lain kalau nanti ada kebutuhan sama.
//
// Props:
// - options: array of { value, label, sublabel? } — sublabel opsional buat
//   info tambahan yang ikut dicari (misal kode paket) tapi ditampilin lebih
//   kecil/redup di bawah label utama.
// - value: value yang lagi kepilih (string, cocokin ke options[].value).
// - onChange(value): dipanggil pas user milih salah satu opsi.
// - placeholder: teks pas belum ada yang kepilih.
// - emptyOptionLabel: kalau diisi, muncul sebagai opsi paling atas buat
//   "kosongkan pilihan" (dikirim onChange('')) — dipakai buat field yang
//   opsional (misal "Nggak Terkait Paket Tertentu").
// - pinnedOptions: array { value, label } opsional — opsi "spesial" yang
//   SELALU muncul di atas daftar, TIDAK ikut kefilter walau lagi ngetik
//   pencarian (misal "➕ Tambah Jamaah Baru (Belum Terdaftar)" atau
//   "🔁 Sama dengan Pemesan" — harus tetap kepilih walau user lagi ngetik
//   nama buat nyari jamaah existing).
// - isDark, inputClassName: buat nyesuain warna/gaya ke tema dashboard yang
//   lagi aktif (dark/light) — hasilnya berat sebelah kalau ini nggak
//   dioper dari komponen pemanggil.
// - disabled: nonaktifin interaksi.
// ============================================================================

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = '-- Pilih --',
  emptyOptionLabel,
  pinnedOptions,
  isDark = false,
  inputClassName = '',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(
    () =>
      options.find((o) => o.value === value) ||
      (pinnedOptions || []).find((o) => o.value === value) ||
      null,
    [options, pinnedOptions, value]
  );

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const haystack = `${o.label} ${o.sublabel || ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  const baseInputClass = inputClassName || (
    isDark
      ? 'bg-slate-950 text-slate-200 border-slate-800'
      : 'bg-white text-slate-800 border-slate-300'
  );

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className={`w-full flex items-center justify-between gap-2 rounded-lg p-2.5 border text-left disabled:opacity-50 ${baseInputClass}`}
      >
        <span className={`truncate ${selected ? '' : 'opacity-50'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !disabled && (
        <div
          className={`absolute z-30 mt-1 w-full rounded-lg border shadow-lg overflow-hidden ${
            isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
          }`}
        >
          <div className={`flex items-center gap-2 px-2.5 py-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <Search className={`w-3.5 h-3.5 shrink-0 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ketik buat cari..."
              className={`w-full bg-transparent outline-none text-xs ${isDark ? 'text-slate-200 placeholder-slate-600' : 'text-slate-800 placeholder-slate-400'}`}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="shrink-0">
                <X className={`w-3.5 h-3.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto">
            {(pinnedOptions || []).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs font-medium border-b ${
                  isDark ? 'border-slate-800' : 'border-slate-100'
                } ${
                  o.value === value
                    ? isDark ? 'bg-emerald-900/40 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                    : isDark ? 'text-emerald-400 hover:bg-slate-800' : 'text-emerald-700 hover:bg-slate-50'
                }`}
              >
                {o.label}
              </button>
            ))}
            {emptyOptionLabel && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs italic ${
                  isDark ? 'text-slate-500 hover:bg-slate-800' : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                {emptyOptionLabel}
              </button>
            )}
            {filtered.length === 0 && (
              <p className={`px-3 py-3 text-xs text-center ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                Nggak ada yang cocok.
              </p>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  o.value === value
                    ? isDark ? 'bg-emerald-900/40 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                    : isDark ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {/* Label opsi SENGAJA nggak di-truncate/dipotong 1 baris (beda
                    dari tombol trigger di atas) — daftar paket keberangkatan
                    nama+tanggalnya bisa panjang, kalau dipotong di HP jadi
                    keliatan sama antar paket beda tanggal dan staf salah
                    pilih. Dibiarin wrap ke beberapa baris biar nama LENGKAP
                    (termasuk tanggal keberangkatannya) selalu kebaca utuh. */}
                <div className="whitespace-normal break-words leading-snug">{o.label}</div>
                {o.sublabel && (
                  <div className={`text-[10px] whitespace-normal break-words mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {o.sublabel}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
