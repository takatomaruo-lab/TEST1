import './globals.css';

export const metadata = {
  title: '設計判断記録ツール',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
