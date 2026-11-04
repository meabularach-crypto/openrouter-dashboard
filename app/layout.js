import { SpeedInsights } from '@vercel/speed-insights/next';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <title>Anthropic OpenRouter Dashboard</title>
        <meta name="description" content="Live Anthropic token volumes and revenue estimates from OpenRouter" />
      </head>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#e2e8f0' }}>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
