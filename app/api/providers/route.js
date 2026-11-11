import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(28, parseInt(searchParams.get('days') || '90', 10)));
  const topN = Math.min(25, Math.max(5, parseInt(searchParams.get('top') || '10', 10)));

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);

  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  try {
    const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startStr}&end_date=${endStr}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const rows = json.data || [];

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

    return NextResponse.json({
      days,
      top: topN,
      start_date: startStr,
      end_date: endStr,
      providers: active,
      daily,
      note: 'Daily token volume by model provider (prefix of model_permaslug). Top N by total volume; remainder in "other".',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
