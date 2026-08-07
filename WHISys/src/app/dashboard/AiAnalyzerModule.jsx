'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Sparkles, TrendingUp, AlertTriangle, Lightbulb, Users, Wallet, Plane, RefreshCw, MessageSquare, Send } from 'lucide-react';

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
      text: 'Assalamu\'alaikum! Saya WHI Executive Intelligence Advisor yang terhubung langsung ke Google Gemini AI. Tanyakan apa saja mengenai data jamaah, tagihan, laba rugi, hingga proyeksi paket travel Anda.'
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

  // FUNGSI MEMANGGIL GEMINI AI UNTUK MENJAWAB PERTANYAAN BEBAS
  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!userQuery.trim()) return;

    const currentQuery = userQuery;
    const newHistory = [...aiChatHistory, { sender: 'user', text: currentQuery }];
    setAiChatHistory(newHistory);
    setUserQuery('');
    setAnalyzing(true);

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    const systemContextData = {
      summary: {
        totalOmsetReal: totalOmset,
        totalBiayaVendor: totalVendorCost,
        marginLabaBersih: netMargin,
        totalJamaah: jamaah.length,
        totalBookings: bookings.length,
        totalPaket: packages.length,
        occupancyRatePercentage: occupancyRate
      },
      packagesList: packages.map(p => ({
        nama: p.name,
        kode: p.code,
        tglKeberangkatan: p.departureDate,
        kuotaTotal: p.quotaTotal,
        sisaKuota: p.quotaRemaining,
        hargaQuad: p.priceQuad || p.priceMain,
        hargaTriple: p.priceTriple,
        hargaDouble: p.priceDouble
      })),
      jamaahList: jamaah.map(j => ({
        kodeCustomer: j.customerCode,
        nama: j.fullName,
        nik: j.nik,
        paspor: j.passportNumber,
        expiredPaspor: j.passportExpiry,
        noHp: j.phone
      })),
      bookingsList: bookings.map(b => ({
        kodeBooking: b.bookingCode,
        namaJamaah: b.jamaahName,
        namaPaket: b.packageName,
        kamar: b.roomType,
        bus: b.busGroup,
        totalTagihan: b.totalAmount,
        totalSetor: b.totalPaid,
        statusBayar: b.paymentStatus
      }))
    };

    const promptText = `
Anda adalah WHI Executive Intelligence Assistant untuk PT. WISATA HALAL INTERNASIONAL (ERP WHISys).
Jawablah pertanyaan pengguna berdasarkan DATABASE REAL-TIME ERP berikut:

--- DATA REAL-TIME ERP WHISys ---
${JSON.stringify(systemContextData, null, 2)}
----------------------------------

PERTUANAN PENGGUNA: "${currentQuery}"

INSTRUKSI:
- Jawab secara profesional, padat, dan informatif.
- Gunakan poin-poin/bold jika perlu.
- Jika data tidak ditemukan di database, katakan belum ada data terkait.
`;

    try {
      if (!apiKey) {
        throw new Error("API Key Gemini tidak terdeteksi. Pastikan NEXT_PUBLIC_GEMINI_API_KEY diset di Vercel/Environment.");
      }

      // Memanggil Gemini REST API v1beta
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }]
          })
        }
      );

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message || "Error dari Google Gemini API");
      }

      if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        const aiAnswer = data.candidates[0].content.parts[0].text;
        setAiChatHistory([...newHistory, { sender: 'ai', text: aiAnswer }]);
      } else {
        throw new Error("Format respons API tidak sesuai.");
      }

    } catch (err) {
      console.error("Gemini API Error Detail:", err);
      
      let fallbackAnswer = `⚠️ [Koneksi Gemini AI]: ${err.message}\n\nRingkasan Data Real-time:\n• Total Jamaah: ${jamaah.length} orang\n• Total Booking: ${bookings.length} transaksi\n• Total Setoran: Rp ${totalOmset.toLocaleString('id-ID')}\n• Margin Laba: Rp ${netMargin.toLocaleString('id-ID')}`;

      setAiChatHistory([...newHistory, { sender: 'ai', text: fallbackAnswer }]);
    }

    setAnalyzing(false);
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
        <div className={`${styles.cardBg} p-5 rounded-xl border flex flex-col justify-between h-[480px]`}>
          <div>
            <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-3 mb-3`}>
              <MessageSquare className="w-4 h-4 text-emerald-400" /> Executive AI Chat Advisor
            </h4>

            <div className="space-y-3 overflow-y-auto max-h-[330px] pr-1 text-xs">
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
                <div className={`p-2.5 rounded-xl ${styles.innerBg} text-emerald-400 italic text-[11px] animate-pulse`}>
                  Gemini AI sedang membaca database & menganalisis jawaban...
                </div>
              )}
            </div>
          </div>

          <form onSubmit={handleSendChat} className="mt-3 flex gap-2">
            <input
              type="text"
              placeholder="Tanyakan misal: Siapa jamaah yang belum lunas?"
              className={`flex-1 ${styles.inputBg} p-2.5 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
            />
            <button 
              type="submit" 
              disabled={analyzing}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-1"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
