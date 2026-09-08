'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import {
  collection, query, where, getDocs, limit, doc, getDoc, setDoc, runTransaction
} from 'firebase/firestore';
import {
  LogIn, LogOut, Loader2, AlertTriangle, Plane, Wallet, FileCheck, CheckCircle2,
  XCircle, Ban, RotateCcw, Clock, ShieldCheck
} from 'lucide-react';
import DateFieldID from '@/components/DateFieldID';

// ============================================================================
// PORTAL CUSTOMER — MVP Tahap 1 (view-only)
//
// Login pakai Kode Jamaah (customerCode) + Tanggal Lahir, TANPA password,
// TANPA akun staf. Sengaja dibikin nggak percaya apapun dari input customer
// begitu aja — data ditampilin cuma kalau kombinasi kode + tanggal lahirnya
// beneran cocok sama data di Firestore (mirip pola verifikasi di halaman
// feedback publik /feedback/[bookingCode] yang udah jalan).
//
// Rate-limit percobaan login (biar nggak gampang di-brute-force, soalnya
// Kode Jamaah formatnya berurutan/gampang ditebak) disimpan di collection
// terpisah 'portalLoginAttempts', dikunci per Kode Jamaah — BUKAN nyimpen
// data sensitif apapun, cuma counter + waktu kunci.
//
// CATATAN buat yang pegang Firebase Console: halaman ini butuh Firestore
// Security Rules tambahan (baca collection 'jamaah' & 'bookings' publik,
// baca-tulis 'portalLoginAttempts' publik) — lihat pesan penjelasan yang
// dikirim bareng file ini.
// ============================================================================

const ATTEMPT_LIMIT = 5;
const LOCK_MINUTES = 15;
const SESSION_KEY = 'whi_portal_session';

const DOC_LABELS = {
  passport: 'Paspor',
  ktp_foto: 'Foto KTP',
  family_cert: 'Kartu Keluarga',
  sponsor_letter: 'Surat Sponsor',
  bank_statement: 'Rekening Koran',
  vaccine_cert: 'Sertifikat Vaksin',
  visa: 'Visa',
  ticket: 'Tiket',
};

const formatRupiah = (n) => `Rp ${Math.round(Number(n) || 0).toLocaleString('id-ID')}`;
const formatTanggal = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
};

const checkPortalLoginAllowed = async (code) => {
  const snap = await getDoc(doc(db, 'portalLoginAttempts', code));
  if (snap.exists()) {
    const data = snap.data();
    if (data.lockedUntil && new Date(data.lockedUntil).getTime() > Date.now()) {
      const remainingMin = Math.max(1, Math.ceil((new Date(data.lockedUntil).getTime() - Date.now()) / 60000));
      throw new Error(`Terlalu banyak percobaan gagal buat kode ini. Coba lagi dalam ${remainingMin} menit, atau hubungi kami kalau butuh bantuan.`);
    }
  }
};

// Transaction biar aman dari race condition kalau ada 2 percobaan gagal
// hampir bersamaan dari kode jamaah yang sama.
const recordPortalLoginFailure = async (code) => {
  const ref = doc(db, 'portalLoginAttempts', code);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    const prevCount = snap.exists() ? (Number(snap.data().count) || 0) : 0;
    const count = prevCount + 1;
    const payload = { count, updatedAt: new Date().toISOString() };
    if (count >= ATTEMPT_LIMIT) {
      payload.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
      payload.count = 0; // reset — jendela kunci di atas yang jadi penghalangnya
    }
    transaction.set(ref, payload, { merge: true });
  });
};

const resetPortalLoginAttempts = async (code) => {
  try {
    await setDoc(doc(db, 'portalLoginAttempts', code), { count: 0, updatedAt: new Date().toISOString() }, { merge: true });
  } catch {
    // Gagal reset counter bukan hal fatal — nggak perlu ganggu customer yang udah berhasil login.
  }
};

const statusBadge = (status) => {
  const s = status || 'active';
  if (s === 'cancelled') return { label: 'Dibatalkan', className: 'bg-rose-500/15 text-rose-400', Icon: Ban };
  if (s === 'rescheduled') return { label: 'Dipindah Jadwal', className: 'bg-amber-500/15 text-amber-400', Icon: RotateCcw };
  return { label: 'Aktif', className: 'bg-emerald-500/15 text-emerald-400', Icon: CheckCircle2 };
};

