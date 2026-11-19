import { NextResponse } from 'next/server';

const PRICE_URL = 'https://www.aipricing.guru/api/price-history.json';

// Approximate blended list prices for the period before AI Pricing Guru data begins.
// These are volume-weighted averages of the dominant models that were active.
const HISTORICAL = {
  anthropic: { input: 4.5, output: 22.5 },   // mostly 3.5 Sonnet + some Opus/Haiku
  openai:    { input: 2.2, output: 9.0 },    // mostly GPT-4o + 4o-mini + some o-series
};

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
        avg_input: median(inputs),
        avg_output: median(outputs),
        n_models: models.length,
        source: 'aipricing.guru',
      };
    }

    // Fill gap from 2025-01-01 up to the first Guru snapshot with a static approximation
    const hist = HISTORICAL[provider];
    if (hist) {
      const firstGuru = Object.keys(byDate).sort()[0] || '2026-04-16';
      const start = new Date('2025-01-01');
      const end = new Date(firstGuru);
      end.setUTCDate(end.getUTCDate() - 1);
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const date = d.toISOString().slice(0, 10);
        if (!byDate[date]) {
          byDate[date] = {
            date,
            median_input: hist.input,
            median_output: hist.output,
            avg_input: hist.input,
            avg_output: hist.output,
            n_models: 0,
            source: 'historical-approximation',
          };
        }
      }
    }

    const series = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({
      series,
      daily: series,
      meta: {
        provider,
        source: 'AI Pricing Guru + historical approximation pre-2026-04-16',
        snapshotCount: snaps.length,
        historicalFilled: hist ? true : false,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
