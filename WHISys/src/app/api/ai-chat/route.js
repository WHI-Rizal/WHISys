import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(req) {
  try {
    const { promptText } = await req.json();

    // Mengambil API Key secara aman dari Server Environment
    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key Gemini belum dipasang di Environment Variables.' },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Pakai Interactions API (pengganti resmi generateContent) & model
    // Gemini 3 yang masih aktif untuk akun/API key baru.
    const interaction = await ai.interactions.create({
      model: 'gemini-3.5-flash-lite',
      input: promptText,
    });

    const aiAnswer = interaction.output_text || 'Tidak ada hasil analisis.';

    return NextResponse.json({ text: aiAnswer });
  } catch (err) {
    console.error('Server AI Chat Error:', err);
    return NextResponse.json(
      { error: err.message || 'Terjadi kesalahan pada Server AI.' },
      { status: 500 }
    );
  }
}
