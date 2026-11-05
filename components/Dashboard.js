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

  const [visible, setVisible] = useState({
    tokens: true, trailing7: true, trailing28: true,
    avg_input: true, avg_output: true,
    spend: true, trailing28_spend: true, arr: true,
    anthropic: true, openai: true, trailing28_total: true,
  });

  const toggleSeries = (key) => setVisible(prev => ({ ...prev, [key]: !prev[key] }));

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

          const totals = merged.map(d => d.total || 0);
          const t28 = [];
          let sum = 0; const q = [];
          for (let i = 0; i < totals.length; i++) {
            sum += totals[i]; q.push(totals[i]);
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

          const priceMap = Object.fromEntries((priceJson.daily || []).map(p => [p.date, p]));
          const arrMap = Object.fromEntries
