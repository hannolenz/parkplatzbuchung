import './globals.css';

export const metadata = {
  title: 'Parkplatzbuchung',
  description: 'Private Parkplatzbuchung für ERGO-Ladesäulen'
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
