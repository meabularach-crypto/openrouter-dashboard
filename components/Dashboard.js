'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, BarChart,
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

function nearestSpend(data, targetDate) {
  if (!data.length) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const d of data) {
    const diff = Math.abs(new Date(d.date) - new Date(targetDate));
    if (diff < bestDiff && d.trailing28_spend != null) {
      bestDiff = diff;
      best = d.trailing28_spend;
    }
  }
  return best;
}

function linearTrend(points) {
  if (points.length < 2) return [];
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.spend;
    sumY += p.arr;
    sumXY += p.spend * p.arr;
    sumXX += p.spend * p.spend;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const minX = Math.min(...points.map(p => p.spend));
  const maxX = Math.max(...points.map(p => p.spend));
  return [
    { spend: minX, trend: intercept + slope * minX },
    { spend: maxX, trend: intercept + slope * maxX },
  ];
}

function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const v = r[h];
      if (v == null) return '';
      if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
      return v;
    }).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

export default function Dashboard() {
  const [tab, setTab] = useState('volume');
  const [provider, setProvider] = useState('anthropic');
  const [days, setDays] = useState(365);
  const [showPrice, setShowPrice] = useState(false);
  const [data, setData] = useState([]);
  const [consolidatedData, setConsolidatedData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Visibility state for series toggling
  const [visible, setVisible] = useState({
    // Volume
    tokens: true,
    trailing7: true,
    trailing28: true,
    avg_input: true,
    avg_output: true,
    // Spend
    spend: true,
    trailing28_spend: true,
    arr: true,
    // Consolidated
    anthropic: true,
    openai: true,
    trailing28_total: true,
  });

  const toggleSeries = (key) => {
    setVisible(prev => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (tab === 'consolidated') {
          const [anthVol, anthPrice, oaiVol, oaiPrice] = await Promise.all([
            fetch(`/api/data?provider=anthropic&days=${days}`).then(r => r.json()),
            fetch(`/api/prices?provider=anthropic&days=${days}`).then(r => r.json()),
            fetch(`/api/data?provider=openai&days=${days}`).then(r => r.json()),
            fetch(`/api/prices?provider=openai&days=${days}`).then(r => r.json()),
          ]);

          if (cancelled) return;
          if (anthVol.error || anthPrice.error || oaiVol.error || oaiPrice.error) {
            throw new Error('Failed to load one of the datasets');
          }

          const anthPriceMap = Object.fromEntries((anthPrice.daily || []).map(p => [p.date, p]));
          const oaiPriceMap = Object.fromEntries((oaiPrice.daily || []).map(p => [p.date, p]));

          const dateSet = new Set([
            ...(anthVol.daily || []).map(d => d.date),
            ...(oaiVol.daily || []).map(d => d.date),
          ]);
          const allDates = Array.from(dateSet).sort();

          const merged = allDates.map(date => {
            const anth = (anthVol.daily || []).find(d => d.date === date) || {};
            const oai = (oaiVol.daily || []).find(d => d.date === date) || {};

            const anthPrice = anthPriceMap[date];
            const oaiPrice = oaiPriceMap[date];

            const anthBlended = anthPrice ? anthPrice.avg_input * 0.75 + anthPrice.avg_output * 0.25 : null;
            const oaiBlended = oaiPrice ? oaiPrice.avg_input * 0.75 + oaiPrice.avg_output * 0.25 : null;

            const anthSpend = (anthBlended != null && anth.tokens) ? (anth.tokens / 1_000_000) * anthBlended : 0;
            const oaiSpend = (oaiBlended != null && oai.tokens) ? (oai.tokens / 1_000_000) * oaiBlended : 0;

            return {
              date,
              anthropic: anthSpend,
              openai: oaiSpend,
              total: anthSpend + oaiSpend,
            };
          });

          const totals = merged.map(d => d.total || 0);
          const t28 = [];
          let sum = 0;
          const q = [];
          for (let i = 0; i < totals.length; i++) {
            sum += totals[i];
            q.push(totals[i]);
            if (q.length > 28) sum -= q.shift();
            t28.push(q.length === 28 ? sum / 28 : null);
          }
          merged.forEach((d, i) => { d.trailing28_total = t28[i]; });

          setConsolidatedData(merged);
        } else {
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
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [provider, days, tab]);

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

  const corrPoints = (ARR_POINTS[provider] || [])
    .map(p => {
      const spend = nearestSpend(data, p.date);
      return spend != null ? { date: p.date, spend, arr: p.arr } : null;
    })
    .filter(Boolean);

  const trend = linearTrend(corrPoints);

  const handleDownload = () => {
    if (tab === 'corr') {
      downloadCSV(`correlation_${provider}.csv`, corrPoints);
    } else if (tab === 'consolidated') {
      downloadCSV(`consolidated_spend_${days}d.csv`, consolidatedData);
    } else {
      downloadCSV(`${tab}_${provider}_${days}d.csv`, data);
    }
  };

  const legendClick = (e) => {
    if (e && e.dataKey) toggleSeries(e.dataKey);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={tabStyle(tab === 'volume')} onClick={() => setTab('volume')}>Volume & Price</button>
        <button style={tabStyle(tab === 'spend')} onClick={() => setTab('spend')}>Estimated Spend</button>
        <button style={tabStyle(tab === 'corr')} onClick={() => setTab('corr')}>Correlation</button>
        <button style={tabStyle(tab === 'consolidated')} onClick={() => setTab('consolidated')}>Consolidated Spend</button>
        <button
          onClick={handleDownload}
          style={{ marginLeft: 'auto', padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Download CSV
        </button>
      </div>

      {tab !== 'consolidated' && (
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
      )}

      {tab === 'consolidated' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            Lookback:&nbsp;
            <select value={days} onChange={e => setDays(Number(e.target.value))}>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
        </div>
      )}

      {tab === 'corr' ? (
        <ResponsiveContainer width="100%" height={440}>
          <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="spend"
              name="28-day trailing spend"
              tickFormatter={v => '$' + (v / 1e6).toFixed(1) + 'M'}
            />
            <YAxis
              type="number"
              dataKey="arr"
              name="Reported ARR"
              tickFormatter={v => '$' + (v / 1e9).toFixed(0) + 'B'}
            />
            <ZAxis range={[80, 80]} />
            <Tooltip
              formatter={(value, name) => {
                if (name === 'Reported ARR') return ['$' + (value / 1e9).toFixed(1) + 'B', name];
                if (name === '28-day trailing spend') return ['$' + (value / 1e6).toFixed(1) + 'M', name];
                return [value, name];
              }}
              labelFormatter={() => ''}
            />
            <Legend onClick={legendClick} />
            <Scatter name="ARR vs 28d spend" data={corrPoints} fill="#e74c3c" />
            <Line
              data={trend}
              dataKey="trend"
              stroke="#8884d8"
              dot={false}
              legendType="none"
              strokeDasharray="5 5"
            />
          </ScatterChart>
        </ResponsiveContainer>
      ) : tab === 'consolidated' ? (
        <ResponsiveContainer width="100%" height={440}>
          <BarChart data={consolidatedData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="
