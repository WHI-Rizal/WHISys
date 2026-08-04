import { redirect } from 'next/navigation';

export default function Home() {
  // Otomatis mengarahkan pengguna yang membuka domain utama langsung ke halaman Login
  redirect('/login');
}