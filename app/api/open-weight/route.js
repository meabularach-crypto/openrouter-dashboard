import { NextResponse } from 'next/server';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/datasets/rankings-daily';

// Providers treated as open-weight for this chart (matching the OpenRouter spend chart legend)
const OPEN_PROVIDERS = [
  'deepseek',
  'z-ai',
  'moonshotai',
  'qwen',
  'x-ai',
  'minimax',
];

const OPEN_SET = new Set(OPEN_PROVIDERS);

function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  // ISO week starting Monday
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(req) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get('days') || '90';
  const isSince2025 = daysParam === 'since2025';

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

  try {
    const allRows = [];
    for (const win of windows) {
      const res = await fetch(
        `${OPENROUTER_BASE}?start_date=${win.start}&end_date=${win.end}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          next: { revalidate: 3600 },
        }
      );
      if (!res.ok) continue;
      const json = await res.json();
      allRows.push(...(json.data || []));
    }

    // Aggregate to weekly totals
    const byWeek = {};
    for (const row of allRows) {
      const date = (row.date || '').slice(0, 10);
      if (!date) continue;
      const slug = (row.model_permaslug || '').toLowerCase();
      const provider = slug === 'other' || !slug.includes('/') ? 'other' : slug.split('/')[0];
      const tokens = Number(row.total_tokens) || 0;
      if (!tokens) continue;

      const week = getWeekKey(date);
      if (!byWeek[week]) byWeek[week] = { week, total: 0, open: {} };
      byWeek[week].total += tokens;
      if (OPEN_SET.has(provider)) {
        byWeek[week].open[provider] = (byWeek[week].open[provider] || 0) + tokens;
      }
    }

    const weekly = Object.values(byWeek)
      .sort((a, b) => a.week.localeCompare(b.week))
      .map(w => {
        const out = { week: w.week, total: w.total };
        for (const p of OPEN_PROVIDERS) {
          const tokens = w.open[p] || 0;
          out[p] = w.total > 0 ? (tokens / w.total) * 100 : 0;
          out[`${p}_tokens`] = tokens;
        }
        // Also compute total open share
        const openTokens = OPEN_PROVIDERS.reduce((s, p) => s + (w.open[p] || 0), 0);
        out.open_share = w.total > 0 ? (openTokens / w.total) * 100 : 0;
        return out;
      });

    return NextResponse.json({
      weekly,
      providers: OPEN_PROVIDERS,
      meta: {
        start: windows[0].start,
        end: endStr,
        days: isSince2025 ? 'since2025' : daysParam,
        note: 'Open-weight share of total token volume (proxy for spend). Providers: deepseek, z-ai, moonshotai, qwen, x-ai, minimax.',
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
