import type { Metadata } from 'next';
import { Raleway } from 'next/font/google';
import AuthProvider from '@/components/AuthProvider';
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
  return (
    <html lang="en">
      <body className={raleway.variable}>
        {/* MSAL Provider wraps every route so any client component
            can drive the SSO flow via useMsal/useIsAuthenticated.
            The actual permissions gate (whether the user has wb
            access) is applied by the wallboards-internal pages —
            see components/WbGate.tsx (next commit). Auth callback
            (/auth/callback) sits outside the gate so the redirect
            from Microsoft can complete sign-in. */}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
