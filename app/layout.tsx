import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Raleway } from 'next/font/google';
import AuthProvider from '@/components/AuthProvider';
import WbGate from '@/components/WbGate';
import './globals.css';

const raleway = Raleway({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-raleway',
});

export const metadata: Metadata = {
  title: 'Wallboards',
  description: 'Live reporting wallboards',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the theme cookie set by ThemeToggle so the page paints in the
  // right mode on first SSR pass — avoids a dark→light flash on
  // light-mode users' first render.
  const theme = cookies().get('theme')?.value === 'light' ? 'light' : '';
  return (
    <html lang="en" className={theme}>
      <body className={raleway.variable}>
        {/* MSAL provider wraps every route so any client component
            can use useMsal / useIsAuthenticated. WbGate sits inside
            the provider, gates every route except /auth/callback,
            redirects unauthed users to Microsoft sign-in, redirects
            no-access users to the InsureTec dashboard, and renders
            TopNav above the page content for signed-in users with
            wb permission. */}
        <AuthProvider>
          <WbGate>
            {children}
          </WbGate>
        </AuthProvider>
      </body>
    </html>
  );
}