export default function PortalPage() {
  const [session, setSession] = useState(null);
  const [restoringSession, setRestoringSession] = useState(true);

  const [loginForm, setLoginForm] = useState({ customerCode: '', birthDate: '' });
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // Pulihkan sesi dari sessionStorage (hilang otomatis kalau tab ditutup) —
  // biar customer nggak perlu login ulang tiap kali refresh halaman.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch {
      // ignore
    }
    setRestoringSession(false);
  }, []);

  useEffect(() => {
    if (!session?.id) return;
    const fetchBookings = async () => {
      setLoadingBookings(true);
      try {
        const q = query(collection(db, 'bookings'), where('jamaahId', '==', session.id));
        const snap = await getDocs(q);
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        setBookings(list);
      } catch (err) {
        console.error('Gagal ambil data booking portal:', err);
      }
      setLoadingBookings(false);
    };
    fetchBookings();
  }, [session?.id]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const code = loginForm.customerCode.trim().toUpperCase();
    if (!code || !loginForm.birthDate) {
      setLoginError('Isi Kode Jamaah dan Tanggal Lahir dulu ya.');
      return;
    }

    setLoggingIn(true);
    try {
      await checkPortalLoginAllowed(code);

      const q = query(collection(db, 'jamaah'), where('customerCode', '==', code), limit(1));
      const snap = await getDocs(q);

      let matched = null;
      if (!snap.empty) {
        const docSnap = snap.docs[0];
        const data = docSnap.data();
        if (data.birthDate && data.birthDate === loginForm.birthDate) {
          matched = { id: docSnap.id, customerCode: data.customerCode, fullName: data.fullName || '' };
        }
      }

      if (!matched) {
        await recordPortalLoginFailure(code);
        // Pesan sengaja nggak nyebut "kode salah" atau "tanggal salah" secara
        // spesifik — biar orang luar nggak bisa nebak-nebak kode jamaah mana
        // yang valid cuma dari respons error-nya.
        setLoginError('Kode Jamaah atau Tanggal Lahir belum cocok. Coba cek lagi, atau hubungi tim kami kalau butuh bantuan.');
        setLoggingIn(false);
        return;
      }

      await resetPortalLoginAttempts(code);
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(matched));
      } catch {
        // ignore — kalau browser blokir sessionStorage, login tetap jalan buat sesi ini
      }
      setSession(matched);
    } catch (err) {
      setLoginError(err.message || 'Gagal memproses login, coba lagi sebentar lagi.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setSession(null);
    setBookings([]);
    setLoginForm({ customerCode: '', birthDate: '' });
  };

  if (restoringSession) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
      </div>
    );
  }

  // ================= HALAMAN LOGIN =================
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-emerald-600/15 flex items-center justify-center mx-auto mb-3">
              <Plane className="w-7 h-7 text-emerald-500" />
            </div>
            <h1 className="text-xl font-bold text-white">Portal Jamaah</h1>
            <p className="text-xs text-slate-400 mt-1">Wisata Halal Indonesia</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block mb-1 text-xs font-medium text-slate-300">Kode Jamaah</label>
              <input
                type="text"
                required
                placeholder="Contoh: CST002001"
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-emerald-500"
                value={loginForm.customerCode}
                onChange={(e) => setLoginForm({ ...loginForm, customerCode: e.target.value })}
              />
              <p className="text-[10px] text-slate-500 mt-1">Kode ini ada di bukti booking / dikirim tim kami lewat WhatsApp.</p>
            </div>
            <div>
              <label className="block mb-1 text-xs font-medium text-slate-300">Tanggal Lahir</label>
              <DateFieldID
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 rounded-lg p-2.5 text-sm"
                nativeClassName="[color-scheme:dark]"
                value={loginForm.birthDate}
                onChange={(val) => setLoginForm({ ...loginForm, birthDate: val })}
              />
            </div>

            {loginError && (
              <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs rounded-lg p-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loggingIn ? 'Memeriksa...' : 'Masuk'}
            </button>
          </form>

          <div className="flex items-start gap-2 text-[10px] text-slate-500 mt-6">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Belum pernah dapat Kode Jamaah, atau tanggal lahir belum terdaftar? Hubungi tim kami lewat WhatsApp buat dibantu.</span>
          </div>
        </div>
      </div>
    );
  }

  // ================= HALAMAN DASHBOARD (VIEW-ONLY) =================
  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Selamat datang,</p>
            <h1 className="text-lg font-bold text-white">{session.fullName || session.customerCode}</h1>
            <p className="text-[11px] font-mono text-emerald-500">{session.customerCode}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-3 py-2 rounded-lg text-xs"
          >
            <LogOut className="w-3.5 h-3.5" /> Keluar
          </button>
        </div>

        {loadingBookings ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Memuat data booking...
          </div>
        ) : bookings.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-sm">
            Belum ada data booking atas nama Anda di sistem kami.
          </div>
        ) : (
          bookings.map((bk) => {
            const badge = statusBadge(bk.status);
            const totalAmount = Number(bk.totalAmount) || 0;
            const totalPaid = Number(bk.totalPaid) || 0;
            const sisaTagihan = Math.max(0, totalAmount - totalPaid);
            const docs = bk.documents || {};

            return (
              <div key={bk.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-5 border-b border-slate-800 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-mono text-slate-500">{bk.bookingCode}</p>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2 mt-0.5">
                      <Plane className="w-4 h-4 text-emerald-500" /> {bk.packageName || '-'}
                    </h2>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Keberangkatan: {formatTanggal(bk.departureDate)}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${badge.className}`}>
                    <badge.Icon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>

                <div className="p-5 border-b border-slate-800">
                  <p className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-3">
                    <Wallet className="w-3.5 h-3.5 text-emerald-500" /> Status Pembayaran
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-[10px] text-slate-500">Total Paket</p>
                      <p className="text-xs font-bold text-white">{formatRupiah(totalAmount)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Sudah Dibayar</p>
                      <p className="text-xs font-bold text-emerald-500">{formatRupiah(totalPaid)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500">Sisa Tagihan</p>
                      <p className={`text-xs font-bold ${sisaTagihan > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{formatRupiah(sisaTagihan)}</p>
                    </div>
                  </div>
                </div>

                <div className="p-5">
                  <p className="text-xs font-medium text-slate-300 flex items-center gap-1.5 mb-3">
                    <FileCheck className="w-3.5 h-3.5 text-emerald-500" /> Kelengkapan Dokumen
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Object.entries(DOC_LABELS).map(([key, label]) => {
                      const done = !!docs[key];
                      return (
                        <div key={key} className={`flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1.5 ${done ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800/60 text-slate-500'}`}>
                          {done ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                          <span>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
