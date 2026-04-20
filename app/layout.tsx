import type { Metadata } from 'next';
import { Raleway } from 'next/font/google';
import './globals.css';

const raleway = Raleway({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-raleway',
});

export const metadata: Metadata = {
  title: 'Wallboards Pro',
  description: 'Live reporting wallboards',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={raleway.variable}>{children}</body>
    </html>
  );
}
