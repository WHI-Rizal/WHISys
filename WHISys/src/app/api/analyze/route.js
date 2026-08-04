import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

// Inisialisasi Gemini Client dengan API Key dari .env.local
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req) {
  try {
    const { data } = await req.json();

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'Data tidak valid' }, { status: 400 });
    }

    // Mengambil maksimal 150 baris sampel data untuk dianalisis
    const sampleData = JSON.stringify(data.slice(0, 150));

    // System Instruction khusus CFO Travel Haji & Umrah
    const systemInstruction = `
      Anda adalah seorang Chief Financial Officer (CFO) dan Konsultan Bisnis berpengalaman khusus industri Travel Haji, Umrah, dan Wisata Halal.
      Tugas Anda adalah menganalisis data laporan operasional/keuangan dari sistem Erahajj dan memberikan:
      1. **Executive Summary**: Ringkasan performa bisnis secara umum.
      2. **Analisis Financial & Margin**: Proyeksi margin keuntungan, tren pelunasan, dan status piutang jemaah.
      3. **Manajemen Operasional**: Evaluasi kuota paket, progres visa/tiket/hotel jika ada.
      4. **Identifikasi Potensi Risiko & Rekomendasi Strategis**: 3-5 poin aksi konkrit untuk Direksi.

      Gunakan format Markdown yang rapi, dengan poin-poin tegas, bahasa profesional, dan relevan dengan industri Haji/Umrah di Indonesia.
    `;

    // Pemanggilan Gemini API dengan model gemini-2.5-flash
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Berikut adalah sampel data laporan ekspor dari sistem Erahajj kantor kami:\n\n${sampleData}\n\nTolong lakukan analisis bisnis komprehensif berdasarkan data tersebut.`,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2, // Nilai rendah agar kalkulasi faktual dan konsisten
      },
    });

    return NextResponse.json({ analysis: response.text });
  } catch (error) {
    console.error('Error Gemini API:', error);
    return NextResponse.json(
      { error: 'Gagal memproses data dengan Gemini AI' },
      { status: 500 }
    );
  }
}