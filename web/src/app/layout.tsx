import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import '@fortawesome/fontawesome-free/css/all.min.css';
import 'material-symbols/outlined.css';
import { APP_BRAND } from '@/lib/app-brand';
import './globals.css';

export const metadata: Metadata = {
  title: APP_BRAND.name,
  description: APP_BRAND.metaDescription,
  icons: {
    icon: '/LOGO4_XOANEN.png',
    shortcut: '/favicon.ico',
  },
};

const roboto = Roboto({
  subsets: ['latin', 'vietnamese'],
  weight: ['300', '400', '500', '700', '900'],
  display: 'swap',
  variable: '--font-roboto',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className={`${roboto.className} ${roboto.variable}`}>{children}</body>
    </html>
  );
}
