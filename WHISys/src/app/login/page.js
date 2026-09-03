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

      {/* Sketsa kota — ilustrasi ORIGINAL gaya flat-design (dibuat dari nol,
          BUKAN hasil jiplak dari gambar referensi), tapi pakai konsep yang
          sama: gedung-gedung berwarna solid dengan jendela lengkung/kotak,
          pepohonan, awan, dan aksen titik-titik di langit. Palet warnanya
          full pakai warna WHISys (emerald/biru/amber/rose) biar tetap satu
          identitas sama seluruh sistem. Balonnya sengaja diganti pesawat
          (bukan balon udara) biar nyambung sama logo & branding WHISys.
          Murni dekorasi (pointer-events-none), nggak ada logic di sini. */}
      <svg
        className="pointer-events-none absolute bottom-0 left-0 w-full h-64 sm:h-96 opacity-90"
        viewBox="0 0 1000 420"
        preserveAspectRatio="xMidYMax slice"
      >
        {/* --- Awan & aksen titik/garis di langit --- */}
        <path d="M60 60 q14 -22 30 -8 q10 -16 26 -2 q16 -6 18 12 q4 14 -12 16 l-52 0 q-16 -2 -10 -18 Z" fill="#e2e8f0" opacity="0.5" />
        <path d="M560 40 q12 -18 26 -7 q9 -13 22 -2 q13 -5 15 10 q3 12 -10 13 l-44 0 q-14 -2 -9 -14 Z" fill="#e2e8f0" opacity="0.4" />
        <line x1="20" y1="20" x2="90" y2="20" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
        <line x1="360" y1="35" x2="420" y2="35" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
        <circle cx="120" cy="90" r="4" fill="#fbbf24" opacity="0.6" />
        <circle cx="470" cy="55" r="3" fill="#f8fafc" opacity="0.5" />
        <circle cx="900" cy="70" r="4" fill="#fbbf24" opacity="0.5" />

        {/* --- Siluet skyline tipis di kejauhan (kedalaman), warna gelap --- */}
        <path d="M0 210 L20 210 L20 165 L40 165 L40 145 L60 145 L60 210 L140 210 L140 175 L160 140 L180 175 L180 210 L260 210 L260 190 L280 190 L280 155 L300 155 L300 210 L1000 210 L1000 420 L0 420 Z" fill="#0f172a" opacity="0.55" />
        <path d="M620 210 L640 175 L660 210 L740 210 L740 150 L760 150 L760 120 L800 120 L800 150 L820 150 L820 210 L900 210 L900 180 L920 180 L920 210 L1000 210 L1000 260 L620 260 Z" fill="#0f172a" opacity="0.55" />

        {/* --- Gedung 1: menara bergaris (kiri) --- */}
        <rect x="25" y="150" width="150" height="230" fill="#cbd5e1" />
        <rect x="25" y="150" width="14" height="230" fill="#64748b" />
        <rect x="55" y="150" width="10" height="230" fill="#64748b" />
        <rect x="150" y="150" width="10" height="230" fill="#5eead4" opacity="0.5" />
        <rect x="80" y="168" width="24" height="24" fill="#f8fafc" />
        <rect x="112" y="168" width="24" height="24" fill="#f8fafc" />
        <rect x="80" y="202" width="24" height="24" fill="#f8fafc" />
        <rect x="112" y="202" width="24" height="24" fill="#a7f3d0" />
        <rect x="80" y="236" width="24" height="24" fill="#f8fafc" />
        <rect x="112" y="236" width="24" height="24" fill="#f8fafc" />
        <rect x="80" y="270" width="24" height="24" fill="#a7f3d0" />
        <rect x="112" y="270" width="24" height="24" fill="#f8fafc" />
        <rect x="80" y="304" width="24" height="24" fill="#f8fafc" />
        <rect x="112" y="304" width="24" height="24" fill="#f8fafc" />

        {/* --- Gedung 2: gedung amber dengan jendela lengkung + aksen atap biru --- */}
        <rect x="205" y="230" width="110" height="150" fill="#94a3b8" />
        <path d="M225 260 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M255 260 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M285 260 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M225 305 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M255 305 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M285 305 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M225 350 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M255 350 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <path d="M285 350 q10 -16 20 0 v24 h-20 Z" fill="#f8fafc" />
        <rect x="205" y="190" width="110" height="40" fill="#fcd34d" />
        <rect x="205" y="150" width="110" height="40" fill="#1d4ed8" />

        {/* --- Gedung 3: emerald pendek --- */}
        <rect x="330" y="270" width="80" height="110" fill="#10b981" />
        <rect x="345" y="288" width="18" height="18" fill="#f0fdf4" />
        <rect x="375" y="288" width="18" height="18" fill="#f0fdf4" />
        <rect x="345" y="316" width="18" height="18" fill="#f0fdf4" />
        <rect x="375" y="316" width="18" height="18" fill="#f0fdf4" />
        <rect x="345" y="344" width="18" height="18" fill="#f0fdf4" />
        <rect x="375" y="344" width="18" height="18" fill="#f0fdf4" />

        {/* --- Gedung 4: tinggi biru (tengah-kanan) --- */}
        <rect x="640" y="120" width="140" height="260" fill="#3b82f6" />
        <rect x="660" y="140" width="22" height="22" fill="#eff6ff" />
        <rect x="694" y="140" width="22" height="22" fill="#eff6ff" />
        <rect x="728" y="140" width="22" height="22" fill="#eff6ff" />
        <rect x="660" y="176" width="22" height="22" fill="#eff6ff" />
        <rect x="694" y="176" width="22" height="22" fill="#bfdbfe" />
        <rect x="728" y="176" width="22" height="22" fill="#eff6ff" />
        <rect x="660" y="212" width="22" height="22" fill="#eff6ff" />
        <rect x="694" y="212" width="22" height="22" fill="#eff6ff" />
        <rect x="728" y="212" width="22" height="22" fill="#eff6ff" />
        <rect x="660" y="248" width="22" height="22" fill="#bfdbfe" />
        <rect x="694" y="248" width="22" height="22" fill="#eff6ff" />
        <rect x="728" y="248" width="22" height="22" fill="#eff6ff" />
        <rect x="660" y="284" width="22" height="22" fill="#eff6ff" />
        <rect x="694" y="284" width="22" height="22" fill="#eff6ff" />
        <rect x="728" y="284" width="22" height="22" fill="#eff6ff" />

        {/* --- Gedung 5: kanan, light tower --- */}
        <rect x="800" y="210" width="90" height="170" fill="#a7f3d0" />
        <rect x="815" y="228" width="18" height="18" fill="#0f766e" />
        <rect x="843" y="228" width="18" height="18" fill="#0f766e" />
        <rect x="871" y="228" width="18" height="18" fill="#0f766e" />
        <rect x="815" y="256" width="18" height="18" fill="#0f766e" />
        <rect x="843" y="256" width="18" height="18" fill="#0f766e" />
        <rect x="871" y="256" width="18" height="18" fill="#0f766e" />
        <rect x="815" y="284" width="18" height="18" fill="#0f766e" />
        <rect x="843" y="284" width="18" height="18" fill="#0f766e" />
        <rect x="871" y="284" width="18" height="18" fill="#0f766e" />

        {/* --- Dasar / jalur hijau + pepohonan --- */}
        <rect x="0" y="380" width="1000" height="40" fill="#0369a1" opacity="0.55" />
        <g>
          <line x1="90" y1="380" x2="90" y2="410" stroke="#334155" strokeWidth="4" />
          <ellipse cx="90" cy="365" rx="26" ry="34" fill="#34d399" />
        </g>
        <g>
          <line x1="200" y1="380" x2="200" y2="412" stroke="#334155" strokeWidth="4" />
          <ellipse cx="200" cy="363" rx="24" ry="32" fill="#1d4ed8" />
        </g>
        <g>
          <line x1="500" y1="380" x2="500" y2="410" stroke="#334155" strokeWidth="4" />
          <ellipse cx="500" cy="365" rx="26" ry="34" fill="#fb7185" />
        </g>
        <g>
          <line x1="600" y1="380" x2="600" y2="412" stroke="#334155" strokeWidth="4" />
          <ellipse cx="600" cy="363" rx="24" ry="32" fill="#34d399" />
        </g>
        <g>
          <line x1="940" y1="380" x2="940" y2="410" stroke="#334155" strokeWidth="4" />
          <ellipse cx="940" cy="365" rx="26" ry="34" fill="#1d4ed8" />
        </g>
      </svg>

      {/* Jejak terbang pesawat — pakai ikon pesawat yang sama jadi logo WHISys
          (pengganti balon udara di referensi, biar tetap konsisten branding). */}
      <svg
        className="pointer-events-none absolute top-14 left-[6%] w-48 h-24 text-slate-400/50"
        viewBox="0 0 200 90"
        fill="none"
      >
        <path d="M4 70 Q 80 12 170 24" stroke="currentColor" strokeWidth="2" strokeDasharray="3 7" strokeLinecap="round" />
      </svg>
      <Plane className="pointer-events-none absolute top-8 left-[27%] w-9 h-9 text-emerald-400/80 rotate-[35deg]" />

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
