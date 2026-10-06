'use client';

import React, { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc, addDoc, updateDoc, collection, getDocs, deleteDoc, deleteField } from 'firebase/firestore';
import { logActivity } from '../../lib/activityLog';
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
  ShieldCheck,
  Plus,
  Pencil,
  Search,
  Landmark
} from 'lucide-react';

export default function SettingsModule({ theme = 'dark', currentUser = null }) {
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
    // Rekening Pembayaran Resmi — sekarang berupa DAFTAR (bisa lebih dari
    // satu, mis. BSI & Mandiri sekaligus), bukan cuma 1 field kayak dulu.
    // Semua rekening di daftar ini bakal otomatis tampil di invoice.
    bankAccounts: [
      { bankName: 'Bank Syariah Indonesia (BSI)', bankAccount: '7123456789 a.n. PT Wisata Halal Internasional' }
    ]
  });

  const [apiData, setApiData] = useState({
    // Gemini API Key TIDAK dibaca/ditampilkan di sini lagi.
    // Key asli hanya hidup sebagai server-side env var (GEMINI_API_KEY di Vercel)
    // dan dipakai lewat /api/ai-chat — tidak pernah dikirim ke browser atau
    // disimpan ke Firestore.
    // Token WA Gateway TIDAK disimpan di Firestore/browser. Token asli cuma hidup
    // sebagai env var WA_GATEWAY_TOKEN di Vercel (server-side). Yang disimpan di
    // sini cuma URL endpoint (bukan rahasia).
    waGatewayUrl: 'https://api.fonnte.com/send'
  });

  const [systemPref, setSystemPref] = useState({
    defaultTheme: 'dark',
    autoBackup: true
  });

  // State Pengaturan EDC — daftar metode EDC/QRIS yang terdaftar, tiap
  // metode nempel ke 1 akun bank & punya persentase MDR default sendiri.
  // Dipakai di BookingsModule.jsx buat dropdown metode bayar + potongan
  // MDR otomatis pas setoran via EDC dicatat.
  const [edcMethods, setEdcMethods] = useState([]);
  const [loadingEdc, setLoadingEdc] = useState(false);
  const [financialAccountsList, setFinancialAccountsList] = useState([]);
  const [edcSearchTerm, setEdcSearchTerm] = useState('');
  const [showEdcModal, setShowEdcModal] = useState(false);
  const [editingEdcId, setEditingEdcId] = useState(null);
  const [savingEdc, setSavingEdc] = useState(false);
  const [edcForm, setEdcForm] = useState({ name: '', accountId: '', mdrPercent: '' });

  const fetchEdcMethods = async () => {
    setLoadingEdc(true);
    try {
      const [edcSnap, accSnap] = await Promise.all([
        getDocs(collection(db, 'edc_methods')),
        getDocs(collection(db, 'financial_accounts'))
      ]);
      const accounts = accSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setFinancialAccountsList(accounts);
      const list = edcSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setEdcMethods(list);
    } catch (err) {
      console.error('Gagal memuat Pengaturan EDC:', err);
    }
    setLoadingEdc(false);
  };

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
          if (data.company) {
            // Migrasi otomatis dari format LAMA (1 field bankName/bankAccount
            // doang) ke format BARU (array bankAccounts). Kalau dokumen di
            // Firestore masih format lama & belum sempat disimpan ulang
            // lewat form ini, tetap tampil normal sebagai 1 baris rekening.
            let migratedCompany = { ...data.company };
            if (!Array.isArray(migratedCompany.bankAccounts) || migratedCompany.bankAccounts.length === 0) {
              if (migratedCompany.bankName || migratedCompany.bankAccount) {
                migratedCompany.bankAccounts = [{
                  bankName: migratedCompany.bankName || '',
                  bankAccount: migratedCompany.bankAccount || ''
                }];
              } else {
                migratedCompany.bankAccounts = [{ bankName: '', bankAccount: '' }];
              }
            }
            setCompanyData(prev => ({ ...prev, ...migratedCompany }));
          }
          if (data.api) setApiData({ waGatewayUrl: data.api.waGatewayUrl || 'https://api.fonnte.com/send' });
          if (data.preferences) setSystemPref(data.preferences);
        }
      } catch (err) {
        console.error("Gagal memuat pengaturan dari Firestore:", err);
      }
    };

    fetchSettings();
    fetchUsersAndRole();
    fetchEdcMethods();
  }, []);

  // 2c. Kelola Pengaturan EDC (metode EDC/QRIS + akun bank + MDR default)
  const isFinanceOrAdminRole = currentUserRole.toLowerCase().includes('super')
    || currentUserRole.toLowerCase() === 'admin'
    || currentUserRole.toLowerCase() === 'finance';

  const openAddEdcModal = () => {
    setEditingEdcId(null);
    setEdcForm({ name: '', accountId: financialAccountsList[0]?.id || '', mdrPercent: '' });
    setShowEdcModal(true);
  };

  const openEditEdcModal = (row) => {
    setEditingEdcId(row.id);
    setEdcForm({ name: row.name || '', accountId: row.accountId || '', mdrPercent: row.mdrPercent ?? '' });
    setShowEdcModal(true);
  };

  const handleSaveEdcMethod = async (e) => {
    if (e) e.preventDefault();
    if (!isFinanceOrAdminRole) {
      alert('Akses Ditolak: Hanya Finance/Super Admin yang bisa mengelola Pengaturan EDC.');
      return;
    }
    const name = edcForm.name.trim();
    const accountId = edcForm.accountId;
    const mdrPercent = Number(edcForm.mdrPercent);
    if (!name) { alert('Nama EDC wajib diisi.'); return; }
    if (!accountId) { alert('Akun Bank wajib dipilih.'); return; }
    if (Number.isNaN(mdrPercent) || mdrPercent < 0) { alert('MDR Default harus berupa angka >= 0.'); return; }
    const dupe = edcMethods.find(m => m.id !== editingEdcId && (m.name || '').toLowerCase() === name.toLowerCase());
    if (dupe) { alert(`Nama EDC "${name}" sudah dipakai, pakai nama lain ya.`); return; }

    setSavingEdc(true);
    try {
      const acc = financialAccountsList.find(a => a.id === accountId);
      const payload = {
        name,
        accountId,
        accountName: acc?.name || '-',
        mdrPercent,
        updatedAt: new Date().toISOString()
      };
      if (editingEdcId) {
        await updateDoc(doc(db, 'edc_methods', editingEdcId), payload);
        logActivity({
          userId: currentUser?.uid || auth.currentUser?.uid,
          userName: currentUser?.fullName || auth.currentUser?.email,
          userRole: currentUser?.role || '-',
          action: 'update',
          module: 'Pengaturan - EDC',
          targetLabel: name,
          details: `Mengubah metode EDC "${name}" (Akun: ${payload.accountName}, MDR: ${mdrPercent}%).`
        });
      } else {
        await addDoc(collection(db, 'edc_methods'), { ...payload, createdAt: new Date().toISOString() });
        logActivity({
          userId: currentUser?.uid || auth.currentUser?.uid,
          userName: currentUser?.fullName || auth.currentUser?.email,
          userRole: currentUser?.role || '-',
          action: 'create',
          module: 'Pengaturan - EDC',
          targetLabel: name,
          details: `Menambahkan metode EDC baru "${name}" (Akun: ${payload.accountName}, MDR: ${mdrPercent}%).`
        });
      }
      setShowEdcModal(false);
      fetchEdcMethods();
    } catch (err) {
      console.error('Gagal menyimpan Pengaturan EDC:', err);
      alert('Gagal menyimpan: ' + err.message);
    }
    setSavingEdc(false);
  };

  const handleDeleteEdcMethod = async (row) => {
    if (!isFinanceOrAdminRole) {
      alert('Akses Ditolak: Hanya Finance/Super Admin yang bisa menghapus Pengaturan EDC.');
      return;
    }
    if (!confirm(`Hapus metode EDC "${row.name}"? Setoran yang sudah tercatat pakai metode ini TIDAK ikut terhapus/berubah, cuma pilihannya aja yang hilang dari form setoran baru.`)) return;
    try {
      await deleteDoc(doc(db, 'edc_methods', row.id));
      logActivity({
        userId: currentUser?.uid || auth.currentUser?.uid,
        userName: currentUser?.fullName || auth.currentUser?.email,
        userRole: currentUser?.role || '-',
        action: 'delete',
        module: 'Pengaturan - EDC',
        targetLabel: row.name,
        details: `Menghapus metode EDC "${row.name}".`
      });
      fetchEdcMethods();
    } catch (err) {
      alert('Gagal menghapus: ' + err.message);
    }
  };

  const filteredEdcMethods = edcMethods.filter(m => {
    const term = edcSearchTerm.trim().toLowerCase();
    if (!term) return true;
    return (m.name || '').toLowerCase().includes(term) || (m.accountName || '').toLowerCase().includes(term);
  });

  // 2b. Kelola Daftar Rekening Pembayaran (bisa lebih dari 1)
  const handleAddBankAccount = () => {
    setCompanyData(prev => ({
      ...prev,
      bankAccounts: [...(prev.bankAccounts || []), { bankName: '', bankAccount: '' }]
    }));
  };

  const handleUpdateBankAccountField = (index, field, value) => {
    setCompanyData(prev => {
      const updated = [...(prev.bankAccounts || [])];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, bankAccounts: updated };
    });
  };

  const handleRemoveBankAccount = (index) => {
    setCompanyData(prev => {
      const current = prev.bankAccounts || [];
      // Minimal harus ada 1 rekening — kalau tinggal 1, tombol hapusnya
      // disembunyikan dari UI, tapi dijaga juga di sini sebagai pengaman.
      if (current.length <= 1) return prev;
      return { ...prev, bankAccounts: current.filter((_, i) => i !== index) };
    });
  };

  // 3. Simpan Settings
  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'company_profile'), {
        company: companyData,
        // waToken lama (kalau masih ada di dokumen) ikut dihapus permanen.
        api: { waGatewayUrl: apiData.waGatewayUrl, waToken: deleteField() },
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

      logActivity({
        userId: currentUser?.uid || auth.currentUser?.uid,
        userName: currentUser?.fullName || auth.currentUser?.email,
        userRole: currentUser?.role || '-',
        action: 'create',
        module: 'Pengaturan - User',
        targetLabel: newUserForm.fullName,
        details: `Menambahkan staf baru "${newUserForm.fullName}" (${newUserForm.email}) dengan role ${newUserForm.role}.`
      });

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

      logActivity({
        userId: currentUser?.uid || auth.currentUser?.uid,
        userName: currentUser?.fullName || auth.currentUser?.email,
        userRole: currentUser?.role || '-',
        action: 'delete',
        module: 'Pengaturan - User',
        targetLabel: userEmail,
        details: `Menghapus akun staf "${userEmail}" dari sistem.`
      });

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
        <button
          type="button"
          onClick={() => setActiveTab('edc')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${activeTab === 'edc' ? styles.tabActive : styles.tabInactive}`}
        >
          <CreditCard className="w-4 h-4" /> Pengaturan EDC
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
              <div className="flex items-center justify-between mb-3">
                <h5 className={`text-xs font-bold ${styles.textTitle} flex items-center gap-2`}>
                  <CreditCard className="w-4 h-4 text-emerald-400" /> Rekening Pembayaran Resmi (Untuk Invoice & Kwitansi)
                </h5>
                <button
                  type="button"
                  onClick={handleAddBankAccount}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-500 border border-emerald-500/30 rounded-lg text-[11px] font-medium transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Tambah Rekening
                </button>
              </div>
              <p className={`text-xs ${styles.textSub} mb-3`}>Semua rekening di daftar ini bakal otomatis muncul di Invoice, bisa lebih dari satu (mis. BSI & Mandiri sekaligus).</p>

              <div className="space-y-3">
                {(companyData.bankAccounts || []).map((acc, idx) => (
                  <div key={idx} className={`${styles.innerBg} border rounded-xl p-3`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[11px] font-semibold ${styles.textSub}`}>Rekening {idx + 1}</span>
                      {(companyData.bankAccounts || []).length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBankAccount(idx)}
                          className="text-rose-500 hover:text-rose-400 p-1"
                          title="Hapus Rekening Ini"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Nama Bank</label>
                        <input
                          type="text"
                          value={acc.bankName}
                          onChange={(e) => handleUpdateBankAccountField(idx, 'bankName', e.target.value)}
                          className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                        />
                      </div>
                      <div>
                        <label className={`block text-xs font-medium ${styles.textSub} mb-1.5`}>Nomor Rekening & Atas Nama</label>
                        <input
                          type="text"
                          value={acc.bankAccount}
                          onChange={(e) => handleUpdateBankAccountField(idx, 'bankAccount', e.target.value)}
                          className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                        />
                      </div>
                    </div>
                  </div>
                ))}
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
                  <div className={`w-full ${styles.inputBg} p-2.5 rounded-lg text-[11px] ${styles.textSub}`}>
                    Token diatur lewat Environment Variable <code>WA_GATEWAY_TOKEN</code> di Vercel, tidak bisa dilihat/diubah dari sini.
                  </div>
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
                // Urutkan berdasarkan role (Super Admin di atas, lalu Finance,
                // Operational, Sales, terakhir role lain di luar 4 itu) —
                // dalam role yang sama, urutan asli dari Firestore dipertahankan.
                [...usersList].sort((a, b) => {
                  const roleOrder = { 'Super Admin': 0, 'admin': 0, 'Finance': 1, 'Operational': 2, 'Sales': 3 };
                  const orderA = roleOrder[a.role] ?? 4;
                  const orderB = roleOrder[b.role] ?? 4;
                  return orderA - orderB;
                }).map((user) => (
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

        {/* 5. PENGATURAN EDC */}
        {activeTab === 'edc' && (
          <div className={`${styles.cardBg} p-6 rounded-xl border space-y-5 animate-in fade-in duration-200`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-3">
              <div>
                <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                  <CreditCard className="w-4 h-4 text-emerald-400" /> Pengaturan EDC
                </h4>
                <p className={`text-xs ${styles.textSub}`}>
                  Daftarkan metode EDC/QRIS beserta akun bank tujuan & persentase MDR default-nya.
                  Pas staf catat setoran customer via EDC, sistem otomatis motong MDR dan cuma nyatet
                  jumlah bersih yang masuk ke rekening — potongannya langsung kebukukan sebagai Biaya Admin EDC.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isFinanceOrAdminRole) {
                    alert('Akses Ditolak: Hanya Finance/Super Admin yang bisa menambah Pengaturan EDC.');
                    return;
                  }
                  if (financialAccountsList.length === 0) {
                    alert('Belum ada akun Kas/Bank. Tambahkan dulu lewat tab "Kas & Bank" di Laporan Keuangan.');
                    return;
                  }
                  openAddEdcModal();
                }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                  isFinanceOrAdminRole
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
                title={isFinanceOrAdminRole ? 'Tambah Metode EDC Baru' : 'Hanya Finance/Super Admin yang bisa menambah'}
              >
                {isFinanceOrAdminRole ? <Plus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                Tambah Data
              </button>
            </div>

            <div className="flex justify-end">
              <div className="relative w-full sm:w-64">
                <Search className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${styles.textSub}`} />
                <input
                  type="text"
                  placeholder="Cari..."
                  value={edcSearchTerm}
                  onChange={(e) => setEdcSearchTerm(e.target.value)}
                  className={`w-full ${styles.inputBg} pl-9 pr-3 py-2 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>
            </div>

            {loadingEdc ? (
              <p className={`text-xs ${styles.textSub} py-6 text-center`}>Memuat Pengaturan EDC...</p>
            ) : filteredEdcMethods.length === 0 ? (
              <div className={`p-6 text-center ${styles.textSub} text-xs border border-dashed border-slate-800 rounded-xl flex flex-col items-center gap-2`}>
                <Landmark className="w-5 h-5" />
                {edcMethods.length === 0 ? 'Belum ada metode EDC terdaftar.' : 'Nggak ada yang cocok sama pencarian.'}
              </div>
            ) : (
              <>
                {/* Tabel desktop */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={`${styles.textSub} border-b border-slate-800 text-left`}>
                        <th className="py-2 pr-3 font-semibold">No</th>
                        <th className="py-2 pr-3 font-semibold">Nama EDC</th>
                        <th className="py-2 pr-3 font-semibold">Akun Bank</th>
                        <th className="py-2 pr-3 font-semibold text-right">MDR Default</th>
                        <th className="py-2 pr-3 font-semibold text-right">Opsi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEdcMethods.map((row, idx) => (
                        <tr key={row.id} className="border-b border-slate-800/60">
                          <td className={`py-3 pr-3 ${styles.textSub}`}>{idx + 1}</td>
                          <td className={`py-3 pr-3 font-semibold ${styles.textTitle}`}>{row.name}</td>
                          <td className={`py-3 pr-3 ${styles.textSub}`}>{row.accountName || '-'}</td>
                          <td className={`py-3 pr-3 text-right ${styles.textTitle}`}>{Number(row.mdrPercent) || 0}%</td>
                          <td className="py-3 pr-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => isFinanceOrAdminRole ? openEditEdcModal(row) : alert('Akses Ditolak: Hanya Finance/Super Admin yang bisa mengubah.')}
                                className="p-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded-lg transition-colors"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteEdcMethod(row)}
                                className="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-lg transition-colors"
                                title="Hapus"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Kartu mobile */}
                <div className="sm:hidden space-y-3">
                  {filteredEdcMethods.map((row) => (
                    <div key={row.id} className={`p-3 rounded-xl border ${styles.innerBg}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <h5 className={`text-xs font-bold ${styles.textTitle}`}>{row.name}</h5>
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => isFinanceOrAdminRole ? openEditEdcModal(row) : alert('Akses Ditolak: Hanya Finance/Super Admin yang bisa mengubah.')} className="p-1.5 bg-amber-500/10 text-amber-500 rounded-lg">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => handleDeleteEdcMethod(row)} className="p-1.5 bg-rose-500/10 text-rose-500 rounded-lg">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className={`text-[11px] ${styles.textSub}`}>{row.accountName || '-'}</p>
                      <p className={`text-[11px] ${styles.textSub}`}>MDR Default: <span className={styles.textTitle}>{Number(row.mdrPercent) || 0}%</span></p>
                    </div>
                  ))}
                </div>
              </>
            )}
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

      {/* MODAL TAMBAH/EDIT METODE EDC */}
      {showEdcModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${styles.cardBg} border rounded-2xl w-full max-w-md p-6 relative shadow-2xl max-h-[90vh] overflow-y-auto`}>
            <button
              type="button"
              onClick={() => setShowEdcModal(false)}
              className={`absolute right-4 top-4 ${styles.textSub} hover:${styles.textTitle}`}
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${styles.textTitle} mb-1 flex items-center gap-2`}>
              <CreditCard className="w-5 h-5 text-emerald-400" /> {editingEdcId ? 'Edit Metode EDC' : 'Tambah Metode EDC'}
            </h3>
            <p className={`text-xs ${styles.textSub} mb-5`}>
              Begitu disimpan, metode ini langsung muncul di dropdown metode bayar pas staf catat setoran.
            </p>

            <form onSubmit={handleSaveEdcMethod} className="space-y-4 text-xs">
              <div>
                <label className={`block font-medium ${styles.textSub} mb-1.5`}>Nama EDC</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: EDC BCA / QRIS BSI"
                  value={edcForm.name}
                  onChange={(e) => setEdcForm({ ...edcForm, name: e.target.value })}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
              </div>

              <div>
                <label className={`block font-medium ${styles.textSub} mb-1.5`}>Akun Bank Tujuan</label>
                <select
                  required
                  value={edcForm.accountId}
                  onChange={(e) => setEdcForm({ ...edcForm, accountId: e.target.value })}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                >
                  <option value="">Pilih akun...</option>
                  {financialAccountsList.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
                <p className={`text-[11px] ${styles.textSub} mt-1`}>Rekening yang bakal nerima dana bersih (setelah dipotong MDR) dari EDC ini.</p>
              </div>

              <div>
                <label className={`block font-medium ${styles.textSub} mb-1.5`}>MDR Default (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="Contoh: 0.15"
                  value={edcForm.mdrPercent}
                  onChange={(e) => setEdcForm({ ...edcForm, mdrPercent: e.target.value })}
                  className={`w-full ${styles.inputBg} p-3 rounded-xl text-xs focus:outline-none focus:border-emerald-500`}
                />
                <p className={`text-[11px] ${styles.textSub} mt-1`}>Persentase potongan bank dari tiap transaksi, sesuai ketentuan masing-masing bank/penyedia EDC.</p>
              </div>

              <div className="pt-4 flex justify-end gap-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEdcModal(false)}
                  className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl font-medium hover:bg-slate-700 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEdc}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded-xl font-semibold transition-all shadow-lg shadow-emerald-900/20 flex items-center gap-2"
                >
                  {savingEdc ? 'Menyimpan...' : editingEdcId ? 'Simpan Perubahan' : 'Simpan Metode EDC'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
