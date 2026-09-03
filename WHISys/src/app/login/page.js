'use client';

import React, { useState } from 'react';
import { auth, db } from '../../lib/firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { Plane, Lock, Mail, AlertCircle } from 'lucide-react';
import { logActivity } from '../../lib/activityLog';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Catat ke Riwayat Aktivitas Sistem — best-effort, nggak boleh sampai
      // nge-block proses login kalau gagal (mis. dokumen user belum ada).
      try {
        const userDocSnap = await getDoc(doc(db, 'users', cred.user.uid));
        const userData = userDocSnap.exists() ? userDocSnap.data() : {};
        await logActivity({
          userId: cred.user.uid,
          userName: userData.fullName || cred.user.email,
          userRole: userData.role || 'Belum Diatur',
          action: 'login',
          module: 'Autentikasi',
          targetLabel: userData.fullName || cred.user.email,
          details: 'Berhasil masuk ke sistem.'
        });
      } catch (logErr) {
        console.error('Gagal mencatat log login:', logErr);
      }

      window.location.href = '/dashboard';
    } catch (err) {
      setError("Gagal masuk: Periksa kembali email dan password Anda.");
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center font-sans px-4 overflow-hidden">

      {/* Dekorasi blob warna-warni ala ilustrasi mobile app — tetap pakai
          palet WHISys (emerald sebagai warna utama, ditemenin biru/amber/
          rose yang udah dipakai buat badge role di seluruh sistem), cuma
          diburamkan (blur) & transparan biar nggak ganggu keterbacaan form.
          Murni kosmetik, nggak ngefek ke layout/logic form sama sekali. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-20 w-72 h-72 bg-emerald-500/25 rounded-full blur-3xl"></div>
        <div className="absolute top-1/3 -right-24 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-28 left-1/4 w-72 h-72 bg-amber-500/15 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 -right-10 w-56 h-56 bg-rose-500/15 rounded-full blur-3xl"></div>
      </div>

      <div className="relative bg-slate-900/90 backdrop-blur-sm border border-slate-800 p-8 rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden">

        {/* Aksen lingkaran kecil di pojok kartu — versi mini dari motif blob
            di background, biar kartunya sendiri kerasa "hidup" kayak referensi. */}
        <div className="pointer-events-none absolute -top-10 -right-10 w-28 h-28 bg-emerald-500/20 rounded-full blur-2xl"></div>
        <div className="pointer-events-none absolute -bottom-12 -left-12 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl"></div>

        <div className="relative text-center mb-8">
          <div className="relative w-14 h-14 bg-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-900/40">
            <Plane className="w-7 h-7 text-white" />
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-400 border-2 border-slate-900"></span>
            <span className="absolute -bottom-1 -left-2 w-3 h-3 rounded-full bg-rose-400 border-2 border-slate-900"></span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Selamat Datang</h1>
          <p className="text-xs text-slate-400 mt-2">Masuk ke WHISys ERP untuk lanjut kelola operasional Umrah, Haji & Wisata Halal.</p>
        </div>

        {error && (
          <div className="relative mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="relative space-y-4 text-xs">
          <div>
            <label className="block mb-1 font-medium text-slate-300">Email Administrator / Staf</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
              <input
                type="email" required
                placeholder="nama@wisatahalalindonesia.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-full pl-10 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                value={email} onChange={e => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block mb-1 font-medium text-slate-300">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
              <input
                type="password" required
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-full pl-10 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                value={password} onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit" disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-full font-semibold transition-all shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 mt-2"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              'Masuk ke Sistem ERP'
            )}
          </button>
        </form>

        <div className="relative mt-8 pt-4 border-t border-slate-800 text-center text-[11px] text-slate-500">
          PT Wisata Halal Indonesia • Secure Enterprise System
        </div>

      </div>
    </div>
  );
}
