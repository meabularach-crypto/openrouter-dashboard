'use client';

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

export default function Dashboard() {
  const [provider, setProvider] = useState('anthropic');
  const [days, setDays] = useState(90);
  const [showPrice, setShowPrice] = useState(false);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [volRes, priceRes] = await Promise.all([
          fetch(`/api/data?provider=${provider}&days=${days}`),
          fetch(`/api/prices?provider=${provider}&days=${days}`),
        ]);
        const volJson = await volRes.json();
        const priceJson = await priceRes.json();
        if (cancelled) return;
        if (volJson.error) throw new Error(volJson.error);
        if (priceJson.error) throw new Error(priceJson.error);

        const priceMap = Object.fromEntries(
          (priceJson.daily || []).map(p => [p.date, p])
        );

        const merged = (volJson.daily || []).map(d => ({
          ...d,
          avg_input: priceMap[d.date]?.avg_input ?? null,
          avg_output: priceMap[d.date]?.avg_output ?? null,
        }));

        setData(merged);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [provider, days]);

  if (error) return <div style={{ color: 'red', padding: 20 }}>Error: {error}</div>;
  if (loading) return <div style={{ padding: 20 }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Provider:&nbsp;
          <select value={provider} onChange={e => setProvider(e.target.value)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label>
          Lookback:&nbsp;
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={showPrice}
            onChange={e => setShowPrice(e.target.checked)}
          />
          Show price overlay
        </label>
      </div>

      <ResponsiveContainer width="100%" height={420}>
        <LineChart data={data} margin={{ top: 10, right: 50, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" minTickGap={40} />

          {/* Left axis = token volume */}
          <YAxis
            yAxisId="left"
            tickFormatter={v => (v / 1e12).toFixed(1) + 'T'}
          />

          {/* Right axis = price ($/M) — only when overlay is on */}
          {showPrice && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={['auto', 'auto']}
              tickFormatter={v => '$' + Number(v).toFixed(2)}
            />
          )}

          <Tooltip />
          <Legend />

          <Line yAxisId="left" type="monotone" dataKey="tokens" name="Daily tokens" stroke="#8884d8" dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="trailing7" name="7-day trailing" stroke="#82ca9d" dot={false} />
          <Line yAxisId="left" type="monotone" dataKey="trailing28" name="28-day trailing" stroke="#ffc658" dot={false} />

          {showPrice && (
            <>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avg_input"
                name="Avg input $/M"
                stroke="#ff7300"
                dot={false}
                connectNulls
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avg_output"
                name="Avg output $/M"
                stroke="#d45087"
                dot={false}
                connectNulls
              />
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
