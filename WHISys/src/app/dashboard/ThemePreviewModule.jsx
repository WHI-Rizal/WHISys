'use client';

import React, { useState } from 'react';
import { ShieldCheck, Users, Plane, AlertCircle, CheckCircle, Clock } from 'lucide-react';

export default function ThemePreviewModule() {
  const [selectedPalette, setSelectedPalette] = useState('emerald');

  return (
    <div className="space-y-6">
      {/* Selector Palette */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-white font-bold text-base">Pratinjau Kombinasi Warna (Theme Sandbox)</h3>
          <p className="text-xs text-slate-400">Pilih palet untuk melihat simulasi tampilan antarmuka WHISys ERP.</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setSelectedPalette('emerald')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              selectedPalette === 'emerald'
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            1. Emerald Executive
          </button>

          <button
            onClick={() => setSelectedPalette('gold')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              selectedPalette === 'gold'
                ? 'bg-amber-600 text-white border-amber-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            2. Royal Gold VIP
          </button>

          <button
            onClick={() => setSelectedPalette('indigo')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              selectedPalette === 'indigo'
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
          >
            3. Deep Tech Indigo
          </button>
        </div>
      </div>

      {/* HASIL SIMULASI TAMPILAN VISUAL */}
      {selectedPalette === 'emerald' && (
        <div className="bg-slate-950 p-6 rounded-2xl border border-slate-900 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              Palet 1: Modern Emerald Executive (Rekomendasi Utama)
            </span>
            <span className="text-[10px] bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded">
              Nuansa Islami & Finansial Stabil
            </span>
          </div>

          {/* Cards & Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400">Total Jamaah</p>
                <h4 className="text-xl font-bold text-white">128 Orang</h4>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400">Paket Keberangkatan</p>
                <h4 className="text-xl font-bold text-emerald-400">6 Group Active</h4>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
                <Plane className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400">Status Otorisasi</p>
                <h4 className="text-xl font-bold text-white">Admin Access</h4>
              </div>
              <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Table Preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-4">
              <h5 className="text-sm font-bold text-white">Contoh Tampilan Tabel Manifest</h5>
              <button className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium shadow-md shadow-emerald-950/50">
                + Tambah Data
              </button>
            </div>
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">Jamaah</th>
                  <th className="p-2.5">Paket</th>
                  <th className="p-2.5">Status Bayar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                <tr>
                  <td className="p-2.5 font-semibold text-white">Ahmad Zulkarnain</td>
                  <td className="p-2.5 text-slate-400">Umrah VIP Des 2026</td>
                  <td className="p-2.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full font-semibold text-[10px]">
                      <CheckCircle className="w-3 h-3" /> Lunas
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedPalette === 'gold' && (
        <div className="bg-[#090a0f] p-6 rounded-2xl border border-zinc-800 space-y-6">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Palet 2: Royal Gold & Obsidian (Mewah / VIP Focus)
            </span>
            <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-800 px-2 py-0.5 rounded">
              Eksklusif Haji Furoda & VIP Tour
            </span>
          </div>

          {/* Cards & Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#12141d] border border-zinc-800 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-zinc-400">Total Jamaah</p>
                <h4 className="text-xl font-bold text-white">128 Orang</h4>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#12141d] border border-zinc-800 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-zinc-400">Paket Keberangkatan</p>
                <h4 className="text-xl font-bold text-amber-400">6 Group Active</h4>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
                <Plane className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#12141d] border border-zinc-800 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-zinc-400">Status Otorisasi</p>
                <h4 className="text-xl font-bold text-white">Admin Access</h4>
              </div>
              <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Table Preview */}
          <div className="bg-[#12141d] border border-zinc-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-4">
              <h5 className="text-sm font-bold text-white">Contoh Tampilan Tabel Manifest</h5>
              <button className="bg-amber-600 hover:bg-amber-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium shadow-md shadow-amber-950/50">
                + Tambah Data
              </button>
            </div>
            <table className="w-full text-left text-xs text-zinc-300">
              <thead className="bg-zinc-800/50 text-zinc-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">Jamaah</th>
                  <th className="p-2.5">Paket</th>
                  <th className="p-2.5">Status Bayar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                <tr>
                  <td className="p-2.5 font-semibold text-white">Ahmad Zulkarnain</td>
                  <td className="p-2.5 text-zinc-400">Haji Furoda Khusus 2027</td>
                  <td className="p-2.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-semibold text-[10px]">
                      <Clock className="w-3 h-3" /> DP / Cicilan
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedPalette === 'indigo' && (
        <div className="bg-[#0f172a] p-6 rounded-2xl border border-slate-800 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
              Palet 3: Deep Tech Indigo (Modern & Clean ERP)
            </span>
            <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded">
              Nuansa Software SaaS Global
            </span>
          </div>

          {/* Cards & Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#1e293b] border border-slate-700/60 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400">Total Jamaah</p>
                <h4 className="text-xl font-bold text-white">128 Orang</h4>
              </div>
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#1e293b] border border-slate-700/60 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400">Paket Keberangkatan</p>
                <h4 className="text-xl font-bold text-teal-400">6 Group Active</h4>
              </div>
              <div className="p-3 bg-teal-500/10 text-teal-400 rounded-lg">
                <Plane className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-[#1e293b] border border-slate-700/60 p-4 rounded-xl flex justify-between items-center">
              <div>
                <p className="text-xs text-slate-400">Status Otorisasi</p>
                <h4 className="text-xl font-bold text-white">Admin Access</h4>
              </div>
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Table Preview */}
          <div className="bg-[#1e293b] border border-slate-700/60 rounded-xl p-4">
            <div className="flex justify-between items-center mb-4">
              <h5 className="text-sm font-bold text-white">Contoh Tampilan Tabel Manifest</h5>
              <button className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium shadow-md shadow-indigo-950/50">
                + Tambah Data
              </button>
            </div>
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-2.5">Jamaah</th>
                  <th className="p-2.5">Paket</th>
                  <th className="p-2.5">Status Bayar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                <tr>
                  <td className="p-2.5 font-semibold text-white">Ahmad Zulkarnain</td>
                  <td className="p-2.5 text-slate-400">Wisata Halal Turki 10D</td>
                  <td className="p-2.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded-full font-semibold text-[10px]">
                      <CheckCircle className="w-3 h-3" /> Lunas
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
