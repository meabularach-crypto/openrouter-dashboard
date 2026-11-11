'use client';

import { useEffect, useState } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, BarChart,
} from 'recharts';

const ARR_POINTS = {
  anthropic: [
    { date: '2025-01-01', arr: 1e9 },
    { date: '2025-05-31', arr: 3e9 },
    { date: '2025-10-15', arr: 7e9 },
    { date: '2025-12-31', arr: 9e9 },
    { date: '2026-02-12', arr: 14e9 },
    { date: '2026-03-15', arr: 19e9 },
    { date: '2026-04-06', arr: 30e9 },
    { date: '2026-05-28', arr: 47e9 },
    { date: '2026-07-31', arr: 65e9 },
    { date: '2026-09-30', arr: 71e9 },
    { date: '2026-10-31', arr: 81e9 },
  ],
  openai: [
    { date: '2024-12-31', arr: 6e9 },
    { date: '2025-06-10', arr: 10e9 },
    { date: '2025-12-31', arr: 20e9 },
    { date: '2026-02-28', arr: 25e9 },
    { date: '2026-08-14', arr: 40e9 },
    { date: '2026-09-30', arr: 50e9 },
  ],
};

const MODEL_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#95a5a6', '#d35400',
  '#16a085', '#8e44ad',
];

const PROVIDER_COLORS = {
  deepseek: '#e74c3c',
  openai: '#3498db',
  anthropic: '#9b59b6',
  google: '#f39c12',
  meta: '#2ecc71',
  'z-ai': '#1abc9c',
  tencent: '#e67e22',
  moonshotai: '#34495e',
  minimax: '#d35400',
  nvidia: '#16a085',
  xiaomi: '#8e44ad',
  stepfun: '#27ae60',
  qwen: '#2980b9',
  mistralai: '#c0392b',
  other: '#95a5a6',
};

const CATEGORY_COLORS = {
  programming: '#3498db',
  technology: '#2ecc71',
  roleplay: '#e74c3c',
  marketing: '#f39c12',
  science: '#9b59b6',
  translation: '#1abc9c',
  legal: '#e67e22',
  finance: '#27ae60',
  health: '#e84393',
  academia: '#8e44ad',
  trivia: '#95a5a6',
  unclassified: '#7f8c8d',
};

const MACRO_COLORS = {
  code: '#2980b9',
  data: '#27ae60',
  agent: '#8e44ad',
  general: '#e67e22',
  unclassified: '#7f8c8d',
};

function nearestSpend(data, targetDate) {
  if (!data.length) return null;
