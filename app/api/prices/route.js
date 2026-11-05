import { NextResponse } from 'next/server';

const PRICE_URL = 'https://www.aipricing.guru/api/price-history.json';

// Approximate blended averages ($/M, 75/25 input/output mix) for periods before the live feed.
// These are rough but stable enough for historical correlation.
const HISTORICAL_AVG = {
  anthropic: [
    { from: '2024-01-01', to: '2024-06-30', avg_input: 15, avg_output: 75 },   // Claude 3 Opus era
    { from: '2024-07-01', to: '2025-03-31', avg_input: 3, avg_output: 15 },    // Claude 3.5 Sonnet dominant
    { from: '2025-04-01', to: '2026-04-15', avg_input: 3, avg_output: 15 },
  ],
  openai: [
    { from: '2024-01-01', to: '2024-05-12', avg_input: 5, avg_output: 15 },    // GPT-4 Turbo
    { from: '2024-05-13', to: '2025-12-31', avg_input: 2.5, avg_output: 10 },  // GPT-4o era
    { from: '2026-01-01', to: '2026-04-15', avg_input: 2.5, avg_output: 10 },
  ],
};

function average(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function getHistorical(provider, date) {
  const ranges = HISTORICAL_AVG[provider] || [];
  for (const r of ranges) {
    if (date >= r.from && date <= r.to) {
      return { avg_input: r.avg_input, avg_output: r.avg_output };
    }
  }
  return null;
}

export async function GET(req) {
  const url = new URL(req.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10), 365);
  const provider = (url.searchParams.get('provider') || 'anthropic').toLowerCase();

  try {
    const res = await fetch(PRICE_URL, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`Price feed ${res.status}`);
    const json = await res.json();

    const snapshots = json.snapshots || json.data || json;
    if (!Array.isArray(snapshots)) {
      return NextResponse.json({ error: 'Unexpected price data format' }, { status: 500 });
    }

    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - days);
    const startStr = start.toISOString().slice(0, 10);

    const dailyMap = {};

    for (const snap of snapshots) {
      const date = (snap.date || snap.snapshotDate || '').slice(0, 10);
      if (!date || date < startStr) continue;

      const models = snap.models || snap.prices || [];
      const inputs = [];
      const outputs = [];

      for (const m of models) {
        const id = (m.id || m.model || m.slug || '').toLowerCase();
        const isProvider = provider === 'openai'
          ? id.includes('gpt') || id.includes('openai') || id.startsWith('o1') || id.startsWith('o3')
          : id.includes('claude') || id.includes('anthropic');

        if (!isProvider) continue;

        const inp = m.inputPerM ?? m.input ?? m.prompt;
        const out = m.outputPerM ?? m.output ?? m.completion;
        if (inp != null) inputs.push(Number(inp));
        if (out != null) outputs.push(Number(out));
      }

      if (inputs.length || outputs.length) {
        dailyMap[date] = {
          avg_input: average(inputs),
          avg_output: average(outputs),
        };
      }
    }

    // Fill any missing dates in the window with historical fallback
    const result = [];
    const cursor = new Date(startStr);
    const endDate = new Date();
    while (cursor <= endDate) {
      const d = cursor.toISOString().slice(0, 10);
      if (dailyMap[d]) {
        result.push({ date: d, ...dailyMap[d] });
      } else {
        const hist = getHistorical(provider, d);
        if (hist) result.push({ date: d, ...hist });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    result.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      daily: result,
      meta: { provider, days, start: startStr },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
