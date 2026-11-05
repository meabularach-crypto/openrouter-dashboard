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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (tab === 'consolidated') {
          // Load both providers
          const [anthVol, anthPrice, oaiVol, oaiPrice] = await Promise.all([
            fetch(`/api/data?provider=anthropic&days=${days}`).then(r => r.json()),
            fetch(`/api/prices?provider=anthropic&days=${days}`).then(r => r.json()),
            fetch(`/api/data?provider=openai&days=${days}`).then(r => r.json()),
            fetch(`/api/prices?provider=openai&days=${days}`).then(r => r.json()),
          ]);

          if (cancelled) return;
          if (anthVol.error || anthPrice.error || oaiVol.error || oaiPrice.error) {
            throw new Error('
