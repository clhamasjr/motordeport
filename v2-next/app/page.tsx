'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    // Se já tem token, manda pro dashboard. Senão, manda pra login.
    if (getToken()) router.replace('/inicio');
    else router.replace('/login');
  }, [router]);

  return null;
}
