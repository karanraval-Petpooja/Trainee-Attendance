import './globals.css';

export const metadata = {
  title: 'Trainer Attendance',
  description: 'Daily attendance register, timeline and monitoring for trainers and managers.',
};

export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#1D2750' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Manrope:wght@400;500;600;700;800&display=swap"
        />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%231D2750'/><path d='M9 16.5l4.5 4.5L23 11.5' stroke='%2334D399' stroke-width='3.2' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
