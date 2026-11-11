import { NextResponse } from 'next/server';

const CATEGORIES = [
  'programming',
  'technology',
  'roleplay',
  'marketing',
  'science',
  'translation',
  'legal',
  'finance',
  'health',
  'academia',
  'trivia',
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(28, parseInt(searchParams.get('days') || '180', 10)));
  const provider = (searchParams.get('provider') || 'total').toLowerCase(); // total | anthropic | openai

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

  const headers = { Authorization: `Bearer ${key}` };

  try {
    // 1. Fetch category estimates (weekly)
    const categoryResults = await Promise.all(
      CATEGORIES.map(async (category) => {
        const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startStr}&end_date=${endStr}&category=${encodeURIComponent(category)}&period=week`;
        const res = await fetch(url, { headers, next: { revalidate: 3600 } });
        if (!res.ok) {
          console.warn(`Category ${category} failed: ${res.status}`);
          return { category, rows: [] };
        }
        const json = await res.json();
        return { category, rows: json.data || [] };
      })
    );

    // 2. Fetch platform total (no category filter, weekly grain so dates align)
    const totalUrl = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startStr}&end_date=${endStr}&period=week`;
    const totalRes = await fetch(totalUrl, { headers, next: { revalidate: 3600 } });
    let totalByWeek = {};
    if (totalRes.ok) {
      const totalJson = await totalRes.json();
      for (const row of totalJson.data || []) {
        const slug = (row.model_permaslug || '').toLowerCase();
        if (provider === 'anthropic' && !slug.startsWith('anthropic/') && slug !== 'other') continue;
        if (provider === 'openai' && !slug.startsWith('openai/') && slug !== 'other') continue;
        // For provider-specific, we only count matching models; for total we count everything including "other"
        const week = row.date;
        const tokens = Number(row.total_tokens) || 0;
        if (!tokens) continue;
        totalByWeek[week] = (totalByWeek[week] || 0) + tokens;
      }
    }

    // 3. Aggregate categories
    const byWeek = {};
    for (const { category, rows } of categoryResults) {
      for (const row of rows) {
        const slug = (row.model_permaslug || '').toLowerCase();
        if (provider === 'anthropic' && !slug.startsWith('anthropic/')) continue;
        if (provider === 'openai' && !slug.startsWith('openai/')) continue;

        const week = row.date;
        const tokens = Number(row.total_tokens) || 0;
        if (!tokens) continue;
        if (!byWeek[week]) byWeek[week] = { date: week };
        byWeek[week][category] = (byWeek[week][category] || 0) + tokens;
      }
    }

    // 4. Add unclassified = total - sum of categories
    const weekly = Object.values(byWeek)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(w => {
        const categorized = CATEGORIES.reduce((sum, c) => sum + (w[c] || 0), 0);
        const total = totalByWeek[w.date] || 0;
        const unclassified = Math.max(0, total - categorized);
        return { ...w, unclassified };
      });

    const active = [...CATEGORIES.filter(c => weekly.some(w => w[c] > 0)), 'unclassified'];

    return NextResponse.json({
      days,
      provider,
      start_date: startStr,
      end_date: endStr,
      categories: active,
      weekly,
      note: 'Weekly estimates. unclassified = platform total (rankings-daily without category) minus sum of the 11 sampled categories. Categories are upsampled estimates and may not cover all traffic.',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
