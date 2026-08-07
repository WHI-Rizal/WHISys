'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Sparkles, TrendingUp, AlertTriangle, Lightbulb, Users, Wallet, Plane, RefreshCw, MessageSquare } from 'lucide-react';

export default function AiAnalyzerModule({ theme = 'dark' }) {
  const isDark = theme === 'dark';

  const styles = {
    cardBg: isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm',
    innerBg: isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200',
    textTitle: isDark ? 'text-white' : 'text-slate-900',
    textSub: isDark ? 'text-slate-400' : 'text-slate-500',
    inputBg: isDark ? 'bg-slate-950 text-slate-200 border-slate-800' : 'bg-white text-slate-800 border-slate-300',
  };

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  
  // Data Mentah dari Firestore
  const [packages, setPackages] = useState([]);
  const [jamaah, setJamaah] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [vendorCosts, setVendorCosts] = useState([]);

  // State Pertanyaan Chatbot AI
  const [userQuery, setUserQuery] = useState('');
  const [aiChatHistory, setAiChatHistory] = useState([
    {
      sender: 'ai',
      text: 'Assalamu\'alaikum! Saya WHI Executive Intelligence Advisor. Tanyakan apa saja mengenai analisis penjualan paket, arus kas, margin laba, atau kelengkapan berkas jamaah.'
    }
  ]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const [pkgSnap, jmhSnap, bkSnap, incSnap, vpSnap] = await Promise.all([
        getDocs(collection(db, 'packages')),
        getDocs(collection(db, 'jamaah')),
        getDocs(collection(db, 'bookings')),
        getDocs(collection(db, 'payments_income')),
        getDocs(collection(db, 'payments_vendor'))
      ]);

      setPackages(pkgSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setJamaah(jmhSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setBookings(bkSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setIncomes(incSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setVendorCosts(vpSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Gagal mengambil data untuk AI Engine:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // KALKULASI INDIKATOR BISNIS
  const totalOmset = incomes.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalVendorCost = vendorCosts.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const netMargin = totalOmset - totalVendorCost;
  const occupancyRate = packages.length > 0
    ? Math.round((bookings.length / packages.reduce((acc, p) => acc + (Number(p.quotaTotal) || 0), 0)) * 100) || 0
    : 0;

  // REKOMENDASI OTOMATIS BERBASIS ALGORITMA HEURISTIK
  const generateInsights = () => {
    const insights = [];

    // 1. Analisis Okupansi Seat
    if (occupancyRate > 75) {
      insights.push({
        type: 'success',
        title: 'Penjualan Seat Sangat Tinggi',
        desc: `Okupansi grup sudah mencapai ${occupancyRate}%. Disarankan membuka kuota tambahan atau rilis paket baru untuk periode berikutnya.`
      });
    } else if (occupancyRate < 30 && packages.length > 0) {
      insights.push({
        type: 'warning',
        title: 'Tingkat Okupansi Masih Rendah',
        desc: `Okupansi saat ini baru ${occupancyRate}%. Pertimbangkan untuk meningkatkan promosi agen atau menawarkan diskon DP pendaftaran.`
      });
    }

    // 2. Analisis Margin Laba
    if (netMargin < 0) {
      insights.push({
        type: 'danger',
        title: 'Defisit Arus Kas Operasional',
        desc: `Total pembayaran vendor (Rp ${totalVendorCost.toLocaleString('id-ID')}) melebihi setoran masuk (Rp ${totalOmset.toLocaleString('id-ID')}). Segera lakukan penagihan pelunasan jamaah.`
      });
    } else {
      insights.push({
        type: 'info',
        title: 'Arus Kas Positif',
        desc: `Margin bersih kas operasional saat ini dalam posisi aman yaitu Rp ${netMargin.toLocaleString('id-ID')}.`
      });
    }

    // 3. Analisis Dokumen Jamaah
    const incompleteDocsCount = bookings.filter(b => {
      const docs = b.documents || {};
      const filled = Object.values(docs).filter(Boolean).length;
      return filled < 8;
    }).length;

    if (incompleteDocsCount > 0) {
      insights.push({
        type: 'warning',
        title: 'Follow-Up Kelengkapan Berkas',
        desc: `Terdapat ${incompleteDocsCount} jamaah yang berkas dokumennya belum lengkap (kurang dari 8 berkas). Kirim notifikasi WA untuk percepatan.`
      });
    }

    return insights;
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!userQuery.trim()) return;

    const q = userQuery.toLowerCase();
    const newHistory = [...aiChatHistory, { sender: 'user', text: userQuery }];
    setAiChatHistory(newHistory);
    setUserQuery('');
    setAnalyzing(true);

    setTimeout(() => {
      let reply = '';

      if (q.includes('untung') || q.includes('laba') || q.includes('profit') || q.includes('margin')) {
        reply = `Berdasarkan rekap keuangan real-time:\n• Total Setoran Masuk: Rp ${totalOmset.toLocaleString('id-ID')}\n• Total Biaya HPP Vendor: Rp ${totalVendorCost.toLocaleString('id-ID')}\n• Margin Laba Bersih Operasional: Rp ${netMargin.toLocaleString('id-ID')} (${netMargin >= 0 ? 'Surplus/Laba' : 'Defisit'}).`;
      } else if (q.includes('jamaah') || q.includes('customer') || q.includes('peserta')) {
        reply = `Saat ini terdaftar ${jamaah.length} orang jamaah di Data Master, dengan total ${bookings.length} transaksi booking aktif.`;
      } else if (q.includes('paket') || q.includes('seat') || q.includes('kuota')) {
        reply = `Terdapat ${packages.length} program paket aktif. Rata-rata tingkat keterisian seat saat ini adalah ${occupancyRate}%.`;
      } else if (q.includes('dokumen') || q.includes('paspor') || q.includes('berkas')) {
        reply = `Sistem mencatat ada ${bookings.length} booking. Disarankan mengecek baris berwarna kuning di modul Manifest untuk jamaah yang belum lengkap 8 berkas.`;
      } else {
        reply = `Saya telah menganalisis data WHISys. Saat ini Anda memiliki ${packages.length} paket aktif, ${jamaah.length} jamaah terdaftar, serta akumulasi omset masuk sebesar Rp ${totalOmset.toLocaleString('id-ID')}. Ada yang spesifik ingin Anda ketahui?`;
      }

      setAiChatHistory([...newHistory, { sender: 'ai', text: reply }]);
      setAnalyzing(false);
    }, 800);
  };

  const insightsList = generateInsights();

  return (
    <div className="space-y-6">
      {/* HEADER BOARD AI */}
      <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 ${styles.cardBg} p-6 rounded-xl border`}>
        <div>
          <h3 className={`text-xl font-bold ${styles.textTitle} flex items-center gap-2`}>
            <Sparkles className="w-5 h-5 text-emerald-400 animate-pulse" /> WHI AI Business Intelligence Engine
          </h3>
          <p className={`text-xs ${styles.textSub} mt-1`}>Analisis performa penjualan paket, margin laba operasional, dan peringatan risiko bisnis secara otomatis.</p>
        </div>
        <button
          onClick={fetchAllData}
          className="flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30 px-3.5 py-2 rounded-lg text-xs font-medium transition-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Analisis AI
        </button>
      </div>

      {/* METRIK REAL-TIME METRICS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${styles.textSub}`}>Total Omset Real</span>
            <Wallet className="w-4 h-4 text-emerald-500" />
          </div>
          <h4 className="text-lg font-bold text-emerald-500">Rp {totalOmset.toLocaleString('id-ID')}</h4>
        </div>

        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${styles.textSub}`}>HPP Biaya Vendor</span>
            <Wallet className="w-4 h-4 text-rose-500" />
          </div>
          <h4 className="text-lg font-bold text-rose-500">Rp {totalVendorCost.toLocaleString('id-ID')}</h4>
        </div>

        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${styles.textSub}`}>Est. Margin Bersih</span>
            <TrendingUp className={`w-4 h-4 ${netMargin >= 0 ? 'text-blue-500' : 'text-amber-500'}`} />
          </div>
          <h4 className={`text-lg font-bold ${netMargin >= 0 ? 'text-blue-500' : 'text-amber-500'}`}>
            Rp {netMargin.toLocaleString('id-ID')}
          </h4>
        </div>

        <div className={`${styles.cardBg} p-4 rounded-xl border`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs ${styles.textSub}`}>Rate Okupansi Seat</span>
            <Plane className="w-4 h-4 text-purple-500" />
          </div>
          <h4 className="text-lg font-bold text-purple-500">{occupancyRate}% Terisi</h4>
        </div>
      </div>

      {/* GRID INSIGHTS & CHATBOT ADVISOR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* KOLOM REKOMENDASI PINTAR */}
        <div className={`lg:col-span-2 ${styles.cardBg} p-6 rounded-xl border space-y-4`}>
          <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-3`}>
            <Lightbulb className="w-4 h-4 text-amber-400" /> Rekomendasi Eksekutif Auto-Generated
          </h4>

          {loading ? (
            <p className={`text-xs ${styles.textSub} py-6 text-center`}>Menganalisis data dari Firestore...</p>
          ) : insightsList.length === 0 ? (
            <p className={`text-xs ${styles.textSub} py-6 text-center`}>Belum ada data cukup untuk dianalisis oleh AI Engine.</p>
          ) : (
            <div className="space-y-3">
              {insightsList.map((item, idx) => (
                <div 
                  key={idx} 
                  className={`p-4 rounded-xl border text-xs space-y-1 ${
                    item.type === 'danger' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
                    item.type === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                    item.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                    'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  }`}
                >
                  <h5 className="font-bold flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5" /> {item.title}
                  </h5>
                  <p className="leading-relaxed opacity-90">{item.desc}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CHATBOT EXECUTIVE ADVISOR */}
        <div className={`${styles.cardBg} p-5 rounded-xl border flex flex-col justify-between h-[450px]`}>
          <div>
            <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-3 mb-3`}>
              <MessageSquare className="w-4 h-4 text-emerald-400" /> Executive AI Chat Advisor
            </h4>

            <div className="space-y-3 overflow-y-auto max-h-[300px] pr-1 text-xs">
              {aiChatHistory.map((chat, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-xl max-w-[90%] whitespace-pre-line ${
                    chat.sender === 'user' 
                      ? 'bg-emerald-600 text-white ml-auto' 
                      : `${styles.innerBg} ${styles.textTitle} border border-slate-700/50`
                  }`}
                >
                  {chat.text}
                </div>
              ))}
              {analyzing && (
                <div className={`p-2.5 rounded-xl ${styles.innerBg} text-slate-400 italic text-[11px]`}>
                  AI sedang memproses pertanyaan...
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSendChat} className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="Tanyakan analisis keuangan/paket..."
              className={`flex-1 ${styles.inputBg} p-2 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
            <button 
              type="submit" 
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-xs font-semibold"
            >
              Kirim
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
