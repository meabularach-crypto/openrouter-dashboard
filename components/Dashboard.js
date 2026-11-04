'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const ARR_POINTS = {
  anthropic: [
    { date: '2025-01-01', arr: 1e9 },
    { date: '2025-05-31', arr: 3e9 },
    { date: '2025-10-15', arr: 7e9 },
    { date: '2025-12-31', arr: 9e9 },
    { date: '2026-02-12', arr: 14e9 },
    { date: '2026-03-15', arr: 19e9 },
    { date: '2026-04-06', arr: 30e9 },
    { date: '2026-05-28', arr: 47e9 },
    { date: '2026-07-31', arr: 65e9 },
  ],
  openai: [
    { date: '2024-12-31', arr: 6e9 },
    { date: '2025-06-10', arr: 10e9 },
    { date: '2025-12-31', arr: 20e9 },
    { date: '2026-02-28', arr: 25e9 },
    { date: '2026-08-14', arr: 40e9 },
    { date: '2026-09-30', arr: 50e9 },
  ],
};

export default function Dashboard() {
  const [tab, setTab] = useState('volume');
  const [provider, setProvider] = useState('anthropic');
  const [days, setDays] = useState(365);
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

        const arrMap = Object.fromEntries(
          (ARR_POINTS[provider] || []).map(p => [p.date, p.arr])
        );

        const merged = (volJson.daily || []).map(d => {
          const avgInput = priceMap[d.date]?.avg_input ?? null;
          const avgOutput = priceMap[d.date]?.avg_output ?? null;
          const blendedPrice = (avgInput != null && avgOutput != null)
            ? avgInput * 0.75 + avgOutput * 0.25
            : null;
          const spend = (blendedPrice != null && d.tokens)
            ? (d.tokens / 1_000_000) * blendedPrice
            : null;

          return {
            ...d,
            avg_input: avgInput,
            avg_output: avgOutput,
            blended_price: blendedPrice,
            spend,
            arr: arrMap[d.date] ?? null,
          };
        });

        // 28-day trailing spend
        const spends = merged.map(d => d.spend || 0);
        const t28 = [];
        let sum = 0;
        const q = [];
        for (let i = 0; i < spends.length; i++) {
          sum += spends[i];
          q.push(spends[i]);
          if (q.length > 28) sum -= q.shift();
          t28.push(q.length === 28 ? sum / 28 : null);
        }
        merged.forEach((d, i) => { d.trailing28_spend = t28[i]; });

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

  const tabStyle = (active) => ({
    padding: '8px 16px',
    border: 'none',
    background: active ? '#111' : '#eee',
    color: active ? '#fff' : '#111',
    cursor: 'pointer',
    borderRadius: 6,
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={tabStyle(tab === 'volume')} onClick={() => setTab('volume')}>
          Volume & Price
        </button>
        <button style={tabStyle(tab === 'spend')} onClick={() => setTab('spend')}>
          Estimated Spend
        </button>
      </div>

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
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
        </label>
        {tab === 'volume' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} />
            Show price overlay
          </label>
        )}
      </div>

      <ResponsiveContainer width="100%" height={440}>
        <ComposedChart data={data} margin={{ top: 10, right: 60, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" minTickGap={40} />

          {tab === 'volume' ? (
            <>
              <YAxis yAxisId="left" tickFormatter={v => (v / 1e12).toFixed(1) + 'T'} />
              {showPrice && (
                <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tickFormatter={v => '$' + Number(v).toFixed(2)} />
              )}
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="tokens" name="Daily tokens" stroke="#8884d8" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="trailing7" name="7-day trailing" stroke="#82ca9d" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="trailing28" name="28-day trailing" stroke="#ffc658" dot={false} />
              {showPrice && (
                <>
                  <Line yAxisId="right" type="monotone" dataKey="avg_input" name="Avg input $/M" stroke="#ff7300" dot={false} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="avg_output" name="Avg output $/M" stroke="#d45087" dot={false} connectNulls />
                </>
              )}
            </>
          ) : (
            <>
              <YAxis yAxisId="left" tickFormatter={v => '$' + (v / 1e6).toFixed(1) + 'M'} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={v => '$' + (v / 1e9).toFixed(0) + 'B'}
                domain={['auto', 'auto']}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === 'Reported ARR') return ['$' + (value / 1e9).toFixed(1) + 'B', name];
                  return [value != null ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', name];
                }}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="spend" name="Estimated daily spend" stroke="#8884d8" dot={false} connectNulls />
              <Line yAxisId="left" type="monotone" dataKey="trailing28_spend" name="28-day trailing spend" stroke="#ffc658" dot={false} connectNulls />
              <Bar
                yAxisId="right"
                dataKey="arr"
                name="Reported ARR"
                fill="#e74c3c"
                barSize={12}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {tab === 'spend' && (
        <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
          Red bars = publicly reported ARR / run-rate figures (right axis, in billions).  
          Lines = estimated daily and 28-day trailing spend from OpenRouter volume × average list price (left axis).
        </p>
      )}
    </div>
  );
}
