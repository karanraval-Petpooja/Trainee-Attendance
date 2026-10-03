'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Batches now live under Trainees
export default function BatchesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/trainees'); }, [router]);
  return null;
}
