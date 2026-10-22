import type { Metadata } from 'next';
import { ShareView } from '@/components/thoughts/share-view';
export const metadata: Metadata = {
  title: 'A thought left unsaid · Gunita',
  description:
    'A quiet place for feelings left unsaid. Enter Gunita to read after the adult content acknowledgment.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'A thought left unsaid · Gunita',
    description: 'A quiet place for feelings left unsaid.',
  },
  twitter: {
    card: 'summary',
    title: 'A thought left unsaid · Gunita',
    description: 'A quiet place for feelings left unsaid.',
  },
};
export default async function Page({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  // No authored body or identity is fetched during SSR/RSC/metadata rendering.
  return (
    <ShareView
      publicId={
        /^t_[A-Za-z0-9_-]{22,64}$/.test(publicId) ? publicId : 'unavailable'
      }
    />
  );
}
