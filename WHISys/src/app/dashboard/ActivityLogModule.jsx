'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import {
  History,
  RefreshCw,
  Search,
  LogIn,
  LogOut,
  PlusCircle,
  Pencil,
  Trash2,
  Activity,
  Filter
} from 'lucide-react';

// Batas jumlah log yang diambil sekali fetch — biar nggak berat, tampilan
// paling "terbaru duluan" cukup untuk keperluan audit sehari-hari. Kalau
// nanti butuh lebih, tinggal naikkan angka ini atau tambah pagination.
const FETCH_LIMIT = 300;

const ACTION_META = {
  login: { label: 'Login', icon: LogIn, className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  logout: { label: 'Logout', icon: LogOut, className: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  create: { label: 'Tambah', icon: PlusCircle, className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  update: { label: 'Edit', icon: Pencil, className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  delete: { label: 'Hapus', icon: Trash2, className: 'bg-rose-500/10 text-rose-400 border-rose-500/20' },
  lainnya: { label: 'Lainnya', icon: Activity, className: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
};

function getActionMeta(action) {
  return ACTION_META[action] || ACTION_META.lainnya;
}

function formatTimestamp(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch {
    return iso;
  }
}

export default function ActivityLogModule({ theme = 'dark' }) {
  const isDark = theme === 'dark';

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
  };

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const q = query(collection(db, 'activity_logs'), orderBy('createdAt', 'desc'), limit(FETCH_LIMIT));
      const snap = await getDocs(q);
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Gagal memuat riwayat aktivitas:', err);
      setError('Gagal memuat riwayat aktivitas. Pastikan Firestore Rules untuk koleksi activity_logs sudah aktif.');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const moduleOptions = useMemo(() => {
    const set = new Set(logs.map(l => l.module).filter(Boolean));
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return logs.filter(log => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (moduleFilter !== 'all' && log.module !== moduleFilter) return false;
      if (!term) return true;
      const haystack = `${log.userName || ''} ${log.userRole || ''} ${log.module || ''} ${log.targetLabel || ''} ${log.details || ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [logs, searchTerm, actionFilter, moduleFilter]);

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <History className="w-5 h-5 text-emerald-400" /> Riwayat Aktivitas Sistem
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>
            Catatan aksi-aksi penting seluruh pengguna (login/logout, tambah/edit/hapus data inti). Khusus Super Admin.
          </p>
        </div>

        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-lg shadow-emerald-900/20"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Memuat...' : 'Refresh'}
        </button>
      </div>

      {/* FILTER BAR */}
      <div className={`${styles.cardBg} p-4 rounded-xl border grid grid-cols-1 md:grid-cols-3 gap-3`}>
        <div className="relative">
          <Search className={`w-4 h-4 absolute left-3 top-3 ${styles.textSub}`} />
          <input
            type="text"
            placeholder="Cari nama, modul, atau keterangan..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`w-full ${styles.inputBg} pl-9 pr-3 py-2.5 rounded-lg text-xs border focus:outline-none focus:border-emerald-500`}
          />
        </div>

        <div className="relative">
          <Filter className={`w-4 h-4 absolute left-3 top-3 ${styles.textSub}`} />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className={`w-full ${styles.inputBg} pl-9 pr-3 py-2.5 rounded-lg text-xs border focus:outline-none focus:border-emerald-500 appearance-none`}
          >
            <option value="all">Semua Jenis Aksi</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
            <option value="create">Tambah</option>
            <option value="update">Edit</option>
            <option value="delete">Hapus</option>
            <option value="lainnya">Lainnya</option>
          </select>
        </div>

        <div className="relative">
          <History className={`w-4 h-4 absolute left-3 top-3 ${styles.textSub}`} />
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className={`w-full ${styles.inputBg} pl-9 pr-3 py-2.5 rounded-lg text-xs border focus:outline-none focus:border-emerald-500 appearance-none`}
          >
            <option value="all">Semua Modul</option>
            {moduleOptions.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* CONTENT */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className={`${styles.cardBg} p-10 rounded-xl border text-center text-xs ${styles.textSub}`}>
          Memuat riwayat aktivitas...
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className={`${styles.cardBg} p-10 rounded-xl border text-center text-xs ${styles.textSub}`}>
          Belum ada riwayat aktivitas yang cocok dengan filter saat ini.
        </div>
      ) : (
        <div className={`${styles.cardBg} rounded-xl border overflow-hidden`}>
          {/* DESKTOP TABLE */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} text-left`}>
                  <th className={`p-3 font-semibold ${styles.textSub}`}>Waktu</th>
                  <th className={`p-3 font-semibold ${styles.textSub}`}>Pengguna</th>
                  <th className={`p-3 font-semibold ${styles.textSub}`}>Aksi</th>
                  <th className={`p-3 font-semibold ${styles.textSub}`}>Modul</th>
                  <th className={`p-3 font-semibold ${styles.textSub}`}>Target</th>
                  <th className={`p-3 font-semibold ${styles.textSub}`}>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map(log => {
                  const meta = getActionMeta(log.action);
                  const Icon = meta.icon;
                  return (
                    <tr key={log.id} className={`border-b ${isDark ? 'border-slate-800/60' : 'border-slate-100'}`}>
                      <td className={`p-3 whitespace-nowrap ${styles.textSub}`}>{formatTimestamp(log.createdAt)}</td>
                      <td className="p-3">
                        <div className={`font-semibold ${styles.textTitle}`}>{log.userName || 'Tidak diketahui'}</div>
                        <div className={styles.textSub}>{log.userRole || '-'}</div>
                      </td>
                      <td className="p-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold border ${meta.className}`}>
                          <Icon className="w-3.5 h-3.5" /> {meta.label}
                        </span>
                      </td>
                      <td className={`p-3 ${styles.textTitle}`}>{log.module || '-'}</td>
                      <td className={`p-3 ${styles.textTitle}`}>{log.targetLabel || '-'}</td>
                      <td className={`p-3 ${styles.textSub} max-w-xs`}>{log.details || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* MOBILE CARDS */}
          <div className="md:hidden space-y-3 p-3">
            {filteredLogs.map(log => {
              const meta = getActionMeta(log.action);
              const Icon = meta.icon;
              return (
                <div key={log.id} className={`p-4 rounded-xl border ${styles.innerBg} space-y-2`}>
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${meta.className}`}>
                      <Icon className="w-3.5 h-3.5" /> {meta.label}
                    </span>
                    <span className={`text-[11px] ${styles.textSub}`}>{formatTimestamp(log.createdAt)}</span>
                  </div>
                  <div>
                    <div className={`text-xs font-semibold ${styles.textTitle}`}>{log.userName || 'Tidak diketahui'}</div>
                    <div className={`text-[11px] ${styles.textSub}`}>{log.userRole || '-'}</div>
                  </div>
                  <div className="text-[11px] space-y-1 pt-1 border-t border-dashed border-slate-700/40">
                    <div className="flex justify-between gap-2">
                      <span className={styles.textSub}>Modul</span>
                      <span className={`${styles.textTitle} font-medium text-right`}>{log.module || '-'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className={styles.textSub}>Target</span>
                      <span className={`${styles.textTitle} font-medium text-right`}>{log.targetLabel || '-'}</span>
                    </div>
                    {log.details && (
                      <div className="pt-1">
                        <span className={styles.textSub}>Keterangan:</span>
                        <p className={`${styles.textTitle} mt-0.5`}>{log.details}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className={`text-[11px] ${styles.textSub} text-center`}>
        Menampilkan {filteredLogs.length} dari {logs.length} log terbaru (maks. {FETCH_LIMIT} data).
      </p>
    </div>
  );
}
