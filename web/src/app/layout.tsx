import type { Metadata } from 'next';
import { Hanken_Grotesk, Inter, JetBrains_Mono, Manrope, Roboto } from 'next/font/google';
import '@fortawesome/fontawesome-free/css/all.min.css';
import 'material-symbols/outlined.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Seeding Fsolution',
  description: 'Theo dõi bài viết, lọc bình luận và quản lý sale đa kênh',
  icons: {
    icon: '/st-real-logo.jpg',
    shortcut: '/favicon.ico',
  },
};

const roboto = Roboto({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '700', '900'],
  display: 'swap',
  variable: '--font-roboto',
});

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
});

const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin', 'vietnamese'],
  weight: ['600', '700'],
  display: 'swap',
  variable: '--font-hanken-grotesk',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

const manrope = Manrope({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-manrope',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className={`${roboto.variable} ${inter.variable} ${hankenGrotesk.variable} ${jetbrainsMono.variable} ${manrope.variable}`}>{children}</body>
    </html>
  );
}
