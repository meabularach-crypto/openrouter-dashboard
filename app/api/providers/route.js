import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get('days') || '90';
  const isSince2025 = daysParam === 'since2025';
  const topN = Math.min(25, Math.max(5, parseInt(searchParams.get('top') || '10', 10)));

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const endStr = end.toISOString().slice(0, 10);

  const windows = [];
  if (isSince2025) {
    windows.push({ start: '2025-01-01', end: '2025-12-31' });
    windows.push({ start: '2026-01-01', end: endStr });
  } else {
    const days = Math.min(365, Math.max(28, parseInt(daysParam, 10) || 90));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    windows.push({ start: start.toISOString().slice(0, 10), end: endStr });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  try {
    const allRows = [];
    for (const win of windows) {
      const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${win.start}&end_date=${win.end}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const json = await res.json();
      allRows.push(...(json.data || []));
    }

    const rows = allRows;

    // Aggregate by date + provider prefix
    const byDate = {};
    const providerTotals = {};

    for (const row of rows) {
      const date = row.date;
      const slug = (row.model_permaslug || 'other').toLowerCase();
      const provider = slug === 'other' || !slug.includes('/') ? 'other' : slug.split('/')[0];
      const tokens = Number(row.total_tokens) || 0;
      if (!tokens) continue;

      if (!byDate[date]) byDate[date] = { date };
      byDate[date][provider] = (byDate[date][provider] || 0) + tokens;
      providerTotals[provider] = (providerTotals[provider] || 0) + tokens;
    }

    // Pick top N providers by total volume, rest go into "other"
    const ranked = Object.entries(providerTotals)
      .filter(([p]) => p !== 'other')
      .sort((a, b) => b[1] - a[1]);

    const topProviders = ranked.slice(0, topN).map(([p]) => p);
    const topSet = new Set(topProviders);

    const daily = Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => {
        const out = { date: d.date };
        let other = d.other || 0;
        for (const [p, v] of Object.entries(d)) {
          if (p === 'date' || p === 'other') continue;
          if (topSet.has(p)) {
            out[p] = v;
          } else {
            other += v;
          }
        }
        if (other > 0) out.other = other;
        return out;
      });

    const active = [...topProviders];
    if (daily.some(d => d.other > 0)) active.push('other');

    const startStr = windows[0].start;

    return NextResponse.json({
      days: isSince2025 ? 'since2025' : daysParam,
      top: topN,
      start_date: startStr,
      end_date: endStr,
      providers: active,
      daily,
      note: isSince2025
        ? 'Combined 2025 full year + 2026 YTD. Daily token volume by model provider.'
        : 'Daily token volume by model provider (prefix of model_permaslug). Top N by total volume; remainder in "other".',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
