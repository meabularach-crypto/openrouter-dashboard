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
  const daysParam = searchParams.get('days') || '180';
  const isSince2025 = daysParam === 'since2025';
  const provider = (searchParams.get('provider') || 'total').toLowerCase(); // total | anthropic | openai

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const endStr = end.toISOString().slice(0, 10);

  const windows = [];
  if (isSince2025) {
    windows.push({ start: '2025-01-01', end: '2025-12-31' });
    windows.push({ start: '2026-01-01', end: endStr });
  } else {
    const days = Math.min(365, Math.max(28, parseInt(daysParam, 10) || 180));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    windows.push({ start: start.toISOString().slice(0, 10), end: endStr });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
  }

  const headers = { Authorization: `Bearer ${key}` };

  try {
    const allCategoryResults = [];
    const totalByWeek = {};

    for (const win of windows) {
      const categoryResults = await Promise.all(
        CATEGORIES.map(async (category) => {
          const url = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${win.start}&end_date=${win.end}&category=${encodeURIComponent(category)}&period=week`;
          const res = await fetch(url, { headers, next: { revalidate: 3600 } });
          if (!res.ok) {
            console.warn(`Category ${category} failed: ${res.status}`);
            return { category, rows: [] };
          }
          const json = await res.json();
          return { category, rows: json.data || [] };
        })
      );
      allCategoryResults.push(...categoryResults);

      const totalUrl = `https://openrouter.ai/api/v1/datasets/rankings-daily?start_date=${win.start}&end_date=${win.end}&period=week`;
      const totalRes = await fetch(totalUrl, { headers, next: { revalidate: 3600 } });
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
    }

    // Aggregate categories
    const byWeek = {};
    for (const { category, rows } of allCategoryResults) {
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

    // Add unclassified = total - sum of categories
    const weekly = Object.values(byWeek)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(w => {
        const categorized = CATEGORIES.reduce((sum, c) => sum + (w[c] || 0), 0);
        const total = totalByWeek[w.date] || 0;
        const unclassified = Math.max(0, total - categorized);
        return { ...w, unclassified };
      });

    const active = [...CATEGORIES.filter(c => weekly.some(w => w[c] > 0)), 'unclassified'];
    const startStr = windows[0].start;

    return NextResponse.json({
      days: isSince2025 ? 'since2025' : daysParam,
      provider,
      start_date: startStr,
      end_date: endStr,
      categories: active,
      weekly,
      note: isSince2025
        ? 'Combined 2025 full year + 2026 YTD. Weekly estimates. unclassified = platform total minus sum of sampled categories.'
        : 'Weekly estimates. unclassified = platform total (rankings-daily without category) minus sum of the 11 sampled categories. Categories are upsampled estimates and may not cover all traffic.',
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
