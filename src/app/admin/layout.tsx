import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAuthService } from '@/server/auth/runtime';
import { requireAdmin } from '@/server/auth/guards';
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  try {
    await getAuthService().withAuthTransaction((context) =>
      requireAdmin(context, new Headers(requestHeaders)),
    );
  } catch {
    notFound();
  }
  return children;
}
