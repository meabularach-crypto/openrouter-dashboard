'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

export default function Dashboard() {
  const [volData, setVolData] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(90);
  const [provider, setProvider] = useState('anthropic');
  const [showPrice, setShowPrice] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/data?days=${days}&provider=${provider}`).then(r => r.json()),
      fetch(`/api/prices?provider=${provider}`).then(r => r.json()),
    ])
      .then(([v, p]) => {
        if (v.error) throw new Error(v.error);
        if (p.error) throw new Error(p.error);
        setVolData(v);
        setPriceData(p);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [days, provider]);

  if (loading) return <p>Loading data…</p>;
  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>;
  if (!volData) return null;

  const fmt = (n) => n >= 1e12 ? `${(n/1e12).toFixed(1)}T` : n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n.toLocaleString();

  // Join volume + price on date
  const priceMap = Object.fromEntries((priceData?.series || []).map(s => [s.date, s]));
  const chartData = (volData.daily || []).map(d => ({
    ...d,
    median_input: priceMap[d.date]?.median_input ?? null,
    median_output: priceMap[d.date]?.median_output ?? null,
  }));

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Provider:</label>
        <select value={provider} onChange={e => setProvider(e.target.value)} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', padding: '4px 8px' }}>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
        </select>

        <label>Lookback:</label>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', padding: '4px 8px' }}>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>365 days</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} />
          Show price overlay
        </label>

        <span style={{ color: '#64748b', fontSize: 13 }}>
          {volData.meta?.start} → {volData.meta?.end} · volumes cached ~1h · prices from AI Pricing Guru
        </span>
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18 }}>Daily Token Volume ({provider})</h2>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fill: '#94a3b8' }} tickFormatter={fmt} />
            {showPrice && <YAxis yAxisId="right" orientation="right" tick={{ fill: '#94a3b8' }} />}
            <Tooltip formatter={(v, name) => name.includes('price') || name.includes('median') ? `$${v?.toFixed?.(2) ?? v}` : fmt(v)} contentStyle={{ background: '#1e293b', border: '1px solid #334155' }} />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="tokens" name="Daily tokens" stroke="#38bdf8" dot={false} strokeWidth={1.5} />
            <Line yAxisId="left" type="monotone" dataKey="trailing7" name="Trailing 7d" stroke="#a78bfa" dot={false} strokeWidth={2} />
            <Line yAxisId="left" type="monotone" dataKey="trailing28" name="Trailing 28d" stroke="#f472b6" dot={false} strokeWidth={2} />
            {showPrice && (
              <>
                <Line yAxisId="right" type="monotone" dataKey="median_input" name="Median input $/M" stroke="#34d399" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />
                <Line yAxisId="right" type="monotone" dataKey="median_output" name="Median output $/M" stroke="#fbbf24" dot={false} strokeWidth={1.5} strokeDasharray="4 4" />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
        <p style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>
          Token volumes from OpenRouter rankings-daily. Price overlay is daily median list price across the provider’s models from AI Pricing Guru (free, no key). Prices only available from mid-April 2026 onward.
        </p>
      </section>
    </div>
  );
}
