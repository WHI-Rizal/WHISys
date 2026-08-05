'use client';

import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Plane, 
  Users, 
  BookOpen, 
  Wallet, 
  PackageCheck, 
  UserCheck, 
  Sparkles,
  LogOut, 
  Plus, 
  Search,
  Calendar,
  AlertCircle,
  ShieldCheck
} from 'lucide-react';
import { auth, db } from '../../lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import PackagesModule from './PackagesModule';
import JamaahModule from './JamaahModule';
import BookingsModule from './BookingsModule';

export default function DashboardPage() {
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Dynamic Real-time States dari Firestore
  const [realStats, setRealStats] = useState({
    totalJamaah: 0,
    totalPackages: 0,
    expiringPassportsCount: 0,
  });
  const [upcomingPackages, setUpcomingPackages] = useState([]);

  // Fetch Data Real dari Firestore
  const fetchDashboardData = async () => {
    try {
      // 1. Fetch Jamaah Data
      const jamaahSnap = await getDocs(collection(db, 'jamaah'));
      const jamaahList = jamaahSnap.docs.map(doc => doc.data());
      
      // Hitung Paspor Expired < 6 bulan
      const today = new Date();
      const sixMonths = new Date();
      sixMonths.setMonth(today.getMonth() + 6);

      const expiringCount = jamaahList.filter(j => {
        if (!j.passportExpiry) return false;
        return new Date(j.passportExpiry) < sixMonths;
      }).length;

      // 2. Fetch Keberangkatan Terdekat dari Packages
      const pkgQuery = query(collection(db, 'packages'), orderBy('departureDate', 'asc'), limit(5));
      const pkgSnap = await getDocs(pkgQuery);
      const pkgList = pkgSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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

  // Load Profil User & Data Dashboard
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
      <div className="flex h-screen bg-slate-950 text-slate-100 items-center justify-center font-sans">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-400 text-sm">Memverifikasi Sesi & Memuat Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans">
      
      {/* 1. SIDEBAR NAVIGASI ERP */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-4 shrink-0">
        <div>
          <div className="flex items-center gap-3 px-3 py-4 mb-6 border-b border-slate-800">
            <div className="p-2 bg-emerald-600 rounded-lg">
              <Plane className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-emerald-400 leading-none">WHISys</h1>
              <span className="text-xs text-slate-400">Travel & Halal ERP</span>
            </div>
          </div>

          <nav className="space-y-1">
            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Core ERP System</p>
            
            <SidebarItem 
              icon={LayoutDashboard} 
              label="Dashboard Utama" 
              active={activeMenu === 'dashboard'} 
              onClick={() => { setActiveMenu('dashboard'); fetchDashboardData(); }} 
            />
            
            <SidebarItem 
              icon={Plane} 
              label="Paket Travel & LA" 
              active={activeMenu === 'packages'} 
              onClick={() => setActiveMenu('packages')} 
            />

            <SidebarItem 
              icon={Users} 
              label="Data Master Jamaah" 
              active={activeMenu === 'jamaah'} 
              onClick={() => setActiveMenu('jamaah')} 
            />

            <SidebarItem 
              icon={BookOpen} 
              label="Booking & Manifest" 
              active={activeMenu === 'bookings'} 
              onClick={() => setActiveMenu('bookings')} 
            />

            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2">Operasional Travel</p>
            
            <SidebarItem 
              icon={Wallet} 
              label="Keuangan & Pelunasan" 
              active={activeMenu === 'finance'} 
              onClick={() => setActiveMenu('finance')} 
            />

            <SidebarItem 
              icon={PackageCheck} 
              label="Perlengkapan Jamaah" 
              active={activeMenu === 'equipment'} 
              onClick={() => setActiveMenu('equipment')} 
            />

            <SidebarItem 
              icon={UserCheck} 
              label="Mitra & Agen" 
              active={activeMenu === 'agents'} 
              onClick={() => setActiveMenu('agents')} 
            />

            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2">Smart Assistant</p>
            <SidebarItem 
              icon={Sparkles} 
              label="AI Business Intelligence" 
              active={activeMenu === 'ai-analyzer'} 
              onClick={() => setActiveMenu('ai-analyzer')} 
            />
          </nav>
        </div>

        <div className="border-t border-slate-800 pt-4 flex items-center justify-between px-2">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs uppercase shrink-0">
              {userProfile?.role?.[0] || 'A'}
            </div>
            <div className="truncate">
              <p className="text-sm font-medium text-slate-200 truncate">{userProfile?.fullName || userProfile?.email}</p>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold uppercase bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                <ShieldCheck className="w-3 h-3" /> {userProfile?.role || 'Admin'}
              </span>
            </div>
          </div>
          <button 
            onClick={handleLogout} 
            className="text-slate-400 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-slate-800"
            title="Keluar / Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* 2. AREA KONTEN UTAMA */}
      <main className="flex-1 overflow-y-auto bg-slate-950 p-8">
        
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">WHISys ERP Executive Board</h2>
            <p className="text-slate-400 text-sm">Sistem terpadu operasional Umrah, Haji, & Wisata Halal.</p>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setActiveMenu('jamaah')}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/30"
            >
              <Plus className="w-4 h-4" /> Register Jamaah Baru
            </button>
          </div>
        </header>

        {/* DASHBOARD UTAMA VIEW */}
        {activeMenu === 'dashboard' && (
          <>
            {/* Real Stat Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Total Jamaah Terdaftar</p>
                  <h3 className="text-2xl font-bold text-white">{realStats.totalJamaah} Orang</h3>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400">
                  <Users className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Group & Paket Keberangkatan</p>
                  <h3 className="text-2xl font-bold text-white">{realStats.totalPackages} Program</h3>
                </div>
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Plane className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Paspor &lt; 6 Bulan Expired</p>
                  <h3 className="text-2xl font-bold text-amber-400">{realStats.expiringPassportsCount} Paspor</h3>
                </div>
                <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400">
                  <AlertCircle className="w-6 h-6" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Status Sistem</p>
                  <h3 className="text-lg font-bold text-emerald-400">Firestore Connected</h3>
                </div>
                <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* Layout: Table Keberangkatan Terdekat */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="font-bold text-white flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-emerald-400" /> Program Keberangkatan Mendatang
                    </h3>
                    <p className="text-xs text-slate-400">Data terhubung langsung dari modul Paket Travel</p>
                  </div>
                  <button onClick={() => setActiveMenu('packages')} className="text-xs text-emerald-400 hover:underline">
                    + Buat Paket Baru
                  </button>
                </div>

                <div className="overflow-x-auto">
                  {upcomingPackages.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-lg">
                      Belum ada paket travel terdaftar di database.
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                        <tr>
                          <th className="p-3 rounded-l-lg">Kode / Paket</th>
                          <th className="p-3">Tanggal</th>
                          <th className="p-3">Maskapai</th>
                          <th className="p-3 rounded-r-lg">Sisa Seat</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 text-xs">
                        {upcomingPackages.map((pkg) => (
                          <tr key={pkg.id} className="hover:bg-slate-800/30 transition-colors">
                            <td className="p-3 font-semibold text-white">
                              {pkg.name}
                              <span className="block text-[10px] font-normal text-slate-400">{pkg.code}</span>
                            </td>
                            <td className="p-3">{pkg.departureDate}</td>
                            <td className="p-3">{pkg.airline}</td>
                            <td className="p-3 font-medium text-emerald-400">{pkg.quotaRemaining} / {pkg.quotaTotal}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Alert Operations */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-400" /> Peringatan Sistem
                  </h3>
                  
                  <div className="space-y-4">
                    {realStats.expiringPassportsCount > 0 ? (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs">
                        <p className="font-semibold text-amber-400 mb-1">{realStats.expiringPassportsCount} Paspor Perlu Perpanjangan</p>
                        <p className="text-slate-300">Ada paspor jamaah yang akan expired kurang dari 6 bulan.</p>
                      </div>
                    ) : (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs">
                        <p className="font-semibold text-emerald-400 mb-1">Masa Berlaku Paspor Aman</p>
                        <p className="text-slate-300">Tidak ada paspor jamaah yang mendekati masa kadaluarsa.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                  <span className="text-xs text-slate-500">WHISys ERP Platform • Live Firestore DB</span>
                </div>
              </div>

            </div>
          </>
        )}

        {/* MODUL PAKET TRAVEL & LA */}
        {activeMenu === 'packages' && <PackagesModule />}

        {/* MODUL MASTER DATA JAMAAH */}
        {activeMenu === 'jamaah' && <JamaahModule />}

        {/* MODUL BOOKING & MANIFEST */}
        {activeMenu === 'bookings' && <BookingsModule />}

        {/* FALLBACK VIEW UNTUK MODUL LAIN */}
        {activeMenu !== 'dashboard' && activeMenu !== 'packages' && activeMenu !== 'jamaah' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
            <div className="p-4 bg-emerald-500/10 text-emerald-400 w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <Plane className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Modul {activeMenu.toUpperCase()}</h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              Fitur ERP ini sedang disiapkan untuk menghubungkan data langsung ke koleksi Firebase Firestore WHISys.
            </p>
          </div>
        )}

      </main>
    </div>
  );
}

function SidebarItem({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
        active 
          ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/20' 
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
