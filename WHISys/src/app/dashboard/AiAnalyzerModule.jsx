'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Sparkles, TrendingUp, AlertTriangle, Lightbulb, Wallet, Plane, RefreshCw, MessageSquare, Send, Maximize2, Minimize2, X, Trash2 } from 'lucide-react';

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
  
  // State Maximize/Fullscreen Chat
  const [isChatMaximized, setIsChatMaximized] = useState(false);
  
  const [packages, setPackages] = useState([]);
  const [jamaah, setJamaah] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [vendorCosts, setVendorCosts] = useState([]);

  const [userQuery, setUserQuery] = useState('');

  // Default Chat Initial
  const defaultChat = [
    {
      sender: 'ai',
      text: 'Assalamu\'alaikum! Saya WHI Executive Intelligence Advisor. Silakan tanyakan informasi data jamaah, tagihan, laba rugi, hingga paket travel Anda.'
    }
  ];

  // Load chat dari localStorage jika ada, jika tidak pakai defaultChat
  const [aiChatHistory, setAiChatHistory] = useState(defaultChat);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedChat = localStorage.getItem('whi_ai_chat_history');
      if (savedChat) {
        try {
          setAiChatHistory(JSON.parse(savedChat));
        } catch (e) {
          console.error("Gagal membaca riwayat chat dari localStorage", e);
        }
      }
    }
  }, []);

  // Simpan riwayat chat ke localStorage setiap kali ada perubahan
  const updateChatHistory = (newHistory) => {
    setAiChatHistory(newHistory);
    if (typeof window !== 'undefined') {
      localStorage.setItem('whi_ai_chat_history', JSON.stringify(newHistory));
    }
  };

  // Fungsi Reset / Akhiri Percakapan
  const handleEndConversation = () => {
    if (window.confirm("Apakah Anda yakin ingin mengakhiri percakapan dan menghapus riwayat chat?")) {
      setAiChatHistory(defaultChat);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('whi_ai_chat_history');
      }
    }
  };

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

  const totalOmset = incomes.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const totalVendorCost = vendorCosts.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  const netMargin = totalOmset - totalVendorCost;
  const occupancyRate = packages.length > 0
    ? Math.round((bookings.length / packages.reduce((acc, p) => acc + (Number(p.quotaTotal) || 0), 0)) * 100) || 0
    : 0;

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

  // Safe Helper Render Format Markdown (**bold**)
  const renderFormattedText = (rawText) => {
    if (!rawText) return null;
    try {
      const lines = String(rawText).split('\n');
      return lines.map((line, lIdx) => {
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <div key={lIdx} className={line.trim() === '' ? 'h-2' : 'min-h-[1.25em]'}>
            {parts.map((part, pIdx) => {
              if (part && part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                return (
                  <strong key={pIdx} className="font-bold text-emerald-400">
                    {part.slice(2, -2)}
                  </strong>
                );
              }
              return part;
            })}
          </div>
        );
      });
    } catch (e) {
      return <div>{rawText}</div>;
    }
  };

  // Helper pembersih teks
  const cleanAiResponse = (rawText) => {
    if (!rawText) return "";
    let cleaned = rawText;

    if (cleaned.includes('"')) {
      const matches = cleaned.match(/"([^"]+)"/g);
      if (matches && matches.length > 0) {
        cleaned = matches[matches.length - 1].replace(/"/g, '');
      }
    }

    const lines = cleaned.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith('* Role:') &&
             !trimmed.startsWith('* User') &&
             !trimmed.startsWith('* Context:') &&
             !trimmed.startsWith('* Constraints:') &&
             !trimmed.startsWith('* Option') &&
             !trimmed.startsWith('* Constraint check:') &&
             !trimmed.startsWith('Final Polish:');
    });

    return filteredLines.join('\n').trim();
  };

  // Fungsi Chat Handler
  const handleSendChat = async (e) => {
    e.preventDefault();
    if (!userQuery.trim()) return;

    const currentQuery = userQuery;
    const newHistory = [...aiChatHistory, { sender: 'user', text: currentQuery }];
    updateChatHistory(newHistory);
    setUserQuery('');
    setAnalyzing(true);

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    // Data Context ERP
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

    const systemInstructionText = `Anda adalah WHI Executive Assistant PT. WISATA HALAL INTERNASIONAL.
DATABASE REAL-TIME ERP:
${JSON.stringify(systemContextData)}

Tugas Anda hanya memberikan kalimat balasan singkat dan langsung ke inti (maksimal 2-3 kalimat). Dilarang menuliskan analisis internal, poin aturan, atau opsi jawaban di teks keluaran.`;

    try {
      if (!apiKey) {
        throw new Error("API Key Gemini tidak terdeteksi. Pastikan NEXT_PUBLIC_GEMINI_API_KEY terpasang di Vercel.");
      }

      const listModelsRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      const listModelsData = await listModelsRes.json();

      if (listModelsData.error) {
        throw new Error(listModelsData.error.message);
      }

      const validModels = (listModelsData.models || [])
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name.replace('models/', ''))
        .filter(name => !name.includes('1.5') && !name.includes('2.0') && !name.includes('2.5'));

      const selectedModel = validModels.length > 0 
        ? validModels[0] 
        : (listModelsData.models || []).map(m => m.name.replace('models/', ''))[0];

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemInstructionText }]
            },
            contents: [{
              role: 'user',
              parts: [{ text: currentQuery }]
            }],
            generationConfig: {
              temperature: 0.1
            }
          })
        }
      );

      const data = await response.json();

      if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
        const rawAiAnswer = data.candidates[0].content.parts[0].text;
        const finalCleanAnswer = cleanAiResponse(rawAiAnswer);
        updateChatHistory([...newHistory, { sender: 'ai', text: finalCleanAnswer }]);
      } else if (data.error) {
        throw new Error(data.error.message);
      } else {
        throw new Error("Respons dari Google Gemini kosong.");
      }

    } catch (err) {
      console.error("Gemini API Error Detail:", err);
      let fallbackAnswer = `⚠️ [Error AI]: ${err.message}\n\nRingkasan Data Real-time:\n• Total Jamaah: ${jamaah.length} orang\n• Total Booking: ${bookings.length} transaksi\n• Total Setoran: Rp ${totalOmset.toLocaleString('id-ID')}\n• Margin Laba: Rp ${netMargin.toLocaleString('id-ID')}`;

      updateChatHistory([...newHistory, { sender: 'ai', text: fallbackAnswer }]);
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

      {/* METRIK REAL-TIME */}
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

      {/* INSIGHTS & CHATBOT ADVISOR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* REKOMENDASI AUTO-GENERATED */}
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

        {/* CHATBOT EXECUTIVE ADVISOR (NORMAL COMPACT MODE) */}
        <div className={`${styles.cardBg} p-5 rounded-xl border flex flex-col justify-between h-[540px]`}>
          <div>
            <div className={`flex items-center justify-between border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-3 mb-3`}>
              <h4 className={`text-sm font-bold ${styles.textTitle} flex items-center gap-2`}>
                <MessageSquare className="w-4 h-4 text-emerald-400" /> Executive AI Chat Advisor
              </h4>
              <button
                onClick={() => setIsChatMaximized(true)}
                title="Perbesar Layar Chat"
                className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 rounded-lg transition-colors"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[350px] pr-1 text-xs">
              {aiChatHistory.map((chat, idx) => (
                <div 
                  key={idx} 
                  className={`p-3.5 rounded-xl max-w-[92%] leading-relaxed ${
                    chat.sender === 'user' 
                      ? 'bg-emerald-600 text-white ml-auto' 
                      : `${styles.innerBg} ${styles.textTitle} border border-slate-800/80`
                  }`}
                >
                  {chat.sender === 'ai' ? renderFormattedText(chat.text) : chat.text}
                </div>
              ))}
              {analyzing && (
                <div className={`p-2.5 rounded-xl ${styles.innerBg} text-emerald-400 italic text-[11px] animate-pulse`}>
                  Gemini AI sedang membaca database & menyusun jawaban...
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2 mt-2">
            <form onSubmit={handleSendChat} className="flex gap-2">
              <input
                type="text"
                placeholder="Tanyakan analisis paket/jamaah..."
                className={`flex-1 ${styles.inputBg} p-2.5 rounded-lg text-xs focus:outline-none focus:border-emerald-500`}
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
              />
              <button 
                type="submit" 
                disabled={analyzing}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-3.5 py-2.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

            {/* Tombol Akhiri Percakapan */}
            {aiChatHistory.length > 1 && (
              <button
                onClick={handleEndConversation}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors border border-rose-500/20"
              >
                <Trash2 className="w-3 h-3" /> Akhiri Percakapan
              </button>
            )}
          </div>
        </div>

      </div>

      {/* OVERLAY MODAL MAXIMIZED FULLSCREEN CHAT */}
      {isChatMaximized && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 md:p-8 flex items-center justify-center animate-in fade-in duration-200">
          <div className={`w-full max-w-5xl h-[90vh] ${styles.cardBg} rounded-2xl border shadow-2xl flex flex-col justify-between p-6 relative`}>
            
            {/* HEADER FULLSCREEN CHAT */}
            <div className={`flex items-center justify-between border-b ${isDark ? 'border-slate-800' : 'border-slate-200'} pb-4 mb-4`}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className={`text-base font-bold ${styles.textTitle}`}>WHI Executive Intelligence Advisor (Fullscreen Mode)</h3>
                  <p className={`text-xs ${styles.textSub}`}>Mode baca luas untuk analisis data mendalam & strategi bisnis</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {aiChatHistory.length > 1 && (
                  <button
                    onClick={handleEndConversation}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-medium transition-colors border border-rose-500/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Akhiri Percakapan
                  </button>
                )}
                <button
                  onClick={() => setIsChatMaximized(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <Minimize2 className="w-4 h-4" /> Minimize
                </button>
                <button
                  onClick={() => setIsChatMaximized(false)}
                  className="p-1.5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* BODY CHAT FULLSCREEN */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-3 text-sm">
              {aiChatHistory.map((chat, idx) => (
                <div 
                  key={idx} 
                  className={`p-4 rounded-2xl max-w-[85%] leading-relaxed ${
                    chat.sender === 'user' 
                      ? 'bg-emerald-600 text-white ml-auto' 
                      : `${styles.innerBg} ${styles.textTitle} border border-slate-800 shadow-md`
                  }`}
                >
                  {chat.sender === 'ai' ? renderFormattedText(chat.text) : chat.text}
                </div>
              ))}
              {analyzing && (
                <div className={`p-3 rounded-2xl ${styles.innerBg} text-emerald-400 italic text-xs animate-pulse border border-emerald-500/20`}>
                  Gemini AI sedang membaca seluruh database & menyusun laporan...
                </div>
              )}
            </div>

            {/* INPUT FIELD FULLSCREEN */}
            <form onSubmit={handleSendChat} className="mt-4 flex gap-3 pt-3 border-t border-slate-800">
              <input
                type="text"
                placeholder="Tanyakan analisis bisnis, strategi paket, atau data jamaah..."
                className={`flex-1 ${styles.inputBg} p-3 rounded-xl text-sm focus:outline-none focus:border-emerald-500`}
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
              />
              <button 
                type="submit" 
                disabled={analyzing}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all"
              >
                <Send className="w-4 h-4" /> Kirim
              </button>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
