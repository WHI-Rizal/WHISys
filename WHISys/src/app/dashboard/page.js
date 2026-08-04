'use client';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirection jika belum login
  if (!user) {
    if (typeof window !== 'undefined') router.push('/login');
    return null;
  }

  // Handle File Upload (Excel/CSV)
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const parsedData = XLSX.utils.sheet_to_json(ws);
      setData(parsedData);
    };

    reader.readAsBinaryString(file);
  };

  // Kirim data ke API Route Gemini
  const processAnalysis = async () => {
    if (!data) return;
    setLoading(true);
    setAnalysis('');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });

      const result = await res.json();
      if (result.analysis) {
        setAnalysis(result.analysis);
      } else {
        alert(result.error || 'Gagal memproses data');
      }
    } catch (err) {
      alert('Terjadi kesalahan koneksi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center px-8">
        <h1 className="text-xl font-bold text-emerald-400">🕌 Erahajj Business Intelligence</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{user?.email}</span>
          <button
            onClick={() => logout().then(() => router.push('/login'))}
            className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="p-8 max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Upload Panel */}
        <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 h-fit">
          <h2 className="text-lg font-semibold mb-4">Upload Laporan Erahajj</h2>
          <input
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleFileUpload}
            className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 mb-4 cursor-pointer"
          />

          {fileName && (
            <div className="bg-slate-800/50 p-3 rounded text-xs text-emerald-400 mb-4 border border-slate-700">
              Loaded: <strong>{fileName}</strong> ({data?.length || 0} baris)
            </div>
          )}

          <button
            onClick={processAnalysis}
            disabled={!data || loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 font-semibold py-2.5 rounded transition"
          >
            {loading ? 'Menganalisis Data...' : 'Mulai Analisis AI'}
          </button>
        </div>

        {/* Output Panel */}
        <div className="md:col-span-2 bg-slate-900 p-6 rounded-xl border border-slate-800 min-h-[500px]">
          <h2 className="text-lg font-semibold mb-4 text-emerald-400">📊 Laporan & Rekomendasi AI</h2>

          {loading && (
            <div className="flex items-center justify-center h-64 text-slate-500">
              <span className="animate-pulse">Gemini AI sedang membaca dan mengkalkulasi data bisnis Anda...</span>
            </div>
          )}

          {!loading && !analysis && (
            <div className="flex items-center justify-center h-64 text-slate-600 text-sm">
              Silakan unggah file Excel/CSV Erahajj dan klik "Mulai Analisis AI".
            </div>
          )}

          {!loading && analysis && (
            <div className="prose prose-invert max-w-none text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
              {analysis}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}