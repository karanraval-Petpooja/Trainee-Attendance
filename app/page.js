'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { PageLoader } from '@/components/ui';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    sb().auth.getSession().then(({ data }) => router.replace(data.session ? '/dashboard' : '/login'));
  }, [router]);
  return <PageLoader />;
}
