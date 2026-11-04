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
  const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10), 365);
  const provider = (url.searchParams.get('provider') || 'anthropic').toLowerCase();

  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days);

  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `${OPENROUTER_BASE}?start_date=${startStr}&end_date=${endStr}`,
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
      return NextResponse.json({ error: `OpenRouter ${res.status}: ${text}` }, { status: 502 });
    }

    const raw = await res.json();
    const rows = Array.isArray(raw) ? raw : raw.data || raw.rows || [];

    const prefix = provider === 'openai' ? 'openai/' : 'anthropic/';
    const byDate = {};

    for (const row of rows) {
      const slug = row.model_permaslug || row.model || '';
      const date = (row.date || '').slice(0, 10);
      if (!date) continue;

      const tokens = Number(row.total_tokens || row.tokens || 0);

      // Include provider models + the aggregated "other" row so totals are complete
      if (slug.startsWith(prefix) || slug === 'other') {
        if (!byDate[date]) byDate[date] = 0;
        byDate[date] += tokens;
      }
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
        start: startStr,
        end: endStr,
        days,
        fetchedAt: new Date().toISOString(),
        rowCount: rows.length,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
