import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const provider = (searchParams.get('provider') || 'anthropic').toLowerCase();
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get('days') || '90', 10)));

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

  const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startStr}&end_date=${endStr}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `OpenRouter ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
    }

    const json = await res.json();
    const rows = json.data || [];

    const prefix = provider === 'openai' ? 'openai/' : 'anthropic/';
    const totals = {};

    for (const row of rows) {
      const slug = row.model_permaslug || '';
      if (!slug.startsWith(prefix) || slug === 'other') continue;
      const tokens = Number(row.total_tokens) || 0;
      if (!tokens) continue;
      totals[slug] = (totals[slug] || 0) + tokens;
    }

    const models = Object.entries(totals)
      .map(([model, tokens]) => ({
        model: model.replace(prefix, ''),
        tokens,
        tokensM: Math.round(tokens / 1e6),
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 15);

    return NextResponse.json({
      provider,
      days,
      start_date: startStr,
      end_date: endStr,
      models,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
