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

      {/* Sketsa kota — ilustrasi ORIGINAL gaya garis tangan (bukan hasil jiplak
          dari gambar referensi berwatermark): gedung/hotel di kejauhan, pagar
          pembatas jalan layang, lalu jalan raya melengkung di depan dengan bus
          & mobil yang lewat, plus pesawat terbang ninggalin jejak putus-putus
          di langit. Semuanya garis tipis (sketch/outline), opacity rendah biar
          nggak ganggu keterbacaan kartu login — murni dekorasi, tanpa logic. */}
      <svg
        className="pointer-events-none absolute bottom-0 left-0 w-full h-56 sm:h-80 text-slate-500/40"
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMax slice"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* --- Skyline gedung/hotel di kejauhan --- */}
        <rect x="20" y="130" width="55" height="80" />
        <rect x="90" y="105" width="42" height="105" />
        <path d="M90 105 L111 78 L132 105 Z" />
        <rect x="150" y="145" width="38" height="65" />
        <rect x="205" y="90" width="48" height="120" />
        <circle cx="229" cy="76" r="12" />
        <line x1="229" y1="64" x2="229" y2="48" />
        <rect x="270" y="120" width="40" height="90" />
        <rect x="325" y="95" width="34" height="115" />
        <path d="M325 95 L342 66 L359 95 Z" />
        <rect x="700" y="60" width="50" height="150" />
        <path d="M700 60 L725 25 L750 60 Z" />
        <rect x="765" y="95" width="60" height="115" />
        <line x1="765" y1="125" x2="825" y2="125" />
        <line x1="765" y1="155" x2="825" y2="155" />
        <rect x="835" y="130" width="42" height="80" />
        <rect x="885" y="105" width="46" height="105" />
        <circle cx="908" cy="90" r="13" />
        <rect x="940" y="140" width="40" height="70" />

        {/* pohon-pohon kecil di sela gedung */}
        <path d="M355 210 q10 -30 22 0 q10 -22 20 0" />
        <path d="M655 210 q10 -28 20 0 q9 -20 18 0" />
        <path d="M760 210 q9 -22 17 0" />

        {/* --- Pagar pembatas jalan layang --- */}
        <line x1="0" y1="222" x2="1000" y2="212" />
        <line x1="20" y1="222" x2="20" y2="240" />
        <line x1="140" y1="222" x2="140" y2="240" />
        <line x1="260" y1="221" x2="260" y2="239" />
        <line x1="380" y1="220" x2="380" y2="238" />
        <line x1="500" y1="219" x2="500" y2="237" />
        <line x1="620" y1="217" x2="620" y2="235" />
        <line x1="740" y1="216" x2="740" y2="234" />
        <line x1="860" y1="214" x2="860" y2="232" />
        <line x1="980" y1="213" x2="980" y2="231" />

        {/* --- Jalan raya melengkung dengan marka putus-putus --- */}
        <path d="M0 500 C 220 320 520 240 1000 230" />
        <path d="M0 430 C 260 300 560 250 1000 275" strokeDasharray="14 12" />
        <path d="M0 500 C 300 380 640 330 1000 345" />

        {/* --- Bus --- */}
        <g transform="translate(430,300) rotate(-6)">
          <rect x="0" y="0" width="150" height="70" rx="10" />
          <line x1="0" y1="26" x2="150" y2="26" />
          <line x1="34" y1="26" x2="34" y2="70" />
          <line x1="68" y1="26" x2="68" y2="70" />
          <line x1="102" y1="26" x2="102" y2="70" />
          <circle cx="32" cy="72" r="12" />
          <circle cx="118" cy="72" r="12" />
        </g>

        {/* --- Mobil --- */}
        <g transform="translate(150,410) rotate(-4)">
          <path d="M0 34 Q6 6 40 4 L90 4 Q106 6 112 34 Z" />
          <line x1="0" y1="34" x2="112" y2="34" />
          <line x1="40" y1="4" x2="46" y2="26" />
          <line x1="46" y1="26" x2="80" y2="26" />
          <line x1="80" y1="26" x2="86" y2="4" />
          <circle cx="26" cy="38" r="10" />
          <circle cx="86" cy="38" r="10" />
        </g>
      </svg>

      {/* Jejak terbang pesawat — nyambungin ke ikon pesawat yang jadi logo WHISys. */}
      <svg
        className="pointer-events-none absolute top-16 left-[8%] w-44 h-20 text-slate-500/40"
        viewBox="0 0 180 80"
        fill="none"
      >
        <path d="M4 60 Q 70 15 150 22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 6" strokeLinecap="round" />
      </svg>
      <Plane className="pointer-events-none absolute top-10 left-[26%] w-7 h-7 text-emerald-500/50 rotate-[35deg]" />

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
