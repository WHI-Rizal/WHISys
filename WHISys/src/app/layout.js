import './globals.css'; // Opsional jika Anda pakai Tailwind CSS
import { AuthContextProvider } from '@/context/AuthContext';

export const metadata = {
  title: 'Erahajj Business Intelligence',
  description: 'AI Analytics untuk Travel Haji & Umrah',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>
        <AuthContextProvider>
          {children}
        </AuthContextProvider>
      </body>
    </html>
  );
}