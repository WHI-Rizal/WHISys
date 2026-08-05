'use client';

import React, { useState } from 'react';
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
  AlertCircle
} from 'lucide-react';

export default function DashboardPage() {
  const [activeMenu, setActiveMenu] = useState('dashboard');

  // Ringkasan Statistik Utama ERP
  const stats = [
    { title: 'Total Jamaah Active', value: '342 Orang', icon: Users, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { title: 'Group Keberangkatan', value: '12 Group', icon: Plane, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { title: 'Pending Pelunasan', value: 'Rp 450M', icon: Wallet, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { title: 'Koper & Perlengkapan', value: '88 Pcs Pending', icon: PackageCheck, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ];

  // Data Keberangkatan Terdekat
  const upcomingDepartures = [
    { code: 'UMR-VIP-DEC26', name: 'Umrah Akhir Tahun VIP', date: '2026-12-20', airline: 'Saudi Airlines', seats: '38/45', status: 'Ready' },
    { code: 'HAL-TURK-OCT26', name: 'Wisata Halal Turki 10D', date: '2026-10-15', airline: 'Turkish Airlines', seats: '20/25', status: 'Processing Visa' },
    { code: 'HAJ-FUR-2027', name: 'Haji Furoda Khusus 2027', date: '2027-05-10', airline: 'Garuda Indonesia', seats: '12/15', status: 'Open Seat' },
  ];

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans">
      
      {/* 1. SIDEBAR NAVIGASI ERP */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-4">
        <div>
          {/* Header Branding Logo */}
          <div className="flex items-center gap-3 px-3 py-4 mb-6 border-b border-slate-800">
            <div className="p-2 bg-emerald-600 rounded-lg">
              <Plane className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-emerald-400 leading-none">WHISys</h1>
              <span className="text-xs text-slate-400">Travel & Halal ERP</span>
            </div>
          </div>

          {/* Menu Utama ERP */}
          <nav className="space-y-1">
            <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Core ERP System</p>
            
            <SidebarItem 
              icon={LayoutDashboard} 
              label="Dashboard Utama" 
              active={activeMenu === 'dashboard'} 
              onClick={() => setActiveMenu('dashboard')} 
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

        {/* Profile Footer */}
        <div className="border-t border-slate-800 pt-4 flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
              W
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">PT Wisata Halal</p>
              <p className="text-xs text-slate-400">Admin Travel ERP</p>
            </div>
          </div>
          <button className="text-slate-400 hover:text-red-400 transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* 2. AREA KONTEN UTAMA */}
      <main className="flex-1 overflow-y-auto bg-slate-950 p-8">
        
        {/* Top Header */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-white">WHISys ERP Executive Board</h2>
            <p className="text-slate-400 text-sm">Sistem terpadu operasional Umrah, Haji, & Wisata Halal.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input 
                type="text" 
                placeholder="Cari Paspor / Nama Jamaah..." 
                className="bg-slate-900 text-slate-200 pl-9 pr-4 py-2 rounded-lg border border-slate-800 text-sm focus:outline-none focus:border-emerald-500 w-64"
              />
            </div>
            <button className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-emerald-900/30">
              <Plus className="w-4 h-4" /> Register Jamaah Baru
            </button>
          </div>
        </header>

        {/* Dynamic Content Switching Based on activeMenu */}
        {activeMenu === 'dashboard' && (
          <>
            {/* Stat Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              {stats.map((item, idx) => {
                const IconComponent = item.icon;
                return (
                  <div key={idx} className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1">{item.title}</p>
                      <h3 className="text-2xl font-bold text-white">{item.value}</h3>
                    </div>
                    <div className={`p-3 rounded-lg ${item.bg} ${item.color}`}>
                      <IconComponent className="w-6 h-6" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Content Layout: Table & Activity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Tabel Keberangkatan Terdekat (2 Cols) */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="font-bold text-white flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-emerald-400" /> Keberangkatan Mendatang
                    </h3>
                    <p className="text-xs text-slate-400">Monitoring alokasi seat & status dokumen group</p>
                  </div>
                  <button className="text-xs text-emerald-400 hover:underline">Lihat Semua Group</button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase">
                      <tr>
                        <th className="p-3 rounded-l-lg">Kode / Paket</th>
                        <th className="p-3">Tanggal</th>
                        <th className="p-3">Maskapai</th>
                        <th className="p-3">Quota Seat</th>
                        <th className="p-3 rounded-r-lg">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {upcomingDepartures.map((group, idx) => (
                        <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 font-semibold text-white">
                            {group.name}
                            <span className="block text-xs font-normal text-slate-400">{group.code}</span>
                          </td>
                          <td className="p-3">{group.date}</td>
                          <td className="p-3">{group.airline}</td>
                          <td className="p-3 font-medium text-emerald-400">{group.seats}</td>
                          <td className="p-3">
                            <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs rounded-full font-medium">
                              {group.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Alert Operations & Reminders (1 Col) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-white mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-400" /> Perhatian Operasional
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs">
                      <p className="font-semibold text-amber-400 mb-1">12 Paspor Masa Berlaku &lt; 6 Bulan</p>
                      <p className="text-slate-300">Diperlukan perpanjangan paspor jamaah Umrah Des 2026 segera.</p>
                    </div>

                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs">
                      <p className="font-semibold text-blue-400 mb-1">Pengambilan Koper & Seragam</p>
                      <p className="text-slate-300">25 Set Koper & Batik siap dikirim ke Mitra Bandung.</p>
                    </div>

                    <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg text-xs">
                      <p className="font-semibold text-purple-400 mb-1">Pengajuan Visa Siskopatuh</p>
                      <p className="text-slate-300">Manifest Group UMR-VIP membutuhkan verifikasi akhir data paspor.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                  <span className="text-xs text-slate-500">WHISys ERP Platform • Version 1.0</span>
                </div>
              </div>

            </div>
          </>
        )}

        {/* Fallback View untuk Modul yang sedang dikembangkan */}
        {activeMenu !== 'dashboard' && (
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

// Navigasi Item Komponen
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
