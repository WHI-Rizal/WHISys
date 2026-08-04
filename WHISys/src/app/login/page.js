'use client';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError('Email atau password salah');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#020617',
      padding: '1rem',
      fontFamily: 'sans-serif'
    }}>
      <div style={{
        maxWidth: '28rem',
        width: '100%',
        backgroundColor: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '1rem',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        padding: '2rem'
      }}>
        
        {/* Header Logo & Title */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          {/* BARIS DI BAWAH INI YANG DIGANTI */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <img 
              src="/logo.png" 
              alt="WHI Logo" 
              style={{ height: '60px', width: 'auto', objectFit: 'contain' }} 
            />
          </div>
          
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ffffff', letterSpacing: '0.025em' }}>
            WHI System Portal
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Masuk untuk mengakses Dashboard Analisis
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            borderRadius: '0.5rem',
            color: '#f87171',
            fontSize: '0.875rem',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        {/* Form Login */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '0.75rem',
                color: '#ffffff',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              placeholder="nama@wisatahalalindonesia.com"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '0.75rem',
                color: '#ffffff',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '0.875rem 1rem',
              backgroundColor: '#059669',
              color: '#ffffff',
              fontWeight: '500',
              borderRadius: '0.75rem',
              border: 'none',
              cursor: 'pointer',
              marginTop: '0.5rem',
              transition: 'background-color 0.2s'
            }}
          >
            Sign In
          </button>
        </form>

      </div>
    </div>
  );
}
