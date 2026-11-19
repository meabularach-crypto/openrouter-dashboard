import { NextResponse } from 'next/server';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/datasets/rankings-daily';

function rolling(arr, window) {
  const out = [];
  let sum = 0;
  const q = [];
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    q.push(arr[i]);
    if (q.length > window) sum -= q.shift();
    out.push(q.length === window ? sum : null);
  }
  return out;
}

export async function GET(req) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set in environment variables' }, { status: 500 });
  }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get('days') || '90';
  const isSince2025 = daysParam === 'since2025';
  const provider = (url.searchParams.get('provider') || 'anthropic').toLowerCase();

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const endStr = end.toISOString().slice(0, 10);

  const windows = [];
  if (isSince2025) {
    windows.push({ start: '2025-01-01', end: '2025-12-31' });
    windows.push({ start: '2026-01-01', end: endStr });
  } else {
    const days = Math.min(365, Math.max(7, parseInt(daysParam, 10) || 90));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    windows.push({ start: start.toISOString().slice(0, 10), end: endStr });
  }

  try {
    const allRows = [];
    for (const win of windows) {
      const res = await fetch(
        `${OPENROUTER_BASE}?start_date=${win.start}&end_date=${win.end}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          next: { revalidate: 3600 },
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.warn(`OpenRouter ${res.status} for ${win.start}-${win.end}: ${text.slice(0, 200)}`);
        continue;
      }

      const raw = await res.json();
      const rows = Array.isArray(raw) ? raw : raw.data || raw.rows || [];
      allRows.push(...rows);
    }

    const prefix = provider === 'openai' ? 'openai/' : 'anthropic/';
    const byDate = {};

    for (const row of allRows) {
      const slug = row.model_permaslug || row.model || '';
      if (!slug.startsWith(prefix)) continue;

      const date = (row.date || '').slice(0, 10);
      if (!date) continue;

      const tokens = Number(row.total_tokens || row.tokens || 0);
      if (!byDate[date]) byDate[date] = 0;
      byDate[date] += tokens;
    }

    const dates = Object.keys(byDate).sort();
    const totals = dates.map(d => byDate[d]);
    const t7 = rolling(totals, 7);
    const t28 = rolling(totals, 28);

    const daily = dates.map((date, i) => ({
      date,
      tokens: totals[i],
      trailing7: t7[i],
      trailing28: t28[i],
    }));

    return NextResponse.json({
      daily,
      meta: {
        provider,
        start: windows[0].start,
        end: endStr,
        days: isSince2025 ? 'since2025' : daysParam,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
