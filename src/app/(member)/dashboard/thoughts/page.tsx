import { DashboardView } from '@/components/thoughts/dashboard-view';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default function Page() {
  return <DashboardView kind="thoughts" />;
}
