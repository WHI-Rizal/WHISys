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

    // Ambil 200 baris pertama agar tidak overflow token
    const limitedData = data.slice(0, 200);
    const totalRows = data.length;

    const promptText = `
      Anda adalah analis bisnis profesional untuk agen perjalanan Umrah/Haji.
      Berikut adalah data laporan transaksi/penjualan (Total keseluruhan: ${totalRows} baris).
      
      Data Sampel (200 baris pertama):
      ${JSON.stringify(limitedData)}

      Berikan analisis ringkas dan padat mencakup:
      1. Ringkasan Kinerja Keseluruhan.
      2. Tren Utama / Pola Data.
      3. Rekomendasi Strategis Bisnis.
    `;

    // Menggunakan endpoint resmi & paling stabil: gemini-1.5-flash
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

    const resultData = await response.json();

    if (!response.ok) {
      throw new Error(resultData.error?.message || "Gagal merespons dari Gemini API");
    }

    const text = resultData.candidates?.[0]?.content?.parts?.[0]?.text || "Tidak ada hasil analisis.";

    return Response.json({ result: text });

  } catch (error) {
    console.error("Gemini API Error:", error);
    return Response.json({ error: "Gagal memproses data: " + error.message }, { status: 500 });
  }
}
