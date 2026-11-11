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
    { date: '2026-09-30', arr: 71e9 },
    { date: '2026-10-31', arr: 81e9 },
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

const MODEL_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#95a5a6', '#d35400',
  '#16a085', '#8e44ad',
];

const PROVIDER_COLORS = {
  deepseek: '#e74c3c',
  openai: '#3498db',
  anthropic: '#9b59b6',
  google: '#f39c12',
  meta: '#2ecc71',
  'z-ai': '#1abc9c',
  tencent: '#e67e22',
  moonshotai: '#34495e',
  minimax: '#d35400',
  nvidia: '#16a085',
  xiaomi: '#8e44ad',
  stepfun: '#27ae60',
  qwen: '#2980b9',
  mistralai: '#c0392b',
  other: '#95a5a6',
};

const CATEGORY_COLORS = {
  programming: '#3498db',
  technology: '#2ecc71',
  roleplay: '#e74c3c',
  marketing: '#f39c12',
  science: '#9b59b6',
  translation: '#1abc9c',
  legal: '#e67e22',
  finance: '#27ae60',
  health: '#e84393',
  academia: '#8e44ad',
  trivia: '#95a5a6',
  unclassified: '#7f8c8d',
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

function toPercent(data, keys) {
  if (!data || !keys || !keys.length) return data || [];
  return data.map(row => {
    const total = keys.reduce((sum, k) => sum + (Number(row[k]) || 0), 0);
    const out = { ...row };
    if (total === 0) {
      keys.forEach(k => { out[k] = 0; });
    } else {
      keys.forEach(k => { out[k] = ((Number(row[k]) || 0) / total) * 100; });
    }
    return out;
  });
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
  const [categoryProvider, setCategoryProvider] = useState('total');
  const [days, setDays] = useState(90);
  const [showPrice, setShowPrice] = useState(false);
  const [data, setData] = useState([]);
  const [consolidatedData, setConsolidatedData] = useState([]);
  const [modelDaily, setModelDaily] = useState([]);
  const [modelKeys, setModelKeys] = useState([]);
  const [categoryWeekly, setCategoryWeekly] = useState([]);
  const [categoryKeys, setCategoryKeys] = useState([]);
  const [providerDaily, setProviderDaily] = useState([]);
  const [providerKeys, setProviderKeys] = useState([]);
  const [modelByProviderDaily, setModelByProviderDaily] = useState([]);
  const [modelByProviderKeys, setModelByProviderKeys] = useState([]);
  const [showPercent, setShowPercent] = useState(false);
  const [hiddenPoints, setHiddenPoints] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [visible, setVisible] = useState({
    tokens: true, trailing7: true, trailing28: true,
    avg_input: true, avg_output: true,
    spend: true, trailing28_spend: true, arr: true,
    anthropic: true, openai: true, trailing28_total: true,
    trailing28_anthropic: true, trailing28_openai: true,
  });

  const toggleSeries = (key) => setVisible(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (tab === 'models') {
          const res = await fetch(`/api/models?provider=${provider}&days=${days}`);
          const json = await res.json();
          if (cancelled) return;
          if (json.error) throw new Error(json.error);
          setModelDaily(json.daily || []);
          setModelKeys(json.models || []);
          // ensure new model keys start visible
          setVisible(prev => {
            const next = { ...prev };
            (json.models || []).forEach(m => { if (next[m] === undefined) next[m] = true; });
            return next;
          });
        } else if (tab === 'categories') {
          const res = await fetch(`/api/categories?days=${days}&provider=${categoryProvider}`);
          const json = await res.json();
          if (cancelled) return;
          if (json.error) throw new Error(json.error);
          setCategoryWeekly(json.weekly || []);
          setCategoryKeys(json.categories || []);
          setVisible(prev => {
            const next = { ...prev };
            (json.categories || []).forEach(c => { if (next[c] === undefined) next[c] = true; });
            return next;
          });
        } else if (tab === 'providers') {
          const res = await fetch(`/api/providers?days=${days}&top=10`);
          const json = await res.json();
          if (cancelled) return;
          if (json.error) throw new Error(json.error);
          setProviderDaily(json.daily || []);
          setProviderKeys(json.providers || []);
          setVisible(prev => {
            const next = { ...prev };
            (json.providers || []).forEach(p => { if (next[p] === undefined) next[p] = true; });
            return next;
          });
        } else if (tab === 'models-by-provider') {
          const res = await fetch(`/api/models-by-provider?provider=${modelByProvider}&days=${days}&top=8`);
          const json = await res.json();
          if (cancelled) return;
          if (json.error) throw new Error(json.error);
          setModelByProviderDaily(json.daily || []);
          setModelByProviderKeys(json.models || []);
          setVisible(prev => {
            const next = { ...prev };
            (json.models || []).forEach(m => { if (next[m] === undefined) next[m] = true; });
            return next;
          });
        } else if (tab === 'consolidated') {
          const [anthVol, anthPrice, oaiVol, oaiPrice] = await Promise.all([
            fetch(`/api/data?provider=anthropic&days=${days}`).then(r => r.json()),
            fetch(`/api/prices?provider=anthropic&days=${days}`).then(r => r.json()),
            fetch(`/api/data?provider=openai&days=${days}`).then(r => r.json()),
            fetch(`/api/prices?provider=openai&days=${days}`).then(r => r.json()),
          ]);
          if (cancelled) return;
          if (anthVol.error || anthPrice.error || oaiVol.error || oaiPrice.error) throw new Error('Failed to load datasets');

          const anthPriceMap = Object.fromEntries((anthPrice.daily || []).map(p => [p.date, p]));
          const oaiPriceMap = Object.fromEntries((oaiPrice.daily || []).map(p => [p.date, p]));
          const dateSet = new Set([...(anthVol.daily || []).map(d => d.date), ...(oaiVol.daily || []).map(d => d.date)]);
          const allDates = Array.from(dateSet).sort();

          const merged = allDates.map(date => {
            const anth = (anthVol.daily || []).find(d => d.date === date) || {};
            const oai = (oaiVol.daily || []).find(d => d.date === date) || {};
            const aP = anthPriceMap[date];
            const oP = oaiPriceMap[date];
            const aBlend = aP ? aP.avg_input * 0.75 + aP.avg_output * 0.25 : null;
            const oBlend = oP ? oP.avg_input * 0.75 + oP.avg_output * 0.25 : null;
            const aSpend = (aBlend != null && anth.tokens) ? (anth.tokens / 1e6) * aBlend : 0;
            const oSpend = (oBlend != null && oai.tokens) ? (oai.tokens / 1e6) * oBlend : 0;
            return { date, anthropic: aSpend, openai: oSpend, total: aSpend + oSpend };
          });

          const calcTrailing = (key) => {
            const vals = merged.map(d => d[key] || 0);
            const t28 = [];
            let sum = 0; const q = [];
            for (let i = 0; i < vals.length; i++) {
              sum += vals[i]; q.push(vals[i]);
              if (q.length > 28) sum -= q.shift();
              t28.push(q.length === 28 ? sum / 28 : null);
            }
            return t28;
          };

          const t28Total = calcTrailing('total');
          const t28Anth = calcTrailing('anthropic');
          const t28Oai = calcTrailing('openai');
          merged.forEach((d, i) => {
            d.trailing28_total = t28Total[i];
            d.trailing28_anthropic = t28Anth[i];
            d.trailing28_openai = t28Oai[i];
          });

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

          const priceMap = Object.fromEntries((priceJson.daily || []).map(p => [p.date, p]));
          const arrMap = Object.fromEntries((ARR_POINTS[provider] || []).map(p => [p.date, p.arr]));

          const merged = (volJson.daily || []).map(d => {
            const avgInput = priceMap[d.date]?.avg_input ?? null;
            const avgOutput = priceMap[d.date]?.avg_output ?? null;
            const blended = (avgInput != null && avgOutput != null) ? avgInput * 0.75 + avgOutput * 0.25 : null;
            const spend = (blended != null && d.tokens) ? (d.tokens / 1e6) * blended : null;
            return { ...d, avg_input: avgInput, avg_output: avgOutput, blended_price: blended, spend, arr: arrMap[d.date] ?? null };
          });

          const spends = merged.map(d => d.spend || 0);
          const t28 = []; let sum = 0; const q = [];
          for (let i = 0; i < spends.length; i++) {
            sum += spends[i]; q.push(spends[i]);
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
  }, [provider, days, tab, categoryProvider, modelByProvider]);

  if (error) return <div style={{ color: 'red', padding: 20 }}>Error: {error}</div>;
  if (loading) return <div style={{ padding: 20 }}>Loading…</div>;

  const tabStyle = (active) => ({
    padding: '8px 16px', border: 'none', background: active ? '#111' : '#eee',
    color: active ? '#fff' : '#111', cursor: 'pointer', borderRadius: 6,
  });

  const rawCorrPoints = (ARR_POINTS[provider] || []).map(p => {
    const spend = nearestSpend(data, p.date);
    return spend != null ? { date: p.date, spend, arr: p.arr, id: p.date } : null;
  }).filter(Boolean);

  const corrPoints = rawCorrPoints.filter(p => !hiddenPoints.has(p.id));
  const trend = linearTrend(corrPoints);

  const handlePointClick = (point) => {
    if (!point || !point.id) return;
    setHiddenPoints(prev => {
      const next = new Set(prev);
      if (next.has(point.id)) next.delete(point.id);
      else next.add(point.id);
      return next;
    });
  };

  const handleDownload = () => {
    if (tab === 'corr') downloadCSV(`correlation_${provider}.csv`, corrPoints);
    else if (tab === 'consolidated') downloadCSV(`consolidated_spend_${days}d.csv`, consolidatedData);
    else if (tab === 'models') downloadCSV(`model_mix_${provider}_${days}d.csv`, modelDaily);
    else if (tab === 'categories') downloadCSV(`categories_${days}d.csv`, categoryWeekly);
    else if (tab === 'providers') downloadCSV(`providers_${days}d.csv`, providerDaily);
    else if (tab === 'models-by-provider') downloadCSV(`model_mix_${modelByProvider}_${days}d.csv`, modelByProviderDaily);
    else downloadCSV(`${tab}_${provider}_${days}d.csv`, data);
  };

  const legendClick = (e) => { if (e?.dataKey) toggleSeries(e.dataKey); };

  const volumeLegendPayload = [
    { value: 'Daily tokens', dataKey: 'tokens', color: '#8884d8', type: 'line' },
    { value: '7-day trailing', dataKey: 'trailing7', color: '#82ca9d', type: 'line' },
    { value: '28-day trailing', dataKey: 'trailing28', color: '#ffc658', type: 'line' },
    ...(showPrice ? [
      { value: 'Avg input $/M', dataKey: 'avg_input', color: '#ff7300', type: 'line' },
      { value: 'Avg output $/M', dataKey: 'avg_output', color: '#d45087', type: 'line' },
    ] : []),
  ];

  const spendLegendPayload = [
    { value: 'Estimated daily spend', dataKey: 'spend', color: '#8884d8', type: 'line' },
    { value: '28-day trailing spend', dataKey: 'trailing28_spend', color: '#ffc658', type: 'line' },
    { value: 'Reported ARR', dataKey: 'arr', color: '#e74c3c', type: 'rect' },
  ];

  const consolidatedLegendPayload = [
    { value: 'Anthropic', dataKey: 'anthropic', color: '#e74c3c', type: 'rect' },
    { value: 'OpenAI', dataKey: 'openai', color: '#3498db', type: 'rect' },
    { value: '28-day trailing total', dataKey: 'trailing28_total', color: '#f39c12', type: 'line' },
    { value: '28-day Anthropic', dataKey: 'trailing28_anthropic', color: '#c0392b', type: 'line' },
    { value: '28-day OpenAI', dataKey: 'trailing28_openai', color: '#2980b9', type: 'line' },
  ];

  const legendFormatter = (value, entry) => {
    const key = entry.dataKey;
    const isVisible = visible[key] !== false;
    return <span style={{ color: isVisible ? '#333' : '#aaa', opacity: isVisible ? 1 : 0.55 }}>{value}</span>;
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={tabStyle(tab === 'volume')} onClick={() => setTab('volume')}>Volume & Price</button>
        <button style={tabStyle(tab === 'spend')} onClick={() => setTab('spend')}>Estimated Spend</button>
        <button style={tabStyle(tab === 'corr')} onClick={() => setTab('corr')}>Correlation</button>
        <button style={tabStyle(tab === 'consolidated')} onClick={() => setTab('consolidated')}>Consolidated Spend</button>
        <button style={tabStyle(tab === 'models')} onClick={() => setTab('models')}>Model Mix</button>
        <button style={tabStyle(tab === 'models-by-provider')} onClick={() => setTab('models-by-provider')}>Model Mix by Provider</button>
        <button style={tabStyle(tab === 'categories')} onClick={() => setTab('categories')}>Task Categories</button>
        <button style={tabStyle(tab === 'providers')} onClick={() => setTab('providers')}>Providers</button>
        <button onClick={handleDownload} style={{ marginLeft: 'auto', padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Download CSV
        </button>
      </div>

      {tab !== 'consolidated' && tab !== 'categories' && tab !== 'providers' && tab !== 'models-by-provider' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>Provider:&nbsp;
            <select value={provider} onChange={e => setProvider(e.target.value)}>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label>Lookback:&nbsp;
            <select value={days} onChange={e => setDays(Number(e.target.value))}>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          {tab === 'models' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showPercent} onChange={e => setShowPercent(e.target.checked)} />
              Show as % share
            </label>
          )}
          {tab === 'volume' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={showPrice} onChange={e => setShowPrice(e.target.checked)} />
              Show price overlay
            </label>
          )}
        </div>
      )}

      {(tab === 'consolidated' || tab === 'categories' || tab === 'providers' || tab === 'models-by-provider') && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {tab === 'categories' && (
            <label>View:&nbsp;
              <select value={categoryProvider} onChange={e => setCategoryProvider(e.target.value)}>
                <option value="total">Total</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
          )}
          {tab === 'models-by-provider' && (
            <label>Provider:&nbsp;
              <select value={modelByProvider} onChange={e => setModelByProvider(e.target.value)}>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google</option>
                <option value="z-ai">Z.ai</option>
                <option value="tencent">Tencent</option>
                <option value="moonshotai">Moonshot</option>
                <option value="minimax">MiniMax</option>
                <option value="nvidia">NVIDIA</option>
                <option value="xiaomi">Xiaomi</option>
                <option value="stepfun">StepFun</option>
                <option value="qwen">Qwen</option>
                <option value="meta">Meta</option>
                <option value="mistralai">Mistral</option>
              </select>
            </label>
          )}
          <label>Lookback:&nbsp;
            <select value={days} onChange={e => setDays(Number(e.target.value))}>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showPercent} onChange={e => setShowPercent(e.target.checked)} />
            Show as % share
          </label>
        </div>
      )}

      {tab === 'categories' ? (
        <ResponsiveContainer width="100%" height={520}>
          <BarChart data={showPercent ? toPercent(categoryWeekly, categoryKeys) : categoryWeekly} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={30} angle={-35} textAnchor="end" height={60} />
            <YAxis tickFormatter={v => showPercent ? v.toFixed(0) + '%' : (v / 1e12).toFixed(1) + 'T'} domain={showPercent ? [0, 100] : undefined} />
            <Tooltip formatter={(value) => value != null ? (showPercent ? value.toFixed(1) + '%' : Number(value).toLocaleString() + ' tokens') : '—'} />
            <Legend
              onClick={legendClick}
              formatter={legendFormatter}
              payload={categoryKeys.map(cat => ({
                value: cat,
                dataKey: cat,
                color: CATEGORY_COLORS[cat] || '#888',
                type: 'rect',
              }))}
            />
            {categoryKeys.map((cat) => (
              visible[cat] !== false && (
                <Bar
                  key={cat}
                  dataKey={cat}
                  stackId="a"
                  fill={CATEGORY_COLORS[cat] || '#888'}
                  name={cat}
                />
              )
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : tab === 'providers' ? (
        <ResponsiveContainer width="100%" height={520}>
          <BarChart data={showPercent ? toPercent(providerDaily, providerKeys) : providerDaily} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={30} angle={-35} textAnchor="end" height={60} />
            <YAxis tickFormatter={v => showPercent ? v.toFixed(0) + '%' : (v / 1e12).toFixed(1) + 'T'} domain={showPercent ? [0, 100] : undefined} />
            <Tooltip formatter={(value) => value != null ? (showPercent ? value.toFixed(1) + '%' : Number(value).toLocaleString() + ' tokens') : '—'} />
            <Legend
              onClick={legendClick}
              formatter={legendFormatter}
              payload={providerKeys.map(p => ({
                value: p,
                dataKey: p,
                color: PROVIDER_COLORS[p] || '#888',
                type: 'rect',
              }))}
            />
            {providerKeys.map((p) => (
              visible[p] !== false && (
                <Bar
                  key={p}
                  dataKey={p}
                  stackId="a"
                  fill={PROVIDER_COLORS[p] || '#888'}
                  name={p}
                />
              )
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : tab === 'models' ? (
        <ResponsiveContainer width="100%" height={520}>
          <BarChart data={showPercent ? toPercent(modelDaily, modelKeys) : modelDaily} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={30} angle={-35} textAnchor="end" height={60} />
            <YAxis tickFormatter={v => showPercent ? v.toFixed(0) + '%' : (v / 1e12).toFixed(1) + 'T'} domain={showPercent ? [0, 100] : undefined} />
            <Tooltip formatter={(value) => value != null ? (showPercent ? value.toFixed(1) + '%' : Number(value).toLocaleString() + ' tokens') : '—'} />
            <Legend
              onClick={legendClick}
              formatter={legendFormatter}
              payload={modelKeys.map((model, i) => ({
                value: model,
                dataKey: model,
                color: MODEL_COLORS[i % MODEL_COLORS.length],
                type: 'rect',
              }))}
            />
            {modelKeys.map((model, i) => (
              visible[model] !== false && (
                <Bar
                  key={model}
                  dataKey={model}
                  stackId="a"
                  fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                  name={model}
                />
              )
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : tab === 'models-by-provider' ? (
        <ResponsiveContainer width="100%" height={520}>
          <BarChart data={showPercent ? toPercent(modelByProviderDaily, modelByProviderKeys) : modelByProviderDaily} margin={{ top: 10, right: 30, left: 10, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={30} angle={-35} textAnchor="end" height={60} />
            <YAxis tickFormatter={v => showPercent ? v.toFixed(0) + '%' : (v / 1e12).toFixed(1) + 'T'} domain={showPercent ? [0, 100] : undefined} />
            <Tooltip formatter={(value) => value != null ? (showPercent ? value.toFixed(1) + '%' : Number(value).toLocaleString() + ' tokens') : '—'} />
            <Legend
              onClick={legendClick}
              formatter={legendFormatter}
              payload={modelByProviderKeys.map((model, i) => ({
                value: model,
                dataKey: model,
                color: MODEL_COLORS[i % MODEL_COLORS.length],
                type: 'rect',
              }))}
            />
            {modelByProviderKeys.map((model, i) => (
              visible[model] !== false && (
                <Bar
                  key={model}
                  dataKey={model}
                  stackId="a"
                  fill={MODEL_COLORS[i % MODEL_COLORS.length]}
                  name={model}
                />
              )
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : tab === 'corr' ? (
        <ResponsiveContainer width="100%" height={440}>
          <ScatterChart margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="spend" name="28-day trailing spend" tickFormatter={v => '$' + (v / 1e6).toFixed(1) + 'M'} />
            <YAxis type="number" dataKey="arr" name="Reported ARR" tickFormatter={v => '$' + (v / 1e9).toFixed(0) + 'B'} />
            <ZAxis range={[80, 80]} />
            <Tooltip formatter={(value, name) => {
              if (name === 'Reported ARR') return ['$' + (value / 1e9).toFixed(1) + 'B', name];
              if (name === '28-day trailing spend') return ['$' + (value / 1e6).toFixed(1) + 'M', name];
              return [value, name];
            }} />
            <Legend onClick={legendClick} formatter={legendFormatter} />
            <Scatter name="ARR vs 28d spend" data={corrPoints} fill="#e74c3c" onClick={(e) => handlePointClick(e)} />
            <Line data={trend} dataKey="trend" stroke="#8884d8" dot={false} legendType="none" strokeDasharray="5 5" />
          </ScatterChart>
        </ResponsiveContainer>
      ) : tab === 'consolidated' ? (
        <ResponsiveContainer width="100%" height={440}>
          <ComposedChart data={showPercent ? toPercent(consolidatedData, ['anthropic', 'openai']) : consolidatedData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={40} />
            <YAxis tickFormatter={v => showPercent ? v.toFixed(0) + '%' : '$' + (v / 1e6).toFixed(1) + 'M'} domain={showPercent ? [0, 100] : undefined} />
            <Tooltip formatter={(value) => value != null ? (showPercent ? value.toFixed(1) + '%' : `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`) : '—'} />
            <Legend onClick={legendClick} formatter={legendFormatter} payload={consolidatedLegendPayload} />
            {visible.anthropic && <Bar dataKey="anthropic" name="Anthropic" stackId="a" fill="#e74c3c" />}
            {visible.openai && <Bar dataKey="openai" name="OpenAI" stackId="a" fill="#3498db" />}
            {visible.trailing28_total && <Line type="monotone" dataKey="trailing28_total" name="28-day trailing total" stroke="#f39c12" dot={false} />}
            {visible.trailing28_anthropic && <Line type="monotone" dataKey="trailing28_anthropic" name="28-day Anthropic" stroke="#c0392b" dot={false} strokeDasharray="4 2" />}
            {visible.trailing28_openai && <Line type="monotone" dataKey="trailing28_openai" name="28-day OpenAI" stroke="#2980b9" dot={false} strokeDasharray="4 2" />}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={440}>
          <ComposedChart data={data} margin={{ top: 10, right: 60, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" minTickGap={40} />
            {tab === 'volume' ? (
              <>
                <YAxis yAxisId="left" tickFormatter={v => (v / 1e12).toFixed(1) + 'T'} />
                {showPrice && <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tickFormatter={v => '$' + Number(v).toFixed(2)} />}
                <Tooltip />
                <Legend onClick={legendClick} formatter={legendFormatter} payload={volumeLegendPayload} />
                {visible.tokens && <Line yAxisId="left" type="monotone" dataKey="tokens" name="Daily tokens" stroke="#8884d8" dot={false} />}
                {visible.trailing7 && <Line yAxisId="left" type="monotone" dataKey="trailing7" name="7-day trailing" stroke="#82ca9d" dot={false} />}
                {visible.trailing28 && <Line yAxisId="left" type="monotone" dataKey="trailing28" name="28-day trailing" stroke="#ffc658" dot={false} />}
                {showPrice && visible.avg_input && <Line yAxisId="right" type="monotone" dataKey="avg_input" name="Avg input $/M" stroke="#ff7300" dot={false} connectNulls />}
                {showPrice && visible.avg_output && <Line yAxisId="right" type="monotone" dataKey="avg_output" name="Avg output $/M" stroke="#d45087" dot={false} connectNulls />}
              </>
            ) : (
              <>
                <YAxis yAxisId="left" tickFormatter={v => '$' + (v / 1e6).toFixed(1) + 'M'} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => '$' + (v / 1e9).toFixed(0) + 'B'} domain={['auto', 'auto']} />
                <Tooltip formatter={(value, name) => {
                  if (name === 'Reported ARR') return ['$' + (value / 1e9).toFixed(1) + 'B', name];
                  return [value != null ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—', name];
                }} />
                <Legend onClick={legendClick} formatter={legendFormatter} payload={spendLegendPayload} />
                {visible.spend && <Line yAxisId="left" type="monotone" dataKey="spend" name="Estimated daily spend" stroke="#8884d8" dot={false} connectNulls />}
                {visible.trailing28_spend && <Line yAxisId="left" type="monotone" dataKey="trailing28_spend" name="28-day trailing spend" stroke="#ffc658" dot={false} connectNulls />}
                {visible.arr && <Bar yAxisId="right" dataKey="arr" name="Reported ARR" fill="#e74c3c" barSize={12} />}
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
        Click any legend item to turn that series on or off. Inactive labels turn light gray; the data is fully removed so the axis rescales. On the Correlation tab, click any dot to remove it. Model Mix shows daily stacked bars of top models. Task Categories shows weekly stacked estimates by use-case (programming, finance, health, etc.) from OpenRouter’s sampled category data.
      </p>
    </div>
  );
}
