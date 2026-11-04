import { NextResponse } from 'next/server';

const PRICE_URL = 'https://www.aipricing.guru/api/price-history.json';

function average(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
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

    const daily = [];

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
        daily.push({
          date,
          avg_input: average(inputs),
          avg_output: average(outputs),
        });
      }
    }

    daily.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      daily,
      meta: { provider, days, start: startStr },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
