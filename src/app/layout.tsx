import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'تم الآن لذكاء البيانات العقارية | TAMALAAN DATA',
  description: 'منصة سعودية لتحليل البيانات العقارية بعلوم البيانات والذكاء الاصطناعي. معاينة قيد التطوير.',
  robots: { index: false, follow: false }, // معاينة قيد التطوير: لا فهرسة حتى الإطلاق
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#081A33' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
