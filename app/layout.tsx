import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SELENE · 月面漫游',
  description: '在真实三维月面上，自由探索月球探测车。全部资源本地运行。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" className="dark"><body>{children}</body></html>;
}
