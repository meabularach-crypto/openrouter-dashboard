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

  try {
    const results = await Promise.all(
      CATEGORIES.map(async (category) => {
        const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startStr}&end_date=${endStr}&category=${encodeURIComponent(category)}&period=week`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          next: { revalidate: 3600 },
        });
        if (!res.ok) {
          console.warn(`Category ${category} failed: ${res.status}`);
          return { category, rows: [] };
        }
        const json = await res.json();
        return { category, rows: json.data || [] };
      })
    );

    const byWeek = {};
    for (const { category, rows } of results) {
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

    const weekly = Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date));
    const active = CATEGORIES.filter(c => weekly.some(w => w[c] > 0));

    return NextResponse.json({
      days,
      provider,
      start_date: startStr,
      end_date: endStr,
      categories: active,
      weekly,
      note: 'Weekly estimates from OpenRouter sampled category data. Provider filter is applied to model_permaslug prefixes.',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
