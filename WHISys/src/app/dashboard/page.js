'use client';

import React, { useState, useEffect } from 'react';
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
  LogOut, 
  Plus, 
  Calendar,
  AlertCircle,
  ShieldCheck
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

// Module Imports
import PackagesModule from './PackagesModule';
import JamaahModule from './JamaahModule';
import BookingsModule from './BookingsModule';
import FinanceModule from './FinanceModule';
import AiAnalyzerModule from './AiAnalyzerModule';

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

  // Toggle Theme State (2 Mode: 'dark' atau 'light')
  const [theme, setTheme] = useState('dark');

  // State untuk navigasi antar modul
  const [selectedBookingForModal, setSelectedBookingForModal] = useState(null);

  // Load saved theme dari LocalStorage saat pertama kali dimuat
  useEffect(() => {
    const savedTheme = localStorage.getItem('whisys_theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    }
  }, []);

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
            setUserProfile({
              email: user.email,
              fullName: user.displayName || 'Staf WHI',
              role: 'admin' 
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
      
      {/* 1. SIDEBAR NAVIGASI ERP */}
      <aside className={`w-64 ${currentTheme.sidebar} border-r flex flex-col justify-between p-4 shrink-0 transition-colors duration-300`}>
        <div>
          <div className={`flex items-center gap-3 px-3 py-4 mb-6 border-b ${currentTheme.border}`}>
            <div className={`p-2 ${currentTheme.accentBg} rounded-lg text-white`}>
              <Plane className="w-6 h-6" />
            </div>
            <div>
              <h1 className={`font-bold text-lg ${currentTheme.accentText} leading-none`}>WHISys</h1>
              <span className={`text-xs ${currentTheme.subText}`}>Travel & Halal ERP</span>
            </div>
          </div>

          <nav className="space-y-1">
            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Core ERP System</p>
            
            <SidebarItem 
              icon={LayoutDashboard} 
              label="Dashboard Utama" 
              active={activeMenu === 'dashboard'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => { changeMenu('dashboard'); fetchDashboardData(); }} 
            />
            
            <SidebarItem 
              icon={Plane} 
              label="Paket Travel & LA" 
              active={activeMenu === 'packages'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => changeMenu('packages')} 
            />

            <SidebarItem 
              icon={Users} 
              label="Data Master Jamaah" 
              active={activeMenu === 'jamaah'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => changeMenu('jamaah')} 
            />

            <SidebarItem 
              icon={BookOpen} 
              label="Booking & Manifest" 
              active={activeMenu === 'bookings'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => changeMenu('bookings')} 
            />

            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2">Operasional Travel</p>
            
            <SidebarItem 
              icon={Wallet} 
              label="Keuangan & Pelunasan" 
              active={activeMenu === 'finance'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => changeMenu('finance')} 
            />

            <SidebarItem 
              icon={PackageCheck} 
              label="Perlengkapan Jamaah" 
              active={activeMenu === 'equipment'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => changeMenu('equipment')} 
            />

            <SidebarItem 
              icon={UserCheck} 
              label="Mitra & Agen" 
              active={activeMenu === 'agents'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => changeMenu('agents')} 
            />

            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2">Smart Assistant</p>

            <SidebarItem 
              icon={Sparkles} 
              label="AI Business Intelligence" 
              active={activeMenu === 'ai-analyzer'} 
              activeClass={currentTheme.activeMenu}
              subTextClass={currentTheme.subText}
              onClick={() => changeMenu('ai-analyzer')} 
            />
          </nav>
        </div>

        <div className={`border-t ${currentTheme.border} pt-4 flex items-center justify-between px-2`}>
          <div className="flex items-center gap-3 overflow-hidden">
            <div className={`w-8 h-8 rounded-full ${currentTheme.accentText} bg-emerald-500/10 flex items-center justify-center font-bold text-xs uppercase shrink-0`}>
              {userProfile?.role?.[0] || 'A'}
            </div>
            <div className="truncate">
              <p className={`text-sm font-medium ${currentTheme.headingText} truncate`}>{userProfile?.fullName || userProfile?.email}</p>
              <span className={`inline-flex items-center gap-1 text-[10px] ${currentTheme.accentText} font-semibold uppercase bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20`}>
                <ShieldCheck className="w-3 h-3" /> {userProfile?.role || 'Admin'}
              </span>
            </div>
          </div>
          <button 
            onClick={handleLogout} 
            className="text-slate-400 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-slate-800/10"
            title="Keluar / Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* 2. AREA KONTEN UTAMA */}
      <main className="flex-1 overflow-y-auto p-8">
        
        {/* HEADER BAR */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h2 className={`text-2xl font-bold ${currentTheme.headingText}`}>WHISys ERP Executive Board</h2>
            <p className={`${currentTheme.subText} text-sm`}>Sistem terpadu operasional Umrah, Haji, & Wisata Halal.</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-xs font-semibold ${
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
              className={`flex items-center gap-2 ${currentTheme.accentBg} text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg`}
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
        {activeMenu === 'packages' && <PackagesModule theme={theme} />}

        {/* MODUL MASTER DATA JAMAAH */}
        {activeMenu === 'jamaah' && <JamaahModule theme={theme} />}

        {/* MODUL BOOKING & MANIFEST */}
        {activeMenu === 'bookings' && (
          <BookingsModule targetBookingId={selectedBookingForModal} theme={theme} />
        )}

        {/* MODUL KEUANGAN & PELUNASAN */}
        {activeMenu === 'finance' && (
          <FinanceModule
            theme={theme}
            onSelectBooking={(bookingId) => {
              setSelectedBookingForModal(bookingId);
              changeMenu('bookings');
            }}
          />
        )}

        {/* MODUL AI BUSINESS INTELLIGENCE */}
        {activeMenu === 'ai-analyzer' && <AiAnalyzerModule theme={theme} />}

        {/* FALLBACK VIEW UNTUK MODUL LAIN */}
        {activeMenu !== 'dashboard' && 
         activeMenu !== 'packages' && 
         activeMenu !== 'jamaah' && 
         activeMenu !== 'bookings' && 
         activeMenu !== 'finance' && (
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
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, activeClass, subTextClass, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
        active 
          ? `${activeClass} shadow-md` 
          : `${subTextClass} hover:bg-emerald-500/10 hover:text-emerald-500`
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
