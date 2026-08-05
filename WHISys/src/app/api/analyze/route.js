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

    // Batasi sampel data maksimal 200 baris agar payload tidak melebih batas token
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

    // Daftar endpoint alternatif jika salah satu mengalami kegagalan/deprecated
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`
    ];

    let resultData = null;
    let lastError = null;

    // Coba memanggil endpoint secara berurutan hingga berhasil
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }]
          })
        });

        const resJson = await response.json();

        if (response.ok && resJson.candidates?.[0]?.content?.parts?.[0]?.text) {
          resultData = resJson;
          break; // Berhasil, keluar dari loop
        } else {
          lastError = resJson.error?.message || "Gagal mendapatkan respons";
        }
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!resultData) {
      throw new Error(lastError || "Gagal memproses data dengan semua model Gemini yang tersedia.");
    }

    const text = resultData.candidates[0].content.parts[0].text;
    return Response.json({ result: text });

  } catch (error) {
    console.error("Gemini API Error:", error);
    return Response.json({ error: "Gagal memproses data: " + error.message }, { status: 500 });
  }
}
