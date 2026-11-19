import { NextResponse } from 'next/server';

// Models we always want broken out as their own series (when present)
const FORCE_INCLUDE = [
  'claude-fable-5.2',
  'claude-fable-5-2',
  'claude-mythos-5.2',
  'claude-mythos-5-2',
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get('days') || '90';
  const isSince2025 = daysParam === 'since2025';
  const provider = (searchParams.get('provider') || 'anthropic').toLowerCase();

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const endStr = end.toISOString().slice(0, 10);

  const windows = [];
  if (isSince2025) {
    windows.push({ start: '2025-01-01', end: '2025-12-31' });
    windows.push({ start: '2026-01-01', end: endStr });
  } else {
    const days = Math.min(365, Math.max(7, parseInt(daysParam, 10) || 90));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    windows.push({ start: start.toISOString().slice(0, 10), end: endStr });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  try {
    const allRows = [];
    for (const win of windows) {
      const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${win.start}&end_date=${win.end}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        next: { revalidate: 3600 },
      });
      if (!res.ok) continue;
      const json = await res.json();
      allRows.push(...(json.data || []));
    }

    const rows = allRows;

    // Temporary debug: collect sample Anthropic slugs so we can see real names
    const sampleSlugs = [...new Set(
      rows
        .filter(r => (r.model_permaslug || '').toLowerCase().startsWith('anthropic/'))
        .map(r => r.model_permaslug)
        .slice(0, 40)
    )];

    const prefix = provider === 'openai' ? 'openai/' : 'anthropic/';
    const byDate = {};
    const modelTotals = {};

    for (const row of rows) {
      const slug = (row.model_permaslug || '').toLowerCase();
      if (!slug.startsWith(prefix) || slug === 'other') continue;
      const tokens = Number(row.total_tokens) || 0;
      if (!tokens) continue;

      // Normalize model name: strip provider prefix and any :variant suffix
      let model = slug.replace(prefix, '').replace(/:[^/]+$/, '');
      // Collapse known Fable/Mythos 5.x variants into a single label
      if (model.includes('fable') && (model.includes('5.2') || model.includes('5-2'))) model = 'claude-fable-5.2';
      if (model.includes('mythos') && (model.includes('5.2') || model.includes('5-2'))) model = 'claude-mythos-5.2';

      const date = row.date;

      if (!byDate[date]) byDate[date] = { date };
      byDate[date][model] = (byDate[date][model] || 0) + tokens;
      modelTotals[model] = (modelTotals[model] || 0) + tokens;
    }

    // Top models by volume
    let topModels = Object.entries(modelTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([m]) => m);

    // Always force-include Fable 5.2 / Mythos 5.2 if they have any volume
    for (const forced of FORCE_INCLUDE) {
      const normalized = forced.includes('fable') ? 'claude-fable-5.2' : forced.includes('mythos') ? 'claude-mythos-5.2' : forced;
      if (modelTotals[normalized] > 0 && !topModels.includes(normalized)) {
        topModels.push(normalized);
      }
    }

    // Keep list unique and reasonably sized
    topModels = [...new Set(topModels)];

    const daily = Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => {
        const out = { date: d.date };
        let other = 0;
        for (const [model, tokens] of Object.entries(d)) {
          if (model === 'date') continue;
          if (topModels.includes(model)) {
            out[model] = tokens;
          } else {
            other += tokens;
          }
        }
        if (other > 0) out.other = other;
        return out;
      });

    const models = [...topModels];
    if (daily.some(d => d.other)) models.push('other');

    const startStr = windows[0].start;

    return NextResponse.json({
      provider,
      days: isSince2025 ? 'since2025' : daysParam,
      start_date: startStr,
      end_date: endStr,
      models,
      daily,
      sample_anthropic_slugs: sampleSlugs,
      note: isSince2025
        ? 'Combined 2025 full year + 2026 YTD. claude-fable-5.2 is force-included when present.'
        : 'claude-fable-5.2 is force-included when present so new Anthropic launches are visible immediately.',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
