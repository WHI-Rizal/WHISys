import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Memanggil model resmi Gemini di sisi Server
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent(promptText);
    const response = await result.response;
    const aiAnswer = response.text();

    return NextResponse.json({ text: aiAnswer });
  } catch (err) {
    console.error('Server AI Chat Error:', err);
    return NextResponse.json(
      { error: err.message || 'Terjadi kesalahan pada Server AI.' },
      { status: 500 }
    );
  }
}
