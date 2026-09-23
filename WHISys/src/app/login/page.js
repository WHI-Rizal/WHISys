'use client';

import React, { useState } from 'react';
import { auth, db } from '../../lib/firebase';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { Lock, Mail, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import { logActivity } from '../../lib/activityLog';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ================ LUPA PASSWORD (SELF-SERVICE) ================
  // User yang lupa password tinggal masukin emailnya, Firebase yang kirim
  // link reset ke email itu — nggak perlu Super Admin turun tangan.
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState({ loading: false, error: '', sent: false });

  const handleOpenForgotModal = () => {
    setForgotEmail(email || '');
    setForgotStatus({ loading: false, error: '', sent: false });
    setShowForgotModal(true);
  };

  const handleSendResetEmail = async (e) => {
    e.preventDefault();
    if (forgotStatus.loading) return;
    if (!forgotEmail.trim()) {
      setForgotStatus({ loading: false, error: 'Isi email Anda terlebih dahulu.', sent: false });
      return;
    }
    setForgotStatus({ loading: true, error: '', sent: false });
    try {
      await sendPasswordResetEmail(auth, forgotEmail.trim());
      // Selalu tampilkan pesan sukses yang sama walau emailnya nggak
      // terdaftar — praktik standar biar orang luar nggak bisa "nebak-nebak"
      // email mana yang punya akun cuma dari respons form ini.
      setForgotStatus({ loading: false, error: '', sent: true });
    } catch (err) {
      if (err.code === 'auth/invalid-email') {
        setForgotStatus({ loading: false, error: 'Format email tidak valid.', sent: false });
      } else if (err.code === 'auth/too-many-requests') {
        setForgotStatus({ loading: false, error: 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.', sent: false });
      } else {
        // Kasus lain (termasuk email nggak terdaftar) tetap ditampilkan sebagai
        // "berhasil dikirim" demi alasan keamanan yang sama seperti di atas.
        setForgotStatus({ loading: false, error: '', sent: true });
      }
    }
  };
  // ================ /LUPA PASSWORD (SELF-SERVICE) ================

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

      <div className="relative bg-slate-900/90 backdrop-blur-sm border border-slate-800 rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden">

        {/* Header kartu diganti total (22 Sep 2026, permintaan user): dari
            badge logo + judul senter, jadi blob hijau abstrak (SVG, bukan
            kotak/garis lurus) niru referensi visual yang dikasih user, biar
            kesan lebih modern & minimalis. Logo WHI sengaja DIHAPUS dari
            sini (biar nggak berat/rame), badge-nya masih tetap dipakai di
            tempat lain (mis. Portal Jamaah) — cuma di kartu login staf ini
            aja yang diganti teks "Welcome Back!" polos. */}
        <div className="relative h-48">
          <svg viewBox="0 0 216 190" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
            <defs>
              <linearGradient id="loginBlobGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#065f46" />
              </linearGradient>
            </defs>
            {/* Aksen bulat oren, ngambang di belakang blob utama — oren
                #f97316 solid (nggak transparan) biar semenyala warna oren
                di motif sidebar dashboard */}
            <circle cx="24" cy="20" r="26" fill="#f97316" />
            {/* Aksen blob kedua, hijau lebih gelap, ngintip di kiri bawah */}
            <path d="M90,100 C68,86 34,94 20,118 C6,142 18,176 50,186 C78,195 106,178 110,152 C114,130 112,114 90,100 Z" fill="#064e3b" />
            {/* Blob utama, bentuknya organik nggak beraturan (bukan kotak/gelombang) */}
            <path d="M216,50 C214,14 176,-6 128,0 C92,4 92,-6 56,2 C24,9 6,26 6,58 C6,92 16,114 42,128 C70,144 98,128 124,146 C154,166 190,160 204,126 C214,102 216,82 216,50 Z" fill="url(#loginBlobGradient)" />
          </svg>
          <div className="relative z-10 h-full flex flex-col justify-center px-8">
            <h1 className="text-3xl font-extrabold text-white tracking-tight leading-tight">Welcome<br />Back!</h1>
            <p className="text-xs text-white/85 mt-2 max-w-[260px]">Masuk ke WHISys ERP untuk lanjut kelola operasional Umrah, Haji & Wisata Halal.</p>
          </div>
        </div>

        <div className="relative p-8 pt-6">
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
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-slate-300">Password</label>
                <button
                  type="button"
                  onClick={handleOpenForgotModal}
                  className="text-emerald-500 hover:text-emerald-400 font-medium"
                >
                  Lupa Password?
                </button>
              </div>
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

      {/* MODAL LUPA PASSWORD */}
      {showForgotModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="relative bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6">
            <button
              onClick={() => setShowForgotModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            {forgotStatus.sent ? (
              <div className="text-center py-4">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                <h3 className="text-base font-bold text-white mb-1">Email Terkirim</h3>
                <p className="text-xs text-slate-400">
                  Kalau email <strong className="text-slate-300">{forgotEmail}</strong> terdaftar di sistem, link buat bikin password baru udah dikirim ke email itu. Cek juga folder Spam/Promosi kalau belum masuk.
                </p>
                <button
                  onClick={() => setShowForgotModal(false)}
                  className="mt-5 w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-full text-xs font-semibold transition-all"
                >
                  Tutup
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-base font-bold text-white mb-1">Lupa Password</h3>
                <p className="text-xs text-slate-400 mb-4">
                  Masukkan email akun Anda, nanti kami kirimkan link buat bikin password baru.
                </p>

                {forgotStatus.error && (
                  <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-[11px] flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{forgotStatus.error}</span>
                  </div>
                )}

                <form onSubmit={handleSendResetEmail} className="space-y-3 text-xs">
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
                    <input
                      type="email" required
                      placeholder="nama@wisatahalalindonesia.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-full pl-10 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                      value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit" disabled={forgotStatus.loading}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white py-3 rounded-full font-semibold transition-all flex items-center justify-center gap-2"
                  >
                    {forgotStatus.loading ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      'Kirim Link Reset'
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
