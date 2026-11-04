import Dashboard from '../components/Dashboard';

export default function Home() {
  return (
    <main style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'system-ui, sans-serif', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>OpenRouter Token Volume Dashboard</h1>
      <p style={{ color: '#94a3b8', marginBottom: 24 }}>
        Live daily token volumes for Anthropic and OpenAI from OpenRouter, with optional price overlay from AI Pricing Guru.
      </p>
      <Dashboard />
    </main>
  );
}
