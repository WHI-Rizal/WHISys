'use client';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError('Email atau Password salah!');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-4">
      <div className="bg-slate-800 p-8 rounded-xl shadow-xl w-full max-w-md border border-slate-700">
        <h1 className="text-2xl font-bold mb-2 text-emerald-400 text-center">🕌 Erahajj AI Portal</h1>
        <p className="text-slate-400 text-sm mb-6 text-center">Masuk untuk mengakses Dashboard Analisis</p>
        
        {error && <div className="bg-red-500/20 text-red-400 p-3 rounded mb-4 text-sm">{error}</div>}
        
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Email Kantor</label>
            <input
              type="email"
              required
              className="w-full bg-slate-700 border border-slate-600 rounded p-2.5 mt-1 focus:outline-none focus:border-emerald-500"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              type="password"
              required
              className="w-full bg-slate-700 border border-slate-600 rounded p-2.5 mt-1 focus:outline-none focus:border-emerald-500"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="w-full bg-emerald-600 hover:bg-emerald-500 font-semibold p-2.5 rounded transition"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}