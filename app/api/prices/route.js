import { NextResponse } from 'next/server';

const PRICE_URL = 'https://www.aipricing.guru/api/price-history.json';

export async function GET(req) {
  const url = new URL(req.url);
  const provider = (url.searchParams.get('provider') || 'anthropic').toLowerCase();

  try {
    const res = await fetch(PRICE_URL, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return NextResponse.json({ error: `Price API ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    const snaps = data.snapshots || [];

    // Build daily median input/output for the requested provider
    const byDate = {};
    for (const snap of snaps) {
      const date = snap.date;
      const models = (snap.models || []).filter(m => m.provider === provider);
      if (!models.length) continue;

      const inputs = models.map(m => m.inputPerM).filter(n => n != null);
      const outputs = models.map(m => m.outputPerM).filter(n => n != null);
      if (!inputs.length) continue;

      const median = arr => {
        const s = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      };

      byDate[date] = {
        date,
        median_input: median(inputs),
        median_output: median(outputs),
        n_models: models.length,
      };
    }

    const series = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      series,
      meta: {
        provider,
        source: 'AI Pricing Guru',
        snapshotCount: snaps.length,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
