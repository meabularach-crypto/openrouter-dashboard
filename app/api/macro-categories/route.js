import { NextResponse } from 'next/server';

// Map fine-grained rankings-daily categories into OpenRouter's four macro categories
const MACRO_MAP = {
  programming: 'code',
  technology: 'data',
  roleplay: 'general',
  marketing: 'general',
  science: 'data',
  translation: 'general',
  legal: 'general',
  finance: 'data',
  health: 'data',
  academia: 'data',
  trivia: 'general',
};

const MACROS = ['code', 'data', 'agent', 'general'];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(28, parseInt(searchParams.get('days') || '180', 10)));
  const provider = (searchParams.get('provider') || 'total').toLowerCase();

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
    // Fetch each fine-grained category (weekly)
    const categoryResults = await Promise.all(
      Object.keys(MACRO_MAP).map(async (category) => {
        const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startStr}&end_date=${endStr}&category=${encodeURIComponent(category)}&period=week`;
        const res = await fetch(url, { headers, next: { revalidate: 3600 } });
        if (!res.ok) return { category, rows: [] };
        const json = await res.json();
        return { category, rows: json.data || [] };
      })
    );

    // Platform total for unclassified remainder
    const totalUrl = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${startStr}&end_date=${endStr}&period=week`;
    const totalRes = await fetch(totalUrl, { headers, next: { revalidate: 3600 } });
    const totalByWeek = {};
    if (totalRes.ok) {
      const totalJson = await totalRes.json();
      for (const row of totalJson.data || []) {
        const slug = (row.model_permaslug || '').toLowerCase();
        if (provider === 'anthropic' && !slug.startsWith('anthropic/') && slug !== 'other') continue;
        if (provider === 'openai' && !slug.startsWith('openai/') && slug !== 'other') continue;
        const week = row.date;
        const tokens = Number(row.total_tokens) || 0;
        if (!tokens) continue;
        totalByWeek[week] = (totalByWeek[week] || 0) + tokens;
      }
    }

    // Aggregate into macros
    const byWeek = {};
    for (const { category, rows } of categoryResults) {
      const macro = MACRO_MAP[category];
      if (!macro) continue;
      for (const row of rows) {
        const slug = (row.model_permaslug || '').toLowerCase();
        if (provider === 'anthropic' && !slug.startsWith('anthropic/')) continue;
        if (provider === 'openai' && !slug.startsWith('openai/')) continue;
        const week = row.date;
        const tokens = Number(row.total_tokens) || 0;
        if (!tokens) continue;
        if (!byWeek[week]) byWeek[week] = { date: week };
        byWeek[week][macro] = (byWeek[week][macro] || 0) + tokens;
      }
    }

    // Ensure all weeks from total are present
    for (const week of Object.keys(totalByWeek)) {
      if (!byWeek[week]) byWeek[week] = { date: week };
    }

    const weekly = Object.values(byWeek)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(w => {
        const categorized = MACROS.reduce((sum, m) => sum + (w[m] || 0), 0);
        const total = totalByWeek[w.date] || 0;
        const unclassified = Math.max(0, total - categorized);
        return {
          date: w.date,
          code: w.code || 0,
          data: w.data || 0,
          agent: w.agent || 0,
          general: w.general || 0,
          unclassified,
        };
      });

    const active = [...MACROS, 'unclassified'];

    return NextResponse.json({
      days,
      provider,
      start_date: startStr,
      end_date: endStr,
      macros: active,
      weekly,
      note: 'Weekly estimates rolled up into OpenRouter macro categories (code, data, agent, general). unclassified = platform total minus the mapped categories.',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
