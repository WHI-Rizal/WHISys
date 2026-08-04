import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "dummy-key-for-build",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

// Cek apakah aplikasi berjalan di browser atau server
const app = getApps().length > 0 
  ? getApp() 
  : initializeApp(firebaseConfig);

// Inisialisasi Auth dengan penanganan aman saat Prerender/Build
let auth;
if (typeof window !== 'undefined' || process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
  try {
    auth = getAuth(app);
  } catch (e) {
    console.warn("Firebase Auth deferred during build.");
  }
} else {
  auth = {}; // Fallback objek kosong saat prerendering di Vercel build
}

export { auth };
