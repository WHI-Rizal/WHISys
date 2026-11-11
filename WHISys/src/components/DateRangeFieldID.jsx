'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, X } from 'lucide-react';
import DateFieldID, { formatDDMMYYYY } from './DateFieldID';

// ============================================================================
// DateRangeFieldID — satu field untuk rentang tanggal (Dari - Sampai).
// Tampilan field selalu dd/mm/yyyy - dd/mm/yyyy. Klik field buat buka panel
// kecil berisi dua tanggal + pilihan cepat (hari ini, 7 hari, bulan ini,
// bulan lalu). Nilai disimpan format ISO (yyyy-mm-dd), sama seperti
// DateFieldID.
//
// Props:
// - from, to: string ISO ('' kalau kosong)
// - onChange({ from, to })
// - className: gaya field (samakan dengan input lain di sebelahnya)
// - placeholder: teks saat belum ada rentang
// - isDark: tema panel
// ============================================================================

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function DateRangeFieldID({
  from = '',
  to = '',
  onChange,
  className = '',
  placeholder = 'Semua tanggal',
  isDark = false,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapperRef = useRef(null);
  const panelRef = useRef(null);

  const PANEL_W = 288;

  const updatePos = () => {
    const el = wrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - PANEL_W - margin));
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const openUp = spaceBelow < 330 && r.top > spaceBelow;
    setPos({
      left,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open]);

  useEffect(() => {
    const handle = (e) => {
      const inWrapper = wrapperRef.current && wrapperRef.current.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inWrapper && !inPanel) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const set = (next) => onChange({ from: next.from ?? from, to: next.to ?? to });

  const preset = (kind) => {
    const now = new Date();
    if (kind === 'today') {
      const k = toKey(now);
      onChange({ from: k, to: k });
    } else if (kind === '7d') {
      const start = new Date(now); start.setDate(start.getDate() - 6);
      onChange({ from: toKey(start), to: toKey(now) });
    } else if (kind === 'thisMonth') {
      onChange({ from: toKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: toKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)) });
    } else if (kind === 'lastMonth') {
      onChange({ from: toKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: toKey(new Date(now.getFullYear(), now.getMonth(), 0)) });
    }
  };

  const label = from || to
    ? `${from ? formatDDMMYYYY(from) : '...'} - ${to ? formatDDMMYYYY(to) : '...'}`
    : '';

  const fieldCls = `${isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300'} border rounded-lg px-3 py-2 text-xs w-full`;
  const chipCls = `px-2 py-1 rounded-md text-[10.5px] font-medium border ${isDark ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${label ? '' : 'opacity-50'}`}>{label || placeholder}</span>
        <Calendar className="w-4 h-4 opacity-50 shrink-0" />
      </button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: PANEL_W, zIndex: 9999 }}
          className={`rounded-lg border shadow-xl p-3 space-y-3 ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>Rentang tanggal</span>
            <button type="button" onClick={() => setOpen(false)} className="opacity-60 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={`block text-[10px] mb-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Dari</label>
              <DateFieldID value={from} max={to || undefined} onChange={(v) => set({ from: v })} className={fieldCls} />
            </div>
            <div>
              <label className={`block text-[10px] mb-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Sampai</label>
              <DateFieldID value={to} min={from || undefined} onChange={(v) => set({ to: v })} className={fieldCls} />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chipCls} onClick={() => preset('today')}>Hari ini</button>
            <button type="button" className={chipCls} onClick={() => preset('7d')}>7 hari terakhir</button>
            <button type="button" className={chipCls} onClick={() => preset('thisMonth')}>Bulan ini</button>
            <button type="button" className={chipCls} onClick={() => preset('lastMonth')}>Bulan lalu</button>
          </div>
          <div className="flex justify-between pt-1">
            <button type="button" className="text-[11px] font-semibold text-rose-500 hover:underline" onClick={() => onChange({ from: '', to: '' })}>
              Hapus tanggal
            </button>
            <button type="button" className="text-[11px] font-semibold text-blue-500 hover:underline" onClick={() => setOpen(false)}>
              Selesai
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
