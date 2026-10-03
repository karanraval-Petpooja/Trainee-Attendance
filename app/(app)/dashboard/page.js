'use client';
import { useApp } from '@/components/AppShell';
import ManagerDashboard from '@/components/dashboards/ManagerDashboard';
import TrainerDashboard from '@/components/dashboards/TrainerDashboard';

export default function DashboardPage() {
  const { profile } = useApp();
  return profile.role === 'manager' ? <ManagerDashboard /> : <TrainerDashboard />;
}
