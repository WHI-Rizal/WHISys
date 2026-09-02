'use client';

import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { 
  Building2, 
  Key, 
  Users, 
  Sliders, 
  Save, 
  Check, 
  CreditCard, 
  Bot, 
  Smartphone,
  Moon,
  Database,
  UserPlus,
  X,
  Trash2,
  Lock,
  ShieldCheck
} from 'lucide-react';

export default function SettingsModule({ theme = 'dark' }) {
  const isDark = theme === 'dark';

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
    tabActive: 'bg-emerald-600 text-white shadow-md',
    tabInactive: isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
  };

  const [activeTab, setActiveTab] = useState('company'); // company | api | users | preferences
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // State User & Role
  // PENTING: default-nya sengaja BUKAN 'admin'. Sebelum status role user beneran
  // dikonfirmasi dari Firestore, anggap dia belum punya hak akses admin apapun.
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [usersList, setUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showUserModal, setShowModal] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);

  // Form New User
  const [newUserForm, setNewUserForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'Operational' // 'Super Admin' | 'Finance' | 'Operational' | 'Sales'
  });

  // Settings State
  const [companyData, setCompanyData] = useState({
    name: 'PT. WISATA HALAL INTERNASIONAL',
    ppiuNumber: 'PPIU No. U.123 / 2024',
    address: 'Jl. Raya Utama No. 88, Jakarta Selatan',
    phone: '0812-3456-7890',
    email: 'info@wisatahalal.co.id',
    bankName: 'Bank Syariah Indonesia (BSI)',
    bankAccount: '7123456789 a.n. PT Wisata Halal Internasional'
  });

  const [apiData, setApiData] = useState({
    // Gemini API Key TIDAK dibaca/ditampilkan di sini lagi.
    // Key asli hanya hidup sebagai server-side env var (GEMINI_API_KEY di Vercel)
    // dan dipakai lewat /api/ai-chat — tidak pernah dikirim ke browser atau
    // disimpan ke Firestore.
    waGatewayUrl: 'https://api.fonnte.com/send',
    waToken: '••••••••••••••••'
  });

  const [systemPref, setSystemPref] = useState({
    defaultTheme: 'dark',
    autoBackup: true
  });

  // 1. Cek Role Admin Aktif & Load Data Users
  const fetchUsersAndRole = async () => {
    setLoadingUsers(true);
    try {
      // Ambil role user login saat ini
      const currentUser = auth.currentUser;
      let resolvedRole = '';
      if (currentUser) {
        const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
        // Kalau dokumen belum ada / field role kosong, JANGAN default ke 'admin' —
        // biarkan resolvedRole tetap kosong (= tanpa akses admin apapun).
        resolvedRole = userDoc.exists() ? (userDoc.data().role || '') : '';
        setCurrentUserRole(resolvedRole);
      }

      // Daftar seluruh staf cuma boleh diambil kalau role-nya Super Admin — sesuai
      // Firestore Security Rules. Kalau bukan, jangan coba query-nya sama sekali
      // (query itu bakal ditolak rules & cuma nyampah error di console).
      const isSuperAdminRole = resolvedRole.toLowerCase().includes('super') || resolvedRole.toLowerCase() === 'admin';
      if (isSuperAdminRole) {
        const usersSnap = await getDocs(collection(db, 'users'));
        const list = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        setUsersList(list);
      } else {
        setUsersList([]);
      }
    } catch (err) {
      console.error("Gagal mengambil data user/role:", err);
    }
    setLoadingUsers(false);
  };

  // 2. Load Initial Data Settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docRef = doc(db, 'settings', 'company_profile');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.company) setCompanyData(data.company);
          if (data.api) setApiData(data.api);
          if (data.preferences) setSystemPref(data.preferences);
        }
      } catch (err) {
        console.error("Gagal memuat pengaturan dari Firestore:", err);
      }
    };

    fetchSettings();
    fetchUsersAndRole();
  }, []);

  // 3. Simpan Settings
  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'company_profile'), {
        company: companyData,
        api: apiData,
        preferences: systemPref,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error("Gagal menyimpan pengaturan ke Firestore:", err);
      alert("Gagal menyimpan ke database Firestore.");
    }
    setSaving(false);
  };

  // 4. LOGIKA TAMBAH USER BARU KE FIREBASE AUTH & FIRESTORE
  const handleCreateUser = async (e) => {
    e.preventDefault();

    // Proteksi Keamanan Frontend
    const isSuperAdmin = currentUserRole.toLowerCase().includes('super') || currentUserRole.toLowerCase() === 'admin';
    if (!isSuperAdmin) {
      alert("Akses Ditolak: Hanya Super Admin yang diizinkan menambah akun staf baru.");
      return;
    }

    if (!newUserForm.email || !newUserForm.password || !newUserForm.fullName) {
      alert("Harap lengkapi semua kolom pendaftaran.");
      return;
    }

    if (newUserForm.password.length < 6) {
      alert("Password minimal harus 6 karakter.");
      return;
    }

    setCreatingUser(true);
    try {
      // Inisialisasi Secondary App agar Super Admin tidak ter-logout
      const firebaseConfig = {
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
      };

      const secondaryApp = getApps().find(app => app.name === 'SecondaryApp') 
        || initializeApp(firebaseConfig, 'SecondaryApp');
      const secondaryAuth = getAuth(secondaryApp);

      // Create User di Auth Sekunder
      const userCredential = await createUserWithEmailAndPassword(
        secondaryAuth,
        newUserForm.email,
        newUserForm.password
      );

      const newUid = userCredential.user.uid;

      // Simpan metadata role & profile ke Firestore 'users'
      await setDoc(doc(db, 'users', newUid), {
        uid: newUid,
        fullName: newUserForm.fullName,
        email: newUserForm.email,
        role: newUserForm.role,
        createdAt: new Date().toISOString()
      });

      alert(`Berhasil menambahkan staf baru:\nNama: ${newUserForm.fullName}\nEmail: ${newUserForm.email}\nRole: ${newUserForm.role}`);
      
      // Reset Form & Reload Data
      setNewUserForm({ fullName: '', email: '', password: '', role: 'Operational' });
      setShowModal(false);
      fetchUsersAndRole();

    } catch (err) {
      console.error("Gagal membuat user baru:", err);
      alert("Gagal menambahkan user: " + err.message);
    }
    setCreatingUser(false);
  };

  // 5. Hapus User dari Firestore
  const handleDeleteUser = async (userId, userEmail) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus data user ${userEmail}?`)) return;
    try {
      await deleteDoc(doc(db, 'users', userId));
      fetchUsersAndRole();
    } catch (err) {
      alert("Gagal menghapus user: " + err.message);
    }
  };

  const isSuperAdmin = currentUserRole.toLowerCase().includes('super') || currentUserRole.toLowerCase() === 'admin';

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Sliders className="w-5 h-5 text-emerald-400" /> System Settings & Preferences
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Kelola identitas perusahaan, hak akses pengguna, serta integrasi API ERP WHISys.</p>
        </div>
        
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-lg shadow-emerald-900/20"
        >
          {savedSuccess ? <Check className="w-4 h-4 text-white animate-bounce" /> : <Save className="w-4 h-4" />}
          {saving ? 'Menyimpan...' : savedSuccess ? 'Tersimpan!' : 'Simpan Perubahan'}
        </button>
      </div>

      {/* TAB NAVIGATION */}
      <div className="flex overflow-x-auto gap-2 p-1.5 bg-slate-900/40 rounded-xl border border-slate-800/80">
        <button
          type="button"
          onClick={() => setActiveTab('company')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === 'company' ? styles.tabActive : styles.tabInactive}`}
        >
          <Building2 className="w-4 h-4" /> Profil Perusahaan
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('api')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === 'api' ? styles.tabActive : styles.tabInactive}`}
        >
          <Key className="w-4 h-4" /> Integrasi & API Keys
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === 'users' ? styles.tabActive : styles.tabInactive}`}
        >
          <Users className="w-4 h-4" /> Hak Akses User
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('preferences')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === 'preferences' ? styles.tabActive : styles.tabInactive}`}
        >
          <Sliders className="w-4 h-4" /> Master Preferences
        </button>
      </div>

      {/* TAB CONTENTS */}
      <form onSubmit={handleSaveSettings}>
        
        {/* 1. PROFIL PERUSAHAAN */}
        {activeTab === 'company' && (
          <div className={`${styles.cardBg} p-6 rounded-xl border space-y-6 animate-in fade-in duration-200`}>
            <div className="border-b border-slate-800 pb-3">
              <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                <Building2 className="w-4 h-4 text-emerald-400" /> Identitas PT & Rekening Penampungan
              </h4>
              <p className={`text-xs ${styles.textSub}`}>Informasi ini akan tercetak otomatis di Invoice, Kwitansi Pembayaran, dan Kop Surat Jamaah.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Nama Perusahaan / Travel</label>
                <input
                  type="text"
                  value={companyData.name}
                  onChange={(e) => setCompanyData({...companyData, name: e.target.value})}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Izin PPIU / PIHK (Kemenag)</label>
                <input
                  type="text"
                  value={companyData.ppiuNumber}
                  onChange={(e) => setCompanyData({...companyData, ppiuNumber: e.target.value})}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Nomor Whatsapp / Telepon Kantor</label>
                <input
                  type="text"
                  value={companyData.phone}
                  onChange={(e) => setCompanyData({...companyData, phone: e.target.value})}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div>
                <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Email Resmi Travel</label>
                <input
                  type="email"
                  value={companyData.email}
                  onChange={(e) => setCompanyData({...companyData, email: e.target.value})}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div className="md:col-span-2">
                <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Alamat Kantor Pusat</label>
                <textarea
                  rows={2}
                  value={companyData.address}
                  onChange={(e) => setCompanyData({...companyData, address: e.target.value})}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h5 className={`text-xs font-bold ${styles.textTitle} flex items-center gap-2 mb-3`}>
                <CreditCard className="w-4 h-4 text-emerald-400" /> Rekening Pembayaran Resmi (Untuk Kwitansi)
              </h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Nama Bank</label>
                  <input
                    type="text"
                    value={companyData.bankName}
                    onChange={(e) => setCompanyData({...companyData, bankName: e.target.value})}
                    className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                  />
                </div>
                <div>
                  <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Nomor Rekening & Atas Nama</label>
                  <input
                    type="text"
                    value={companyData.bankAccount}
                    onChange={(e) => setCompanyData({...companyData, bankAccount: e.target.value})}
                    className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. INTEGRASI & API KEYS */}
        {activeTab === 'api' && (
          <div className={`${styles.cardBg} p-6 rounded-xl border space-y-6 animate-in fade-in duration-200`}>
            <div className="border-b border-slate-800 pb-3">
              <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                <Key className="w-4 h-4 text-emerald-400" /> Integrasi Layanan Pihak Ketiga
              </h4>
              <p className={`text-xs ${styles.textSub}`}>Atur API Key untuk Asisten AI dan layanan notifikasi pesan otomatis.</p>
            </div>

            <div className="space-y-4">
              {/* GEMINI AI API */}
              <div className={`p-4 rounded-xl border ${styles.innerBg} space-y-3`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${styles.textTitle} flex items-center gap-2`}>
                    <Bot className="w-4 h-4 text-emerald-400" /> Google Gemini AI API Key
                  </span>
                  <span className="px-2 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded-full font-semibold border border-emerald-500/30">
                    Dikelola di Server
                  </span>
                </div>
                <input
                  type="password"
                  value="••••••••••••••••••••••••••"
                  disabled
                  readOnly
                  className={`w-full ${styles.inputBg} p-2.5 rounded-lg text-xs font-mono opacity-60 cursor-not-allowed`}
                />
                <p className={`text-[11px] ${styles.textSub}`}>Demi keamanan, API Key hanya diatur lewat Environment Variable <code>GEMINI_API_KEY</code> di Vercel — tidak bisa dilihat/diubah dari sini.</p>
              </div>

              {/* WHATSAPP GATEWAY API */}
              <div className={`p-4 rounded-xl border ${styles.innerBg} space-y-3`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${styles.textTitle} flex items-center gap-2`}>
                    <Smartphone className="w-4 h-4 text-emerald-400" /> WhatsApp Gateway (Notifikasi Otomatis)
                  </span>
                  <span className="px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded-full font-semibold border border-amber-500/30">
                    Opsional
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="URL Endpoint API"
                    value={apiData.waGatewayUrl}
                    onChange={(e) => setApiData({...apiData, waGatewayUrl: e.target.value})}
                    className={`w-full ${styles.inputBg} p-2.5 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-500`}
                  />
                  <input
                    type="password"
                    placeholder="Token API WA Gateway"
                    value={apiData.waToken}
                    onChange={(e) => setApiData({...apiData, waToken: e.target.value})}
                    className={`w-full ${styles.inputBg} p-2.5 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-500`}
                  />
                </div>
                <p className={`text-[11px] ${styles.textSub}`}>Digunakan untuk pengiriman otomatis kwitansi & pengingat dokumen pelunasan via WhatsApp.</p>
              </div>
            </div>
          </div>
        )}

        {/* 3. MANAJEMEN STAF & HAK AKSES */}
        {activeTab === 'users' && (
          <div className={`${styles.cardBg} p-6 rounded-xl border space-y-6 animate-in fade-in duration-200`}>
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                  <Users className="w-4 h-4 text-emerald-400" /> Pengguna Sistem & Hak Akses
                </h4>
                <p className={`text-xs ${styles.textSub}`}>Atur peran dan wewenang admin operasional, keuangan, dan agen sales.</p>
              </div>
              
              {/* TOMBOL TAMBAH USER (AKTIF HANYA UNTUK SUPER ADMIN) */}
              <button
                type="button"
                onClick={() => {
                  if (!isSuperAdmin) {
                    alert("Akses Ditolak: Hanya Super Admin yang dapat menambahkan user baru.");
                    return;
                  }
                  setShowModal(true);
                }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isSuperAdmin 
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg' 
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
                title={isSuperAdmin ? "Tambah User Staf Baru" : "Hanya Super Admin yang bisa menambah user"}
              >
                {isSuperAdmin ? <UserPlus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                + Tambah User
              </button>
            </div>

            <div className="space-y-3">
              {loadingUsers ? (
                <p className={`text-xs ${styles.textSub} py-6 text-center`}>Memuat daftar pengguna dari Firestore...</p>
              ) : !isSuperAdmin ? (
                <div className={`p-6 text-center ${styles.textSub} text-xs border border-dashed border-slate-800 rounded-xl flex flex-col items-center gap-2`}>
                  <Lock className="w-4 h-4" />
                  Cuma Super Admin yang bisa lihat & kelola daftar staf.
                </div>
              ) : usersList.length === 0 ? (
                <div className={`p-6 text-center ${styles.textSub} text-xs border border-dashed border-slate-800 rounded-xl`}>
                  Belum ada data user tersimpan di koleksi Firestore.
                </div>
              ) : (
                usersList.map((user) => (
                  <div key={user.id} className={`p-4 rounded-xl border ${styles.innerBg} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl font-bold text-xs uppercase ${
                        user.role === 'Super Admin' || user.role === 'admin' ? 'bg-emerald-500/20 text-emerald-400' :
                        user.role === 'Finance' ? 'bg-blue-500/20 text-blue-400' :
                        user.role === 'Sales' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}>
                        {(user.fullName || user.email || 'US').slice(0, 2)}
                      </div>
                      <div>
                        <h5 className={`text-xs font-bold ${styles.textTitle}`}>{user.fullName || 'Staf WHI'}</h5>
                        <p className={`text-[11px] ${styles.textSub}`}>{user.email}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`px-2.5 py-1 text-[10px] rounded-lg font-bold border ${
                        user.role === 'Super Admin' || user.role === 'admin' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                        user.role === 'Finance' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                        user.role === 'Sales' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                        'bg-purple-500/10 text-purple-400 border-purple-500/20'
                      }`}>
                        {user.role || 'Operational'}
                      </span>

                      {/* Tombol Hapus User (Hanya jika Super Admin & bukan akun sendiri) */}
                      {isSuperAdmin && auth.currentUser?.uid !== user.id && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          className="p-1.5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                          title="Hapus Data User"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* 4. PREFERENCES & BACKUP */}
        {activeTab === 'preferences' && (
          <div className={`${styles.cardBg} p-6 rounded-xl border space-y-6 animate-in fade-in duration-200`}>
            <div className="border-b border-slate-800 pb-3">
              <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                <Sliders className="w-4 h-4 text-emerald-400" /> Preferensi Sistem & Keamanan Data
              </h4>
              <p className={`text-xs ${styles.textSub}`}>Pengaturan tema bawaan serta cadangan database harian.</p>
            </div>

            <div className="space-y-4">
              <div className={`p-4 rounded-xl border ${styles.innerBg} flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <Moon className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h5 className={`text-xs font-bold ${styles.textTitle}`}>Tema Tampilan Bawaan</h5>
                    <p className={`text-[11px] ${styles.textSub}`}>Pilih tampilan awal saat aplikasi dibuka.</p>
                  </div>
                </div>
                <select
                  value={systemPref.defaultTheme}
                  onChange={(e) => setSystemPref({...systemPref, defaultTheme: e.target.value})}
                  className={`${styles.inputBg} p-2 rounded-lg text-xs focus:outline-none`}
                >
                  <option value="dark">Dark Mode (Gelap)</option>
                  <option value="light">Light Mode (Terang)</option>
                </select>
              </div>

              <div className={`p-4 rounded-xl border ${styles.innerBg} flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <div>
                    <h5 className={`text-xs font-bold ${styles.textTitle}`}>Cadangan Data Otomatis</h5>
                    <p className={`text-[11px] ${styles.textSub}`}>Simpan salinan data Firestore secara berkala ke cloud backup.</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={systemPref.autoBackup}
                  onChange={(e) => setSystemPref({...systemPref, autoBackup: e.target.checked})}
                  className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

      </form>

      {/* MODAL DIALOG TAMBAH USER BARU */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative shadow-2xl max-h-[90vh] overflow-y-auto`}>
            <button 
              type="button" 
              onClick={() => setShowModal(false)} 
              className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <UserPlus className="w-5 h-5 text-emerald-400" /> Tambah User Staf Baru
            </h3>
            <p className={`text-xs ${styles.textSub} mb-5`}>
              Akun akan didaftarkan ke Firebase Auth & Firestore dengan role pilihan.
            </p>

            <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
              <div>
                <label className={`block font-medium ${styles.textSub} mb-1.5`}>Nama Lengkap Staf</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Ahmad Rizal."
                  value={newUserForm.fullName}
                  onChange={(e) => setNewUserForm({ ...newUserForm, fullName: e.target.value })}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div>
                <label className={`block font-medium ${styles.textSub} mb-1.5`}>Email Login</label>
                <input
                  type="email"
                  required
                  placeholder="staf@wisatahalal.co.id"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div>
                <label className={`block font-medium ${styles.textSub} mb-1.5`}>Password (Min. 6 Karakter)</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div>
                <label className={`block font-medium ${styles.textSub} mb-1.5`}>Role / Peran Akses Sistem</label>
                <select
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value })}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                >
                  <option value="Operational">Operational (Manifest, Bus, Dokumen)</option>
                  <option value="Finance">Finance (Pencatatan Kas & Kwitansi)</option>
                  <option value="Sales">Sales / Agen (Booking Paket)</option>
                  <option value="Super Admin">Super Admin (Akses Penuh Sistem)</option>
                </select>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-medium hover:bg-slate-700 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-emerald-900/20 flex items-center gap-2"
                >
                  {creatingUser ? 'Memproses...' : 'Daftarkan Staf Baru'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
