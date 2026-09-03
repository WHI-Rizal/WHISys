'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Plane,
  Users,
  BookOpen,
  Wallet,
  Sun,
  Moon,
  PackageCheck,
  UserCheck,
  Sparkles,
  Settings,
  LogOut,
  Plus,
  Calendar,
  AlertCircle,
  ShieldCheck,
  MessageSquareHeart,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  History,
  KeyRound,
  Eye,
  EyeOff
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import {
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from 'firebase/auth';
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { logActivity } from '../../lib/activityLog';

// Module Imports
import PackagesModule from './PackagesModule';
import JamaahModule from './JamaahModule';
import BookingsModule from './BookingsModule';
import FinanceModule from './FinanceModule';
import AiAnalyzerModule from './AiAnalyzerModule';
import SettingsModule from './SettingsModule';
import FeedbackModule from './FeedbackModule';
import EquipmentModule from './EquipmentModule';
import AgentsModule from './AgentsModule';
import ActivityLogModule from './ActivityLogModule';

const formatDateDDMMYYYY = (dateString) => {
  if (!dateString || dateString === '-') return '-';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export default function DashboardPage() {
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Salinan userProfile via ref — dipakai di dalam handleLogout &
  // handleAutoLogout (fungsi-fungsi yang closure-nya "beku" dari efek
  // ber-dependency []), biar log aktivitas "logout" tetap kebawa nama/role
  // user yang lagi login, bukan nilai userProfile basi dari awal mount.
  const userProfileRef = useRef(null);
  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  // Sinkron sama matriks akses di Firestore Security Rules: cuma Finance & Super
  // Admin yang boleh buka modul Keuangan. Ini gating tampilan doang (biar nggak
  // nyasar ke modul yang isinya bakal gagal dimuat) — penegaknya tetap Firestore
  // Rules di server, bukan pengecekan ini.
  const currentRole = (userProfile?.role || '').toLowerCase();
  const canAccessFinance = currentRole.includes('super') || currentRole === 'admin' || currentRole === 'finance';
  // Riwayat Aktivitas Sistem cuma boleh diliat Super Admin — sinkron sama
  // rules 'activity_logs' (allow read: if isSuperAdmin()).
  const canAccessActivityLog = currentRole.includes('super');

  // Toggle Theme State (2 Mode: 'dark' atau 'light')
  const [theme, setTheme] = useState('dark');

  // State untuk navigasi antar modul
  const [selectedBookingForModal, setSelectedBookingForModal] = useState(null);

  // Sidebar bisa di-collapse jadi rail ikon doang, biar area konten utama
  // (tabel-tabel yang lebar kayak Booking & Manifest) dapet ruang lebih luas.
  // Ini khusus buat layar desktop/tablet (md ke atas).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Di HP, sidebar-nya nggak "collapse jadi rail" kayak desktop — dia
  // disembunyiin total sebagai drawer yang meluncur dari kiri, dibuka lewat
  // tombol hamburger di topbar mobile. Beda state dari sidebarCollapsed
  // (yang cuma relevan buat desktop) biar kelakuannya independen.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Easter egg iseng-iseng: klik logo pesawat di sidebar/topbar bikin
  // ikonnya "terbang" sebentar terus balik lagi. Murni kosmetik doang.
  const [planeFlying, setPlaneFlying] = useState(false);
  const flyThePlane = () => {
    if (planeFlying) return;
    setPlaneFlying(true);
  };

  // ================ MODAL GANTI PASSWORD (SELF-SERVICE) ================
  // Setiap user yang lagi login (role apapun) bisa ganti password akunnya
  // sendiri dari sini — nggak perlu Super Admin. Firebase Auth mewajibkan
  // re-autentikasi (masukin password LAMA lagi) sebelum boleh updatePassword,
  // demi keamanan (jaga-jaga sesi login-nya udah lama / device dipinjem orang).
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
  const [changePasswordVisibility, setChangePasswordVisibility] = useState({ old: false, new: false, confirm: false });
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleOpenChangePasswordModal = () => {
    setChangePasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    setChangePasswordVisibility({ old: false, new: false, confirm: false });
    setShowChangePasswordModal(true);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (isChangingPassword) return;

    const { oldPassword, newPassword, confirmPassword } = changePasswordForm;
    if (!oldPassword || !newPassword || !confirmPassword) {
      alert("Semua kolom wajib diisi.");
      return;
    }
    if (newPassword.length < 6) {
      alert("Password baru minimal 6 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      alert("Konfirmasi password baru tidak sama dengan password baru.");
      return;
    }
    if (!auth.currentUser?.email) {
      alert("Sesi login tidak valid. Silakan login ulang.");
      return;
    }

    setIsChangingPassword(true);
    try {
      // Re-autentikasi wajib dari Firebase Auth sebelum boleh ganti password —
      // tanpa ini, updatePassword bakal ditolak dengan error auth/requires-recent-login.
      const credential = EmailAuthProvider.credential(auth.currentUser.email, oldPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPassword);

      logActivity({
        userId: auth.currentUser.uid,
        userName: userProfile?.fullName || auth.currentUser.email,
        userRole: userProfile?.role || 'Belum Diatur',
        action: 'update',
        module: 'Autentikasi',
        targetLabel: userProfile?.fullName || auth.currentUser.email,
        details: 'Mengganti password akun sendiri.'
      });

      alert("Password berhasil diganti.");
      setShowChangePasswordModal(false);
      setChangePasswordForm({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        alert("Password lama yang Anda masukkan salah.");
      } else if (err.code === 'auth/too-many-requests') {
        alert("Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.");
      } else {
        alert("Gagal mengganti password: " + err.message);
      }
    } finally {
      setIsChangingPassword(false);
    }
  };
  // ================ /MODAL GANTI PASSWORD (SELF-SERVICE) ================

  // Load saved theme & preferensi sidebar dari LocalStorage saat pertama kali dimuat
  useEffect(() => {
    const savedTheme = localStorage.getItem('whisys_theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    }
    const savedSidebar = localStorage.getItem('whisys_sidebar_collapsed');
    if (savedSidebar === '1') {
      setSidebarCollapsed(true);
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('whisys_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    localStorage.setItem('whisys_theme', newTheme);
  };

  // LOGIKA IDLE TIMEOUT AUTO LOGOUT (30 MENIT)
  useEffect(() => {
    const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 Menit
    let idleTimer;

    const handleAutoLogout = async () => {
      alert("Sesi Anda telah berakhir karena tidak ada aktivitas selama 30 menit. Silakan login kembali demi keamanan.");
      try {
        // Catat SEBELUM signOut — begitu signOut jalan, isLoggedIn() di
        // Firestore Rules langsung false, jadi tulisan log sesudahnya bakal
        // ditolak server.
        const profile = userProfileRef.current;
        if (auth.currentUser) {
          await logActivity({
            userId: auth.currentUser.uid,
            userName: profile?.fullName || auth.currentUser.email,
            userRole: profile?.role || 'Belum Diatur',
            action: 'logout',
            module: 'Autentikasi',
            targetLabel: profile?.fullName || auth.currentUser.email,
            details: 'Logout otomatis karena tidak ada aktivitas selama 30 menit.'
          });
        }
        await signOut(auth);
        window.location.href = '/login';
      } catch (err) {
        console.error("Gagal Auto Logout:", err);
      }
    };

    const resetTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(handleAutoLogout, IDLE_TIMEOUT_MS);
    };

    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];

    activityEvents.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      activityEvents.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, []);

  // Configuration Style untuk Dark Mode & Light Mode
  const themeStyles = {
    dark: {
      bg: 'bg-slate-950 text-slate-100',
      sidebar: 'bg-slate-900 border-slate-800',
      card: 'bg-slate-900 border-slate-800',
      headingText: 'text-white',
      subText: 'text-slate-400',
      accentText: 'text-emerald-400',
      accentBg: 'bg-emerald-600 hover:bg-emerald-500',
      activeMenu: 'bg-emerald-600 text-white shadow-emerald-900/20',
      border: 'border-slate-800',
      inputBg: 'bg-slate-950 text-slate-200 border-slate-800'
    },
    light: {
      bg: 'bg-slate-100 text-slate-800',
      sidebar: 'bg-white border-slate-200',
      card: 'bg-white border-slate-200 shadow-sm',
      headingText: 'text-slate-900',
      subText: 'text-slate-500',
      accentText: 'text-emerald-600',
      accentBg: 'bg-emerald-600 hover:bg-emerald-500',
      activeMenu: 'bg-emerald-600 text-white shadow-emerald-600/20',
      border: 'border-slate-200',
      inputBg: 'bg-white text-slate-800 border-slate-300'
    }
  };

  const currentTheme = themeStyles[theme];

  // Dynamic Real-time States dari Firestore
  const [realStats, setRealStats] = useState({
    totalJamaah: 0,
    totalPackages: 0,
    expiringPassportsCount: 0,
  });
  const [upcomingPackages, setUpcomingPackages] = useState([]);

  const changeMenu = (menuKey) => {
    setActiveMenu(menuKey);
    window.location.hash = menuKey;
    // Abis pilih menu di HP, drawer-nya otomatis ketutup lagi — biar nggak
    // nutupin konten yang baru dibuka.
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        setActiveMenu(hash);
      }
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const jamaahSnap = await getDocs(collection(db, 'jamaah'));
      const jamaahList = jamaahSnap.docs.map(doc => doc.data());

      const today = new Date();
      const sixMonths = new Date();
      sixMonths.setMonth(today.getMonth() + 6);

      const expiringCount = jamaahList.filter(j => {
        if (!j.passportExpiry) return false;
        return new Date(j.passportExpiry) < sixMonths;
      }).length;

      const bkSnap = await getDocs(collection(db, 'bookings'));
      const bookingsList = bkSnap.docs.map(doc => doc.data());

      const pkgQuery = query(collection(db, 'packages'), orderBy('departureDate', 'asc'), limit(5));
      const pkgSnap = await getDocs(pkgQuery);

      const pkgList = pkgSnap.docs.map(docSnap => {
        const pkgData = docSnap.data();
        const pkgId = docSnap.id;

        const bookedCount = bookingsList.filter(
          b => b.packageId === pkgId || b.packageName === pkgData.name
        ).length;

        const totalQuota = Number(pkgData.quotaTotal) || 0;
        const realRemaining = Math.max(0, totalQuota - bookedCount);

        return {
          id: pkgId,
          ...pkgData,
          computedRemaining: realRemaining
        };
      });

      setRealStats({
        totalJamaah: jamaahSnap.size,
        totalPackages: pkgSnap.size,
        expiringPassportsCount: expiringCount,
      });

      setUpcomingPackages(pkgList);
    } catch (err) {
      console.error("Gagal memuat statistik dashboard:", err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            setUserProfile(userDoc.data());
          } else {
            // PENTING: dulu fallback-nya 'admin' kalau dokumen user belum ada di
            // Firestore — artinya siapapun yang baru login otomatis kelihatan
            // punya akses penuh di tampilan. Sekarang default-nya paling rendah
            // (Belum Diatur / tanpa akses modul Keuangan & manajemen user), dan
            // Firestore Security Rules yang jadi penentu akses sebenarnya —
            // bukan tebakan di sisi browser ini.
            setUserProfile({
              email: user.email,
              fullName: user.displayName || 'Staf WHI',
              role: 'Belum Diatur',
              roleUnassigned: true
            });
          }
        } catch (error) {
          console.error("Gagal mengambil profil user:", error);
        }
        await fetchDashboardData();
      } else {
        window.location.href = '/login';
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      // Catat SEBELUM signOut, dengan alasan sama seperti handleAutoLogout.
      if (auth.currentUser) {
        await logActivity({
          userId: auth.currentUser.uid,
          userName: userProfile?.fullName || auth.currentUser.email,
          userRole: userProfile?.role || 'Belum Diatur',
          action: 'logout',
          module: 'Autentikasi',
          targetLabel: userProfile?.fullName || auth.currentUser.email,
          details: 'Logout manual dari sistem.'
        });
      }
      await signOut(auth);
      window.location.href = '/login';
    } catch (err) {
      console.error("Gagal Logout:", err);
    }
  };

  if (loading) {
    return (
      <div className={`flex h-screen ${currentTheme.bg} items-center justify-center font-sans`}>
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className={`${currentTheme.subText} text-sm`}>Memverifikasi Sesi & Memuat Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen ${currentTheme.bg} font-sans transition-colors duration-300`}>

      {/* BACKDROP — cuma muncul di HP (md:hidden) pas drawer sidebar lagi
          dibuka. Klik di luar sidebar = nutup drawer-nya lagi. */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* TOPBAR MOBILE — cuma tampil di layar kecil (md:hidden), gantiin
          sidebar yang di HP disembunyiin total. Isinya tombol hamburger buat
          buka drawer, plus logo ringkas. */}
      <div className={`md:hidden fixed top-0 left-0 right-0 z-20 ${currentTheme.sidebar} border-b flex items-center justify-between px-4 py-3`}>
        <button
          onClick={() => setMobileMenuOpen(true)}
          className={`p-1.5 rounded-lg ${currentTheme.subText} hover:${currentTheme.accentText} hover:bg-emerald-500/10 transition-colors`}
          title="Buka Menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 ${currentTheme.accentBg} rounded-lg text-white shrink-0 whisys-plane-trigger`}
            onClick={flyThePlane}
            title="Klik dulu deh, hehe"
          >
            <Plane className={`w-4 h-4 ${planeFlying ? 'whisys-plane-flying' : ''}`} onAnimationEnd={() => setPlaneFlying(false)} />
          </div>
          <span className={`font-bold text-sm ${currentTheme.accentText}`}>WHISys</span>
        </div>
        <button
          onClick={toggleTheme}
          className={`p-1.5 rounded-lg ${currentTheme.subText} hover:${currentTheme.accentText} hover:bg-emerald-500/10 transition-colors`}
          title="Ganti Tema"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5 text-indigo-600" />}
        </button>
      </div>

      {/* 1. SIDEBAR NAVIGASI ERP — di desktop/tablet (md ke atas) bisa
          di-collapse jadi rail ikon doang lewat tombol panah di pojok kanan
          atas sidebar, biar konten utama (tabel lebar kayak Booking &
          Manifest) dapet ruang lebih luas. Di HP, sidebar ini jadi drawer
          yang meluncur dari kiri (posisi fixed, di luar layar kalau ketutup),
          dibuka lewat tombol hamburger di topbar mobile di atas. */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-300
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0 md:z-0
        ${sidebarCollapsed ? 'md:w-[68px]' : 'md:w-64'}
        ${currentTheme.sidebar} border-r flex flex-col justify-between p-4 shrink-0 md:transition-all
      `}>
        {/* Tombol tutup drawer — cuma keliatan di HP */}
        <button
          onClick={() => setMobileMenuOpen(false)}
          className={`md:hidden absolute right-3 top-3 w-7 h-7 rounded-full border ${currentTheme.border} ${currentTheme.sidebar} flex items-center justify-center ${currentTheme.subText}`}
          title="Tutup Menu"
        >
          <X className="w-4 h-4" />
        </button>
        {/* Tombol collapse rail — cuma keliatan di desktop/tablet */}
        <button
          onClick={toggleSidebar}
          className={`hidden md:flex absolute -right-3 top-8 z-10 w-6 h-6 rounded-full border ${currentTheme.border} ${currentTheme.sidebar} items-center justify-center ${currentTheme.subText} hover:${currentTheme.accentText} transition-colors shadow-sm`}
          title={sidebarCollapsed ? 'Buka Sidebar' : 'Tutup Sidebar'}
        >
          {sidebarCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        <div className="overflow-y-auto hide-scrollbar">
          <div className={`flex items-center gap-3 px-3 py-4 mb-6 border-b ${currentTheme.border} ${sidebarCollapsed ? 'md:justify-center md:px-0' : ''}`}>
            <div
              className={`p-2 ${currentTheme.accentBg} rounded-lg text-white shrink-0 whisys-plane-trigger`}
              onClick={flyThePlane}
              title="Klik dulu deh, hehe"
            >
              <Plane className={`w-6 h-6 ${planeFlying ? 'whisys-plane-flying' : ''}`} onAnimationEnd={() => setPlaneFlying(false)} />
            </div>
            <div className={sidebarCollapsed ? 'md:hidden' : ''}>
              <h1 className={`font-bold text-lg ${currentTheme.accentText} leading-none`}>Wisata Halal Internasional</h1>
              <span className={`text-xs ${currentTheme.subText}`}>ERP SYSTEM</span>
            </div>
          </div>

          <nav className="space-y-1">
            <p className={`px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 ${sidebarCollapsed ? 'md:hidden' : ''}`}>Core ERP System</p>

            <SidebarItem
              icon={LayoutDashboard}
              label="Dashboard Utama"
              menuKey="dashboard"
              active={activeMenu === 'dashboard'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => { changeMenu('dashboard'); fetchDashboardData(); }}
            />

            <SidebarItem
              icon={Plane}
              label="Paket Travel & LA"
              menuKey="packages"
              active={activeMenu === 'packages'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('packages')}
            />

            <SidebarItem
              icon={Users}
              label="Data Master Jamaah"
              menuKey="jamaah"
              active={activeMenu === 'jamaah'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('jamaah')}
            />

            <SidebarItem
              icon={BookOpen}
              label="Booking & Manifest"
              menuKey="bookings"
              active={activeMenu === 'bookings'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('bookings')}
            />

            <p className={`px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2 ${sidebarCollapsed ? 'md:hidden' : ''}`}>Operasional Travel</p>

            {canAccessFinance && (
              <SidebarItem
                icon={Wallet}
                label="Keuangan & Pelunasan"
                menuKey="finance"
                active={activeMenu === 'finance'}
                activeClass={currentTheme.activeMenu}
                subTextClass={currentTheme.subText}
                collapsed={sidebarCollapsed}
                onClick={() => changeMenu('finance')}
              />
            )}

            <SidebarItem
              icon={MessageSquareHeart}
              label="Feedback & Ulasan"
              menuKey="feedback"
              active={activeMenu === 'feedback'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('feedback')}
            />

            <SidebarItem
              icon={PackageCheck}
              label="Perlengkapan Jamaah"
              menuKey="equipment"
              active={activeMenu === 'equipment'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('equipment')}
            />

            <SidebarItem
              icon={UserCheck}
              label="Mitra & Agen"
              menuKey="agents"
              active={activeMenu === 'agents'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('agents')}
            />

            <p className={`px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2 ${sidebarCollapsed ? 'md:hidden' : ''}`}>Smart Assistant & Config</p>

            <SidebarItem
              icon={Sparkles}
              label="AI Business Intelligence"
              menuKey="ai-analyzer"
              active={activeMenu === 'ai-analyzer'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('ai-analyzer')}
            />

            <SidebarItem
              icon={Settings}
              label="Pengaturan Sistem"
              menuKey="settings"
              active={activeMenu === 'settings'}
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              collapsed={sidebarCollapsed}
              onClick={() => changeMenu('settings')}
            />

            {canAccessActivityLog && (
              <SidebarItem
                icon={History}
                label="Log Aktivitas Sistem"
                menuKey="activity-log"
                active={activeMenu === 'activity-log'}
                activeClass={currentTheme.activeMenu}
                subTextClass={currentTheme.subText}
                collapsed={sidebarCollapsed}
                onClick={() => changeMenu('activity-log')}
              />
            )}
          </nav>
        </div>

        <div className={`border-t ${currentTheme.border} pt-4 flex items-center justify-between px-2 ${sidebarCollapsed ? 'md:flex-col md:items-center md:gap-2 md:px-0' : ''}`}>
          <div className={`flex items-center gap-3 overflow-hidden ${sidebarCollapsed ? 'md:justify-center' : ''}`}>
            <div className={`w-8 h-8 rounded-full ${currentTheme.accentText} bg-emerald-500/10 flex items-center justify-center font-bold text-xs uppercase shrink-0`} title={userProfile?.fullName || userProfile?.email}>
              {userProfile?.role?.[0] || 'A'}
            </div>
            <div className={`truncate ${sidebarCollapsed ? 'md:hidden' : ''}`}>
              <p className={`text-sm font-medium ${currentTheme.headingText} truncate`}>{userProfile?.fullName || userProfile?.email}</p>
              <span className={`inline-flex items-center gap-1 text-[10px] ${currentTheme.accentText} font-semibold uppercase bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20`}>
                <ShieldCheck className="w-3 h-3" /> {userProfile?.role || 'Admin'}
              </span>
            </div>
          </div>
          <div className={`flex items-center ${sidebarCollapsed ? 'md:flex-col md:gap-1' : 'gap-1'}`}>
            <button
              onClick={handleOpenChangePasswordModal}
              className="text-slate-400 hover:text-emerald-400 transition-colors p-1.5 rounded-lg hover:bg-slate-800/10"
              title="Ganti Password"
            >
              <KeyRound className="w-5 h-5" />
            </button>
            <button
              onClick={handleLogout}
              className="text-slate-400 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-slate-800/10"
              title="Keluar / Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* 2. AREA KONTEN UTAMA — padding-top ekstra di HP (pt-20) buat ngasih
          ruang ke topbar mobile yang posisinya fixed di atas, nggak perlu di
          desktop (md:pt-8) karena topbar mobile-nya emang disembunyiin. */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-20 pb-4 sm:p-6 md:p-8 w-full min-w-0">

        {/* HEADER BAR */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 md:mb-8">
          <div>
            <h2 className={`text-xl md:text-2xl font-bold ${currentTheme.headingText}`}>WHISys ERP Executive Board</h2>
            <p className={`${currentTheme.subText} text-xs md:text-sm`}>Sistem terpadu operasional Umrah, Haji, & Wisata Halal.</p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Toggle tema ini disembunyiin di HP (md:flex) — di layar kecil
                udah ada tombol yang sama di topbar mobile, nggak perlu dobel. */}
            <button
              onClick={toggleTheme}
              className={`hidden md:flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-xs font-semibold ${
                theme === 'dark'
                  ? 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-800'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 shadow-sm'
              }`}
              title={theme === 'dark' ? 'Ganti ke Mode Terang (Light Mode)' : 'Ganti ke Mode Gelap (Dark Mode)'}
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-amber-400" />
                  <span>Mode Terang</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-indigo-600" />
                  <span>Mode Gelap</span>
                </>
              )}
            </button>

            <button
              onClick={() => changeMenu('jamaah')}
              className={`flex items-center justify-center gap-2 ${currentTheme.accentBg} text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg w-full sm:w-auto`}
            >
              <Plus className="w-4 h-4" /> Register Jamaah Baru
            </button>
          </div>
        </header>

        {/* DASHBOARD UTAMA VIEW */}
        {activeMenu === 'dashboard' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              <div className={`${currentTheme.card} p-5 rounded-xl flex items-center justify-between border transition-colors`}>
                <div>
                  <p className={`text-xs font-medium ${currentTheme.subText} mb-1`}>Total Jamaah Terdaftar</p>
                  <h3 className={`text-2xl font-bold ${currentTheme.headingText}`}>{realStats.totalJamaah} Orang</h3>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400">
                  <Users className="w-6 h-6" />
                </div>
              </div>

              <div className={`${currentTheme.card} p-5 rounded-xl flex items-center justify-between border transition-colors`}>
                <div>
                  <p className={`text-xs font-medium ${currentTheme.subText} mb-1`}>Group & Paket Keberangkatan</p>
                  <h3 className={`text-2xl font-bold ${currentTheme.accentText}`}>{realStats.totalPackages} Program</h3>
                </div>
                <div className={`p-3 rounded-lg bg-emerald-500/10 ${currentTheme.accentText}`}>
                  <Plane className="w-6 h-6" />
                </div>
              </div>

              <div className={`${currentTheme.card} p-5 rounded-xl flex items-center justify-between border transition-colors`}>
                <div>
                  <p className={`text-xs font-medium ${currentTheme.subText} mb-1`}>Paspor &lt; 6 Bulan Expired</p>
                  <h3 className="text-2xl font-bold text-amber-400">{realStats.expiringPassportsCount} Paspor</h3>
                </div>
                <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
              </div>

              <div className={`${currentTheme.card} p-5 rounded-xl flex items-center justify-between border transition-colors`}>
                <div>
                  <p className={`text-xs font-medium ${currentTheme.subText} mb-1`}>Status Sistem</p>
                  <h3 className={`text-lg font-bold ${currentTheme.accentText}`}>Firestore Connected</h3>
                </div>
                <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className={`lg:col-span-2 ${currentTheme.card} border rounded-xl p-6 transition-colors`}>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className={`font-bold ${currentTheme.headingText} flex items-center gap-2`}>
                      <Calendar className={`w-5 h-5 ${currentTheme.accentText}`} /> Program Keberangkatan Mendatang
                    </h3>
                    <p className={`text-xs ${currentTheme.subText}`}>Data terhubung langsung dari modul Paket Travel</p>
                  </div>
                  <button onClick={() => changeMenu('packages')} className={`text-xs ${currentTheme.accentText} hover:underline`}>
                    + Buat Paket Baru
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {upcomingPackages.length === 0 ? (
                    <div className={`p-8 text-center ${currentTheme.subText} text-xs border border-dashed ${currentTheme.border} rounded-lg`}>
                      Belum ada paket travel terdaftar di database.
                    </div>
                  ) : (
                    <table className={`w-full text-left text-sm ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                      <thead className={`${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'} ${currentTheme.subText} text-xs uppercase`}>
                        <tr>
                          <th className="p-3 rounded-l-lg">Kode / Paket</th>
                          <th className="p-3">Tanggal</th>
                          <th className="p-3">Maskapai</th>
                          <th className="p-3 rounded-r-lg">Sisa Seat</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${theme === 'dark' ? 'divide-white/5' : 'divide-slate-200'} text-xs`}>
                        {upcomingPackages.map((pkg) => (
                          <tr key={pkg.id} className={`${theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-slate-50'} transition-colors`}>
                            <td className={`p-3 font-semibold ${currentTheme.headingText}`}>
                              {pkg.name}
                              <span className={`block text-[10px] font-normal ${currentTheme.subText}`}>{pkg.code}</span>
                            </td>
                            <td className="p-3">{formatDateDDMMYYYY(pkg.departureDate)}</td>
                            <td className="p-3">{pkg.airline}</td>
                            <td className={`p-3 font-semibold ${currentTheme.accentText}`}>
                              {pkg.computedRemaining} / {pkg.quotaTotal}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className={`${currentTheme.card} border rounded-xl p-6 flex flex-col justify-between transition-colors`}>
                <div>
                  <h3 className={`font-bold ${currentTheme.headingText} mb-4 flex items-center gap-2`}>
                    <AlertCircle className="w-5 h-5 text-amber-400" /> Peringatan Sistem
                  </h3>

                  <div className="space-y-4">
                    {realStats.expiringPassportsCount > 0 ? (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs">
                        <p className="font-semibold text-amber-500 mb-1">{realStats.expiringPassportsCount} Paspor Perlu Perpanjangan</p>
                        <p className={currentTheme.subText}>Ada paspor jamaah yang akan expired kurang dari 6 bulan.</p>
                      </div>
                    ) : (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
                        <p className="font-semibold text-emerald-500 mb-1">Masa Berlaku Paspor Aman</p>
                        <p className={currentTheme.subText}>Tidak ada paspor jamaah yang mendekati masa kadaluarsa.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className={`mt-6 pt-4 border-t ${currentTheme.border} text-center`}>
                  <span className={`text-xs ${currentTheme.subText}`}>WHISys ERP Platform • Live Firestore DB</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* MODUL PAKET TRAVEL & LA */}
        {activeMenu === 'packages' && <PackagesModule theme={theme} userRole={userProfile?.role} currentUser={userProfile} />}

        {/* MODUL MASTER DATA JAMAAH */}
        {activeMenu === 'jamaah' && <JamaahModule theme={theme} userRole={userProfile?.role} currentUser={userProfile} />}

        {/* MODUL BOOKING & MANIFEST */}
        {activeMenu === 'bookings' && (
          <BookingsModule targetBookingId={selectedBookingForModal} theme={theme} userRole={userProfile?.role} currentUser={userProfile} />
        )}

        {/* MODUL KEUANGAN & PELUNASAN — dibatasi Finance & Super Admin, sinkron sama Firestore Rules */}
        {activeMenu === 'finance' && !canAccessFinance && (
          <div className={`${currentTheme.card} border ${currentTheme.border} rounded-xl p-8 text-center`}>
            <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-amber-500" />
            <h3 className={`text-sm font-bold ${currentTheme.headingText} mb-1`}>Akses Terbatas</h3>
            <p className={`text-xs ${currentTheme.subText}`}>
              Modul Keuangan cuma bisa diakses role Finance & Super Admin. Hubungi Super Admin kalau kamu butuh akses ini.
            </p>
          </div>
        )}
        {activeMenu === 'finance' && canAccessFinance && (
          <FinanceModule
            theme={theme}
            currentUser={userProfile}
            onSelectBooking={(bookingId) => {
              setSelectedBookingForModal(bookingId);
              changeMenu('bookings');
            }}
          />
        )}

        {/* MODUL AI BUSINESS INTELLIGENCE */}
        {activeMenu === 'ai-analyzer' && <AiAnalyzerModule theme={theme} />}

        {/* MODUL FEEDBACK & ULASAN */}
        {activeMenu === 'feedback' && <FeedbackModule theme={theme} />}

        {/* MODUL PERLENGKAPAN JAMAAH */}
        {activeMenu === 'equipment' && <EquipmentModule theme={theme} />}

        {/* MODUL MITRA & AGEN */}
        {activeMenu === 'agents' && <AgentsModule theme={theme} userRole={userProfile?.role} />}

        {/* MODUL PENGATURAN SISTEM */}
        {activeMenu === 'settings' && <SettingsModule theme={theme} currentUser={userProfile} />}

        {/* MODUL LOG AKTIVITAS SISTEM — dibatasi Super Admin, sinkron sama Firestore Rules (activity_logs: allow read: if isSuperAdmin()) */}
        {activeMenu === 'activity-log' && !canAccessActivityLog && (
          <div className={`${currentTheme.card} border ${currentTheme.border} rounded-xl p-8 text-center`}>
            <ShieldCheck className="w-8 h-8 mx-auto mb-3 text-amber-500" />
            <h3 className={`text-sm font-bold ${currentTheme.headingText} mb-1`}>Akses Terbatas</h3>
            <p className={`text-xs ${currentTheme.subText}`}>
              Log Aktivitas Sistem cuma bisa diakses Super Admin.
            </p>
          </div>
        )}
        {activeMenu === 'activity-log' && canAccessActivityLog && (
          <ActivityLogModule theme={theme} />
        )}

        {/* FALLBACK VIEW UNTUK MODUL LAIN */}
        {activeMenu !== 'dashboard' &&
         activeMenu !== 'packages' &&
         activeMenu !== 'jamaah' &&
         activeMenu !== 'bookings' &&
         activeMenu !== 'finance' &&
         activeMenu !== 'ai-analyzer' &&
         activeMenu !== 'feedback' &&
         activeMenu !== 'equipment' &&
         activeMenu !== 'agents' &&
         activeMenu !== 'settings' &&
         activeMenu !== 'activity-log' && (
          <div className={`${currentTheme.card} border rounded-xl p-12 text-center`}>
            <div className={`p-4 ${theme === 'dark' ? 'bg-white/5' : 'bg-slate-100'} ${currentTheme.subText} w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center`}>
              <Plane className="w-8 h-8" />
            </div>
            <h3 className={`text-xl font-bold ${currentTheme.headingText} mb-2`}>Modul {activeMenu.toUpperCase()}</h3>
            <p className={`${currentTheme.subText} text-sm max-w-md mx-auto`}>
              Fitur ERP ini sedang disiapkan untuk menghubungkan data langsung ke koleksi Firebase Firestore WHISys.
            </p>
          </div>
        )}

      </main>

      {/* MODAL GANTI PASSWORD (SELF-SERVICE) — bisa dibuka user role apapun
          lewat ikon kunci di pojok kiri bawah sidebar, di sebelah tombol Logout. */}
      {showChangePasswordModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className={`${currentTheme.card} border rounded-2xl w-full max-w-sm p-6 relative`}>
            <button
              onClick={() => setShowChangePasswordModal(false)}
              className={`absolute right-4 top-4 ${currentTheme.subText} hover:${currentTheme.headingText}`}
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className={`text-lg font-bold ${currentTheme.headingText} mb-1 flex items-center gap-2`}>
              <KeyRound className="w-5 h-5 text-emerald-500" /> Ganti Password
            </h3>
            <p className={`text-xs ${currentTheme.subText} mb-5`}>
              Masukkan password lama Anda dulu sebagai verifikasi, lalu password baru.
            </p>

            <form onSubmit={handleChangePassword} className="space-y-3 text-xs">
              <div>
                <label className={`block mb-1 font-medium ${currentTheme.subText}`}>Password Lama</label>
                <div className="relative">
                  <input
                    type={changePasswordVisibility.old ? 'text' : 'password'}
                    required
                    value={changePasswordForm.oldPassword}
                    onChange={e => setChangePasswordForm({ ...changePasswordForm, oldPassword: e.target.value })}
                    className={`w-full ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'} border rounded-lg pl-3 pr-10 py-2.5 focus:outline-none focus:border-emerald-500`}
                  />
                  <button
                    type="button"
                    onClick={() => setChangePasswordVisibility(v => ({ ...v, old: !v.old }))}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${currentTheme.subText}`}
                    tabIndex={-1}
                  >
                    {changePasswordVisibility.old ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className={`block mb-1 font-medium ${currentTheme.subText}`}>Password Baru</label>
                <div className="relative">
                  <input
                    type={changePasswordVisibility.new ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={changePasswordForm.newPassword}
                    onChange={e => setChangePasswordForm({ ...changePasswordForm, newPassword: e.target.value })}
                    className={`w-full ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'} border rounded-lg pl-3 pr-10 py-2.5 focus:outline-none focus:border-emerald-500`}
                  />
                  <button
                    type="button"
                    onClick={() => setChangePasswordVisibility(v => ({ ...v, new: !v.new }))}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${currentTheme.subText}`}
                    tabIndex={-1}
                  >
                    {changePasswordVisibility.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className={`mt-1 text-[10px] ${currentTheme.subText} opacity-70`}>Minimal 6 karakter.</p>
              </div>

              <div>
                <label className={`block mb-1 font-medium ${currentTheme.subText}`}>Konfirmasi Password Baru</label>
                <div className="relative">
                  <input
                    type={changePasswordVisibility.confirm ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={changePasswordForm.confirmPassword}
                    onChange={e => setChangePasswordForm({ ...changePasswordForm, confirmPassword: e.target.value })}
                    className={`w-full ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'} border rounded-lg pl-3 pr-10 py-2.5 focus:outline-none focus:border-emerald-500`}
                  />
                  <button
                    type="button"
                    onClick={() => setChangePasswordVisibility(v => ({ ...v, confirm: !v.confirm }))}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 ${currentTheme.subText}`}
                    tabIndex={-1}
                  >
                    {changePasswordVisibility.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isChangingPassword}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-semibold transition-all mt-2"
              >
                {isChangingPassword ? 'Menyimpan...' : 'Simpan Password Baru'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, activeClass, subTextClass, collapsed, onClick, menuKey }) {
  // "collapsed" (rail ikon doang, tanpa teks label) itu konsep KHUSUS
  // desktop/tablet (md ke atas) — di HP, sidebar-nya jadi drawer full-width
  // yang selalu nampilin label penuh, apapun status collapsed-nya di
  // desktop. Makanya class "sembunyiin label"-nya dikasih prefix md: biar
  // cuma ngefek di layar gede, dan labelnya tetap DI-RENDER (bukan
  // dihilangin dari DOM) supaya bisa dikontrol lewat CSS per breakpoint.
  //
  // Dipakai <a href="#menuKey"> (bukan <button>) supaya menu ini beneran
  // jadi link kayak halaman web pada umumnya — bisa diklik kanan > Buka
  // di Tab Baru, dibuka pakai klik tengah/ctrl+klik, dsb. onClick tetap
  // jalan seperti biasa buat urusan state (ganti activeMenu, tutup drawer
  // HP, side-effect kayak fetchDashboardData) begitu link-nya diklik biasa.
  return (
    <a
      href={`#${menuKey}`}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer ${collapsed ? 'md:justify-center md:px-0' : ''} ${
        active
          ? `${activeClass} shadow-md`
          : `${subTextClass} hover:bg-emerald-500/10 hover:text-emerald-500`
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
    </a>
  );
}
