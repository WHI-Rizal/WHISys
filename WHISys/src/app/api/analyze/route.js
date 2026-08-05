import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req) {
  try {
    const { data } = await req.json();

    if (!data || !Array.isArray(data)) {
      return Response.json({ error: "Data tidak valid" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY belum dikonfigurasi di Vercel" }, { status: 500 });
    }

    // Ambil sampel data jika terlalu banyak (maksimal 200 baris pertama & statistik total)
    const limitedData = data.slice(0, 200);
    const totalRows = data.length;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `
      Anda adalah analis bisnis profesional untuk agen perjalanan Umrah/Haji.
      Berikut adalah data laporan transaksi/penjualan (Total keseluruhan: ${totalRows} baris).
      
      Data Sampel (200 baris pertama):
      ${JSON.stringify(limitedData)}

      Berikan analisis ringkas dan padat mencakup:
      1. Ringkasan Kinerja Keseluruhan.
      2. Tren Utama / Pola Data.
      3. Rekomendasi Strategis Bisnis.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return Response.json({ result: text });

  } catch (error) {
    console.error("Gemini API Error:", error);
    return Response.json({ error: "Gagal memproses data dengan Gemini AI: " + error.message }, { status: 500 });
  }
}
