'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { 
  Building2, 
  Key, 
  Users, 
  Sliders, 
  Save, 
  Check, 
  CreditCard, 
  ShieldCheck, 
  Bot, 
  Smartphone,
  Moon,
  Sun,
  Database
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

  // Form State Demo Settings
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
    geminiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || 'AIzaSy...',
    waGatewayUrl: 'https://api.fonnte.com/send',
    waToken: '••••••••••••••••'
  });

  const [systemPref, setSystemPref] = useState({
    defaultTheme: 'dark',
    autoBackup: true
  });

  // Load Settings dari Firestore saat Komponen Dimuat
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
  }, []);

  // Simpan Settings ke Firestore
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
      alert("Gagal menyimpan ke database Firestore. Periksa koneksi internet Anda.");
    }
    setSaving(false);
  };

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
          <Users className="w-4 h-4" /> Hak Akses Staf
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
                    Aktif (Free Tier)
                  </span>
                </div>
                <input
                  type="password"
                  value={apiData.geminiKey}
                  onChange={(e) => setApiData({...apiData, geminiKey: e.target.value})}
                  className={`w-full ${styles.inputBg} p-2.5 rounded-lg text-xs font-mono focus:outline-none focus:border-emerald-500`}
                />
                <p className={`text-[11px] ${styles.textSub}`}>Digunakan oleh modul WHI AI Executive Advisor untuk menganalisis data keuangan & jamaah.</p>
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
              <button
                type="button"
                className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                + Tambah Staf Baru
              </button>
            </div>

            <div className="space-y-3">
              <div className={`p-4 rounded-xl border ${styles.innerBg} flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl font-bold text-xs">
                    SA
                  </div>
                  <div>
                    <h5 className={`text-xs font-bold ${styles.textTitle}`}>Eksekutif WHI (Anda)</h5>
                    <p className={`text-[11px] ${styles.textSub}`}>admin@wisatahalal.co.id</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 text-[10px] bg-emerald-500/10 text-emerald-400 rounded-lg font-bold border border-emerald-500/20">
                    Super Admin
                  </span>
                  <span className={`text-xs ${styles.textSub}`}>Akses Penuh</span>
                </div>
              </div>

              <div className={`p-4 rounded-xl border ${styles.innerBg} flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/20 text-blue-400 rounded-xl font-bold text-xs">
                    FN
                  </div>
                  <div>
                    <h5 className={`text-xs font-bold ${styles.textTitle}`}>Staff Keuangan</h5>
                    <p className={`text-[11px] ${styles.textSub}`}>finance@wisatahalal.co.id</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 text-[10px] bg-blue-500/10 text-blue-400 rounded-lg font-bold border border-blue-500/20">
                    Finance
                  </span>
                  <span className={`text-xs ${styles.textSub}`}>Input Setoran & Vendor</span>
                </div>
              </div>

              <div className={`p-4 rounded-xl border ${styles.innerBg} flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-purple-500/20 text-purple-400 rounded-xl font-bold text-xs">
                    OP
                  </div>
                  <div>
                    <h5 className={`text-xs font-bold ${styles.textTitle}`}>Staff Operasional Jamaah</h5>
                    <p className={`text-[11px] ${styles.textSub}`}>ops@wisatahalal.co.id</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 text-[10px] bg-purple-500/10 text-purple-400 rounded-lg font-bold border border-purple-500/20">
                    Operational
                  </span>
                  <span className={`text-xs ${styles.textSub}`}>Dokumen, Bus & Kamar</span>
                </div>
              </div>
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
    </div>
  );
}
