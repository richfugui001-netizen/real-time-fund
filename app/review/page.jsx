'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  HeartPulse,
  Layers3,
  LayoutDashboard,
  ListChecks,
  PieChart,
  RefreshCw,
  Send,
  Settings,
  Target,
  WalletCards,
  X,
} from 'lucide-react';

import {
  fetchEastmoneyBoardRanks,
  fetchEastmoneySectorQuotesBatch,
  fetchFundSecidsBatch,
  fetchMarketIndices,
  fetchRelatedSectorsBatch,
} from '@/app/api/fund';
import { DAILY_EARNINGS_SCOPE_ALL } from '@/app/lib/dailyEarnings';
import { DCA_SCOPE_GLOBAL } from '@/app/lib/fundHelpers';
import { getPortfolioHoldingMetrics } from '@/app/lib/portfolioMetrics';
import { useStorageStore } from '@/app/stores';
import styles from './review.module.css';

const cn = (...names) => names.filter(Boolean).join(' ');
const DEEPSEEK_KEY_STORAGE = 'reviewDeepSeekApiKey';
const DEEPSEEK_MODEL = 'deepseek-v4-pro';
const EMPTY_AI_REVIEW = {
  summary: '',
  today: '',
  focus: [],
  dataNotes: [],
  answer: '',
};

const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const formatMoney = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatPct = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

const formatRatio = (value, digits = 2) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return `${n.toFixed(digits)}%`;
};

const signedClassName = (value) => (Number(value) >= 0 ? styles.up : styles.down);

const getMarketMood = (indices) => {
  const valid = (Array.isArray(indices) ? indices : []).filter((item) => Number.isFinite(Number(item?.changePercent)));
  if (!valid.length) return '暂无指数数据';
  const upCount = valid.filter((item) => Number(item.changePercent) > 0).length;
  const downCount = valid.filter((item) => Number(item.changePercent) < 0).length;
  const avg = valid.reduce((sum, item) => sum + Number(item.changePercent), 0) / valid.length;
  if (upCount >= valid.length * 0.7) return `主要指数普涨，平均 ${formatPct(avg)}`;
  if (downCount >= valid.length * 0.7) return `主要指数普跌，平均 ${formatPct(avg)}`;
  return `主要指数分化，平均 ${formatPct(avg)}`;
};

const normalizeDailyBucket = (fundDailyEarnings) => {
  if (!fundDailyEarnings || typeof fundDailyEarnings !== 'object' || Array.isArray(fundDailyEarnings)) return {};
  const scoped = fundDailyEarnings[DAILY_EARNINGS_SCOPE_ALL];
  if (scoped && typeof scoped === 'object' && !Array.isArray(scoped)) return scoped;
  return fundDailyEarnings;
};

const getMonthEarnings = (fundDailyEarnings, monthKey) => {
  const bucket = normalizeDailyBucket(fundDailyEarnings);
  return Object.values(bucket).reduce((sum, list) => {
    if (!Array.isArray(list)) return sum;
    return sum + list.reduce((innerSum, item) => {
      const date = String(item?.date || '');
      if (!date.startsWith(monthKey)) return innerSum;
      return innerSum + (toFiniteNumber(item?.earnings) ?? 0);
    }, 0);
  }, 0);
};

const countEnabledDcaPlans = (dcaPlans) => {
  if (!dcaPlans || typeof dcaPlans !== 'object' || Array.isArray(dcaPlans)) return 0;
  const looksScoped = Object.values(dcaPlans).some((value) => value && typeof value === 'object' && !Array.isArray(value) && !('enabled' in value));
  const buckets = looksScoped ? Object.values(dcaPlans) : [dcaPlans[DCA_SCOPE_GLOBAL] || dcaPlans];
  return buckets.reduce((count, bucket) => {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return count;
    return count + Object.values(bucket).filter((plan) => plan?.enabled === true).length;
  }, 0);
};

function StatCard({ icon: Icon, label, value, hint, tone = 'neutral' }) {
  return (
    <section className={cn(styles.statCard, styles[tone])}>
      <div className={styles.statIcon}><Icon size={20} /></div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{hint}</span>
      </div>
    </section>
  );
}

function Panel({ title, icon: Icon, children, aside }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2><Icon size={18} />{title}</h2>
        {aside && <span>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const buildAiReviewPrompt = ({ totals, monthEarnings, rows, allocationRows, impactRows, healthChecks, reviewSummary, marketContext, question }) => {
  const payload = {
    date: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    dataNote: {
      totalAsset: '全部资产使用确权净值口径',
      todayProfit: '今日预估收益使用估值口径',
      holdingProfit: '持有收益使用确权净值减持仓成本',
    },
    portfolio: {
      amount: Number(totals.amount.toFixed(2)),
      todayProfit: Number(totals.todayProfit.toFixed(2)),
      holdingProfit: Number(totals.holdingProfit.toFixed(2)),
      holdingProfitRate: totals.holdingProfitRate == null ? null : Number(totals.holdingProfitRate.toFixed(2)),
      monthEarnings: Number(monthEarnings.toFixed(2)),
      healthScore: reviewSummary.score,
      healthLevel: reviewSummary.level,
      estimateCoverage: Number(reviewSummary.estimateCoverage.toFixed(2)),
      costCoverage: Number(reviewSummary.costCoverage.toFixed(2)),
      topThreeWeight: Number(reviewSummary.topThreeWeight.toFixed(2)),
    },
    funds: rows.map((row) => ({
      code: row.code,
      name: row.positionName || row.name,
      scopeName: row.scopeName || '',
      amount: Number(row.amount.toFixed(2)),
      weight: Number(row.weight.toFixed(2)),
      todayRate: row.rate == null ? null : Number(row.rate.toFixed(2)),
      todayProfit: Number(row.todayProfit.toFixed(2)),
      holdingProfit: Number(row.holdingProfit.toFixed(2)),
      holdingProfitRate: row.holdingProfitRate == null ? null : Number(row.holdingProfitRate.toFixed(2)),
      hasCost: row.hasCost,
      hasEstimate: row.hasEstimate,
    })),
    allocationTop: allocationRows.map((row) => ({ name: row.positionName || row.name, weight: Number(row.weight.toFixed(2)), amount: Number(row.amount.toFixed(2)) })),
    impactTop: impactRows.map((row) => ({ name: row.positionName || row.name, todayProfit: Number(row.todayProfit.toFixed(2)), todayRate: row.rate == null ? null : Number(row.rate.toFixed(2)) })),
    healthChecks: healthChecks.map((check) => ({ type: check.type, title: check.title, text: check.text })),
    marketContext,
    question: question || '请生成今天的基金持仓复盘。',
  };

  return JSON.stringify(payload, null, 2);
};

const parseAiReview = (content) => {
  if (!content) return { ...EMPTY_AI_REVIEW };
  const normalized = content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(normalized);
    return {
      summary: String(parsed.summary || ''),
      today: String(parsed.today || ''),
      answer: String(parsed.answer || ''),
      focus: Array.isArray(parsed.focus) ? parsed.focus.map(String).filter(Boolean).slice(0, 5) : [],
      dataNotes: Array.isArray(parsed.dataNotes) ? parsed.dataNotes.map(String).filter(Boolean).slice(0, 4) : [],
      raw: content,
    };
  } catch {
    return {
      ...EMPTY_AI_REVIEW,
      summary: content,
      raw: content,
    };
  }
};

async function requestDeepSeekReview({ apiKey, prompt }) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: 'system',
          content: [
            '你是基金持仓复盘助手，只基于用户提供的数据做解释和归因。',
            '不要推荐具体买入、卖出、加仓、减仓动作，不要承诺收益。',
            '请用中文输出，语言直接、可读、少术语。',
            '必须只输出 JSON，不要 Markdown，不要代码块。',
            'JSON 字段固定为：summary 字符串，today 字符串，focus 字符串数组，dataNotes 字符串数组，answer 字符串。',
            'summary 是一句话结论；today 解释今日表现；focus 放 1-4 条需要关注；dataNotes 放 1-3 条数据口径提醒。',
            '如果 marketContext 有数据，需要结合主要指数、热点板块、持仓关联板块解释今日表现。',
            '涉及外部市场原因时使用“可能”“相关性”表述，不要把原因说死。',
            '如果用户问了具体问题，answer 先回答问题；如果没有具体问题，answer 为空字符串。'
          ].join('\n'),
        },
        {
          role: 'user',
          content: `下面是我的本地基金持仓数据，请帮我复盘：\n\n${prompt}`,
        },
      ],
      temperature: 0.35,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message || `DeepSeek 请求失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek 没有返回可展示的内容');
  return content.trim();
}

export default function ReviewPage() {
  const {
    funds,
    holdings,
    groups,
    groupHoldings,
    transactions,
    pendingTrades,
    dcaPlans,
    fundDailyEarnings,
    initFunds,
    initHoldings,
    initGroups,
    initGroupHoldings,
    initTransactions,
    initPendingTrades,
    initDcaPlans,
    initFundDailyEarnings,
  } = useStorageStore();

  const [now, setNow] = useState(() => dayjs().format('HH:mm:ss'));
  const [deepSeekKey, setDeepSeekKey] = useState('');
  const [deepSeekKeyDraft, setDeepSeekKeyDraft] = useState('');
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiReview, setAiReview] = useState(EMPTY_AI_REVIEW);
  const [aiError, setAiError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [marketIndices, setMarketIndices] = useState([]);
  const [boardRanks, setBoardRanks] = useState({ industryUp: [], industryDown: [], conceptUp: [], conceptDown: [] });
  const [fundSectorRows, setFundSectorRows] = useState([]);
  const [marketLoading, setMarketLoading] = useState(false);

  useEffect(() => {
    initFunds();
    initHoldings();
    initGroups();
    initGroupHoldings();
    initTransactions();
    initPendingTrades();
    initDcaPlans();
    initFundDailyEarnings();
  }, [
    initDcaPlans,
    initFundDailyEarnings,
    initFunds,
    initGroupHoldings,
    initGroups,
    initHoldings,
    initTransactions,
    initPendingTrades,
  ]);

  useEffect(() => {
    const timer = setInterval(() => setNow(dayjs().format('HH:mm:ss')), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedKey = window.localStorage.getItem(DEEPSEEK_KEY_STORAGE) || '';
    setDeepSeekKey(savedKey);
    setDeepSeekKeyDraft(savedKey);
  }, []);

  const portfolioPositions = useMemo(() => {
    const positions = [];
    const groupNameById = new Map(
      (Array.isArray(groups) ? groups : [])
        .filter((group) => group?.id)
        .map((group) => [group.id, group.name || '未命名分组'])
    );
    const validGroupIds = new Set(groupNameById.keys());

    (Array.isArray(funds) ? funds : []).forEach((fund) => {
      const code = fund?.code;
      if (!code) return;
      const globalShare = toFiniteNumber(holdings?.[code]?.share);
      if (globalShare != null && globalShare > 0) {
        positions.push({ fund, holding: holdings[code], scopeGroupIds: null, scopeName: '全部', positionKey: `${code}:all` });
      }

      Object.entries(groupHoldings || {}).forEach(([groupId, bucket]) => {
        if (!validGroupIds.has(groupId)) return;
        const holding = bucket?.[code];
        const share = toFiniteNumber(holding?.share);
        if (share == null || share <= 0) return;
        positions.push({ fund, holding, scopeGroupIds: groupId, scopeName: groupNameById.get(groupId) || '未命名分组', positionKey: `${code}:${groupId}` });
      });
    });

    return positions;
  }, [funds, groupHoldings, groups, holdings]);

  const rows = useMemo(() => {
    return portfolioPositions.map(({ fund, holding, scopeGroupIds, scopeName, positionKey }) => {
      const metrics = getPortfolioHoldingMetrics(fund, holding, {
        transactions,
        scopeGroupIds,
      });
      return {
        ...fund,
        ...metrics,
        positionKey,
        scopeName,
        positionName: `${fund.name || fund.code} · ${scopeName}`,
        rate: metrics.changeRate,
        share: toFiniteNumber(holding?.share) ?? 0,
      };
    });
  }, [portfolioPositions, transactions]);

  const heldRows = useMemo(() => rows.filter((row) => row.hasHolding && row.amount > 0), [rows]);

  const totals = useMemo(() => {
    const total = heldRows.reduce((acc, row) => {
      acc.amount += row.amount;
      acc.estimatedAmount += row.estimatedAmount;
      acc.costAmount += row.costAmount;
      acc.holdingProfit += row.holdingProfit;
      acc.todayProfit += row.todayProfit;
      return acc;
    }, { amount: 0, estimatedAmount: 0, costAmount: 0, holdingProfit: 0, todayProfit: 0 });

    total.holdingProfitRate = total.costAmount > 0 ? (total.holdingProfit / total.costAmount) * 100 : null;
    return total;
  }, [heldRows]);

  const enrichedRows = useMemo(() => {
    return heldRows.map((row) => ({
      ...row,
      weight: totals.amount > 0 ? (row.amount / totals.amount) * 100 : 0,
    }));
  }, [heldRows, totals.amount]);

  const heldCodesKey = useMemo(
    () => enrichedRows.map((row) => row.code).filter(Boolean).sort().join('|'),
    [enrichedRows]
  );

  const monthKey = dayjs().format('YYYY-MM');
  const monthEarnings = useMemo(() => getMonthEarnings(fundDailyEarnings, monthKey), [fundDailyEarnings, monthKey]);
  const enabledDcaCount = useMemo(() => countEnabledDcaPlans(dcaPlans), [dcaPlans]);

  const allocationRows = useMemo(
    () => [...enrichedRows].sort((a, b) => b.amount - a.amount).slice(0, 6),
    [enrichedRows]
  );

  const impactRows = useMemo(
    () => [...enrichedRows].sort((a, b) => Math.abs(b.todayProfit) - Math.abs(a.todayProfit)).slice(0, 6),
    [enrichedRows]
  );

  const dragRows = useMemo(
    () => [...enrichedRows].filter((row) => row.todayProfit < 0).sort((a, b) => a.todayProfit - b.todayProfit).slice(0, 3),
    [enrichedRows]
  );

  const healthChecks = useMemo(() => {
    const checks = [];
    const sortedByWeight = [...enrichedRows].sort((a, b) => b.weight - a.weight);
    const topOne = sortedByWeight[0];
    const topThreeWeight = sortedByWeight.slice(0, 3).reduce((sum, row) => sum + row.weight, 0);
    const missingCostCount = enrichedRows.filter((row) => !row.hasCost).length;
    const missingEstimateCount = enrichedRows.filter((row) => !row.hasEstimate).length;
    const lossRows = enrichedRows
      .filter((row) => Number(row.holdingProfitRate) <= -10 && row.weight >= 15)
      .sort((a, b) => a.holdingProfitRate - b.holdingProfitRate);

    if (!enrichedRows.length) {
      checks.push({
        type: 'warn',
        title: '还没有可体检的持仓',
        text: '先在首页补充持仓份额和成本，复盘页才能判断资产、收益和结构。',
      });
      return checks;
    }

    if (topOne && topOne.weight >= 40) {
      checks.push({
        type: 'warn',
        title: '单只持仓占比较高',
        text: `${topOne.positionName} 占全部资产 ${formatRatio(topOne.weight)}，组合波动会比较受它影响。`,
      });
    }

    if (topThreeWeight >= 75 && sortedByWeight.length >= 3) {
      checks.push({
        type: 'warn',
        title: '前三只持仓比较集中',
        text: `前三只合计占比 ${formatRatio(topThreeWeight)}，复盘时可以重点看它们是否仍符合你的配置思路。`,
      });
    }

    lossRows.slice(0, 2).forEach((row) => {
      checks.push({
        type: 'danger',
        title: '重点关注亏损持仓',
        text: `${row.positionName} 持有收益率 ${formatPct(row.holdingProfitRate)}，且占比 ${formatRatio(row.weight)}。`,
      });
    });

    if (missingCostCount > 0) {
      checks.push({
        type: 'info',
        title: '部分持仓缺少成本',
        text: `${missingCostCount} 只基金没有完整成本，持有收益只能按 0 处理，建议补全后再看体检结果。`,
      });
    }

    if (missingEstimateCount > 0) {
      checks.push({
        type: 'info',
        title: '部分基金暂无今日估值',
        text: `${missingEstimateCount} 只持仓暂无估值，今日预估收益不会包含它们的实时变化。`,
      });
    }

    if (Array.isArray(pendingTrades) && pendingTrades.length > 0) {
      checks.push({
        type: 'info',
        title: '有待确认交易',
        text: `${pendingTrades.length} 条买入或卖出还在待确认，确认后资产和收益口径会更准确。`,
      });
    }

    if (enabledDcaCount > 0) {
      checks.push({
        type: 'good',
        title: '已开启定投计划',
        text: `当前有 ${enabledDcaCount} 个启用中的定投计划，复盘时可以顺手检查执行节奏。`,
      });
    }

    if (!checks.some((check) => check.type === 'warn' || check.type === 'danger')) {
      checks.push({
        type: 'good',
        title: '结构上暂无明显提醒',
        text: '从当前本地数据看，集中度和亏损占比没有触发体检阈值。',
      });
    }

    return checks;
  }, [enabledDcaCount, enrichedRows, pendingTrades]);

  const reviewSummary = useMemo(() => {
    const sortedByWeight = [...enrichedRows].sort((a, b) => b.weight - a.weight);
    const topOne = sortedByWeight[0];
    const topThreeWeight = sortedByWeight.slice(0, 3).reduce((sum, row) => sum + row.weight, 0);
    const missingCostCount = enrichedRows.filter((row) => !row.hasCost).length;
    const missingEstimateCount = enrichedRows.filter((row) => !row.hasEstimate).length;
    const lossFocusCount = enrichedRows.filter((row) => Number(row.holdingProfitRate) <= -10 && row.weight >= 15).length;
    const estimateCoverage = enrichedRows.length > 0
      ? ((enrichedRows.length - missingEstimateCount) / enrichedRows.length) * 100
      : 0;
    const costCoverage = enrichedRows.length > 0
      ? ((enrichedRows.length - missingCostCount) / enrichedRows.length) * 100
      : 0;

    let score = 100;
    if (topOne?.weight >= 40) score -= 18;
    if (topThreeWeight >= 75 && sortedByWeight.length >= 3) score -= 12;
    score -= Math.min(20, missingCostCount * 8);
    score -= Math.min(14, missingEstimateCount * 6);
    score -= Math.min(20, lossFocusCount * 10);
    if (Array.isArray(pendingTrades) && pendingTrades.length > 0) score -= 6;
    score = Math.max(45, Math.min(100, Math.round(score)));

    const bestToday = [...enrichedRows].sort((a, b) => b.todayProfit - a.todayProfit)[0];
    const worstToday = [...enrichedRows].sort((a, b) => a.todayProfit - b.todayProfit)[0];
    const level = score >= 85 ? '良好' : score >= 70 ? '需关注' : '需要复盘';
    const mainFocus = healthChecks.find((check) => check.type === 'danger' || check.type === 'warn') || healthChecks[0];
    const focusText = mainFocus?.text || '暂无可体检数据，先补充持仓份额和成本。';

    return {
      score,
      level,
      focusText,
      topOne,
      topThreeWeight,
      estimateCoverage,
      costCoverage,
      bestToday,
      worstToday,
    };
  }, [enrichedRows, healthChecks, pendingTrades]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMarketLoading(true);
      try {
        const [indices, ranks] = await Promise.all([
          fetchMarketIndices().catch(() => []),
          fetchEastmoneyBoardRanks({ limit: 5 }).catch(() => ({ industryUp: [], industryDown: [], conceptUp: [], conceptDown: [] })),
        ]);
        if (cancelled) return;
        setMarketIndices(Array.isArray(indices) ? indices : []);
        setBoardRanks(ranks || { industryUp: [], industryDown: [], conceptUp: [], conceptDown: [] });
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const codes = enrichedRows.map((row) => row.code).filter(Boolean);
    if (!codes.length) {
      setFundSectorRows([]);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const related = await fetchRelatedSectorsBatch(codes);
        if (cancelled) return;
        const labels = Array.from(new Set(Object.values(related).map((value) => String(value || '').trim()).filter(Boolean)));
        if (!labels.length) {
          setFundSectorRows([]);
          return;
        }

        const secids = await fetchFundSecidsBatch(labels);
        if (cancelled) return;
        const quoteMap = await fetchEastmoneySectorQuotesBatch(Object.values(secids).filter(Boolean));
        if (cancelled) return;

        const rows = enrichedRows.map((row) => {
          const label = String(related?.[row.code] || '').trim();
          const secid = label ? secids?.[label] : '';
          const quote = secid ? quoteMap?.[secid] : null;
          return {
            code: row.code,
            name: row.name,
            fundRate: row.rate,
            weight: row.weight,
            sector: label,
            sectorName: quote?.name || label,
            sectorPct: quote?.pct ?? null,
          };
        }).filter((row) => row.sector);
        setFundSectorRows(rows);
      } catch {
        if (!cancelled) setFundSectorRows([]);
      }
    })();

    return () => { cancelled = true; };
  }, [heldCodesKey, enrichedRows]);

  const marketFocus = useMemo(() => {
    const preferred = ['上证指数', '深证成指', '创业板指', '沪深300', '科创50', '恒生科技指数', '纳斯达克100'];
    const map = new Map((marketIndices || []).map((item) => [item.name, item]));
    const picked = preferred.map((name) => map.get(name)).filter(Boolean);
    return picked.length ? picked.slice(0, 6) : (marketIndices || []).slice(0, 6);
  }, [marketIndices]);

  const marketContext = useMemo(() => ({
    mood: getMarketMood(marketFocus),
    indices: marketFocus.map((item) => ({
      name: item.name,
      changePercent: Number.isFinite(Number(item.changePercent)) ? Number(item.changePercent) : null,
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
    })),
    boardRanks: {
      industryUp: (boardRanks.industryUp || []).slice(0, 5),
      industryDown: (boardRanks.industryDown || []).slice(0, 5),
      conceptUp: (boardRanks.conceptUp || []).slice(0, 5),
      conceptDown: (boardRanks.conceptDown || []).slice(0, 5),
    },
    fundSectors: fundSectorRows.map((row) => ({
      fundName: row.name,
      scopeName: row.scopeName || '',
      fundRate: row.fundRate == null ? null : Number(row.fundRate.toFixed(2)),
      weight: Number(row.weight.toFixed(2)),
      sector: row.sectorName,
      sectorPct: row.sectorPct == null ? null : Number(row.sectorPct.toFixed(2)),
    })),
  }), [boardRanks, fundSectorRows, marketFocus]);

  const runAiReview = async (questionOverride) => {
    const apiKey = deepSeekKey.trim();
    if (!apiKey) {
      setAiError('先在 AI 设置里保存 DeepSeek API Key。');
      setAiSettingsOpen(true);
      return;
    }

    setAiLoading(true);
    setAiError('');
    try {
      const prompt = buildAiReviewPrompt({
        totals,
        monthEarnings,
        rows: enrichedRows,
        allocationRows,
        impactRows,
        healthChecks,
        reviewSummary,
        marketContext,
        question: questionOverride ?? aiQuestion.trim(),
      });
      const content = await requestDeepSeekReview({ apiKey, prompt });
      setAiReview(parseAiReview(content));
    } catch (error) {
      setAiError(error?.message || 'DeepSeek 请求失败，请稍后再试。');
    } finally {
      setAiLoading(false);
    }
  };

  const clearDeepSeekKey = () => {
    setDeepSeekKey('');
    setDeepSeekKeyDraft('');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DEEPSEEK_KEY_STORAGE);
    }
  };

  const saveDeepSeekKey = () => {
    const nextKey = deepSeekKeyDraft.trim();
    setDeepSeekKey(nextKey);
    if (typeof window !== 'undefined') {
      if (nextKey) {
        window.localStorage.setItem(DEEPSEEK_KEY_STORAGE, nextKey);
      } else {
        window.localStorage.removeItem(DEEPSEEK_KEY_STORAGE);
      }
    }
    setAiSettingsOpen(false);
    setAiError('');
  };

  const hasAiReview = Boolean(aiReview.summary || aiReview.today || aiReview.answer || aiReview.focus.length || aiReview.dataNotes.length);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>复盘 / 收益口径 / 持仓结构</p>
          <h1>基金复盘</h1>
          <span>持仓体检只做数据提醒，不构成买卖建议。</span>
        </div>
        <nav className={styles.actions} aria-label="页面导航">
          <div className={styles.clock}><Clock3 size={17} />{now}</div>
          <Link href="/dashboard.html" className={styles.actionButton}>
            <LayoutDashboard size={17} />
            大屏
          </Link>
          <Link href="/" className={styles.actionButton}>
            <ListChecks size={17} />
            基金列表
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.scoreCard}>
          <div className={styles.scoreRing} style={{ '--score': `${reviewSummary.score}%` }}>
            <strong>{reviewSummary.score}</strong>
            <span>体检分</span>
          </div>
          <div>
            <p>今日结论</p>
            <h2>{reviewSummary.level}</h2>
            <span>{reviewSummary.focusText}</span>
          </div>
        </div>
        <div className={styles.heroMetrics}>
          <article>
            <Target size={18} />
            <span>最大持仓</span>
            <strong>{reviewSummary.topOne ? reviewSummary.topOne.positionName : '--'}</strong>
            <em>{reviewSummary.topOne ? `${formatRatio(reviewSummary.topOne.weight)} 占比` : '暂无持仓'}</em>
          </article>
          <article>
            <PieChart size={18} />
            <span>前三集中度</span>
            <strong>{formatRatio(reviewSummary.topThreeWeight)}</strong>
            <em>看组合是否过度集中</em>
          </article>
          <article>
            <CheckCircle2 size={18} />
            <span>数据完整度</span>
            <strong>{formatRatio(reviewSummary.costCoverage)}</strong>
            <em>按成本数据覆盖计算</em>
          </article>
        </div>
      </section>

      <section className={styles.stats}>
        <StatCard
          icon={WalletCards}
          label="全部资产"
          value={`¥ ${formatMoney(totals.amount)}`}
          hint={`${enrichedRows.length} 只持仓，确权净值口径`}
          tone="cyan"
        />
        <StatCard
          icon={Activity}
          label="今日预估收益"
          value={`¥ ${formatMoney(totals.todayProfit)}`}
          hint="按今日估值和持仓份额估算"
          tone={totals.todayProfit >= 0 ? 'red' : 'green'}
        />
        <StatCard
          icon={Gauge}
          label="持有收益"
          value={`¥ ${formatMoney(totals.holdingProfit)}`}
          hint={`确权口径 ${formatPct(totals.holdingProfitRate)}`}
          tone={totals.holdingProfit >= 0 ? 'red' : 'green'}
        />
        <StatCard
          icon={BarChart3}
          label="本月累计收益"
          value={`¥ ${formatMoney(monthEarnings)}`}
          hint="来自每日收益记录"
          tone={monthEarnings >= 0 ? 'red' : 'green'}
        />
      </section>

      <section className={styles.reviewStrip}>
        <article>
          <span>今日贡献最大</span>
          <strong title={reviewSummary.bestToday?.positionName}>{reviewSummary.bestToday?.positionName || '--'}</strong>
          <b className={signedClassName(reviewSummary.bestToday?.todayProfit)}>
            ¥ {formatMoney(reviewSummary.bestToday?.todayProfit)}
          </b>
        </article>
        <article>
          <span>今日拖累最大</span>
          <strong title={reviewSummary.worstToday?.positionName}>{reviewSummary.worstToday?.positionName || '--'}</strong>
          <b className={signedClassName(reviewSummary.worstToday?.todayProfit)}>
            ¥ {formatMoney(reviewSummary.worstToday?.todayProfit)}
          </b>
        </article>
        <article>
          <span>估值覆盖</span>
          <strong>{formatRatio(reviewSummary.estimateCoverage)}</strong>
          <b>今日预估收益的数据覆盖情况</b>
        </article>
      </section>

      <section className={styles.marketPanel}>
        <div className={styles.marketHeader}>
          <div>
            <h2><Layers3 size={18} />今日市场环境</h2>
            <p>{marketLoading ? '正在加载指数和板块数据…' : marketContext.mood}</p>
          </div>
          <span>将随 AI 复盘一起分析</span>
        </div>
        <div className={styles.marketGrid}>
          <article>
            <strong>主要指数</strong>
            <div className={styles.marketChips}>
              {marketFocus.length ? marketFocus.map((item) => (
                <span key={item.name}>
                  {item.name}
                  <b className={signedClassName(item.changePercent)}>{formatPct(item.changePercent)}</b>
                </span>
              )) : <em>暂无指数数据</em>}
            </div>
          </article>
          <article>
            <strong>行业热点</strong>
            <div className={styles.marketRankMini}>
              {(boardRanks.industryUp || []).slice(0, 4).map((item) => (
                <span key={item.code}>{item.name}<b className={signedClassName(item.pct)}>{formatPct(item.pct)}</b></span>
              ))}
              {!(boardRanks.industryUp || []).length && <em>暂无行业数据</em>}
            </div>
          </article>
          <article>
            <strong>持仓关联板块</strong>
            <div className={styles.marketRankMini}>
              {fundSectorRows.slice(0, 4).map((item) => (
                <span key={`${item.code}-${item.sectorName}`}>{item.sectorName}<b className={signedClassName(item.sectorPct)}>{formatPct(item.sectorPct)}</b></span>
              ))}
              {!fundSectorRows.length && <em>暂无关联板块数据</em>}
            </div>
          </article>
        </div>
      </section>

      <section className={styles.aiPanel}>
        <div className={styles.aiHeader}>
          <div>
            <h2><Bot size={19} />AI 复盘助手</h2>
            <p>基于当前页面数据生成复盘和解释，Key 仅保存在当前浏览器。</p>
          </div>
          <button type="button" className={styles.aiSettingsButton} onClick={() => setAiSettingsOpen(true)}>
            <Settings size={16} />
            AI 设置
          </button>
        </div>
        <div className={styles.aiModelLine}>
          <span>{DEEPSEEK_MODEL}</span>
          <em>{deepSeekKey ? '已设置 API Key' : '未设置 API Key'}</em>
        </div>
        <div className={styles.aiAskRow}>
          <textarea
            value={aiQuestion}
            onChange={(event) => setAiQuestion(event.target.value)}
            placeholder="可以直接问：今天为什么涨？我的持仓哪里需要关注？不填则生成今日复盘。"
            rows={3}
          />
          <div className={styles.aiButtons}>
            <button type="button" onClick={() => runAiReview('请生成今天的基金持仓复盘。')} disabled={aiLoading}>
              <Bot size={16} />
              {aiLoading ? '生成中' : '生成复盘'}
            </button>
            <button type="button" onClick={() => runAiReview()} disabled={aiLoading || !aiQuestion.trim()}>
              <Send size={16} />
              追问
            </button>
          </div>
        </div>
        {aiError && <div className={styles.aiError}>{aiError}</div>}
        {hasAiReview && (
          <div className={styles.aiResultGrid}>
            {(aiReview.answer || aiReview.summary) && (
              <article className={styles.aiResultHero}>
                <span>{aiReview.answer ? '问题回答' : 'AI 结论'}</span>
                <strong>{aiReview.answer || aiReview.summary}</strong>
                {aiReview.answer && aiReview.summary && <p>{aiReview.summary}</p>}
              </article>
            )}
            {aiReview.today && (
              <article className={styles.aiResultCard}>
                <span>今日表现</span>
                <p>{aiReview.today}</p>
              </article>
            )}
            {aiReview.focus.length > 0 && (
              <article className={styles.aiResultCard}>
                <span>需要关注</span>
                <ul>
                  {aiReview.focus.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              </article>
            )}
            {aiReview.dataNotes.length > 0 && (
              <article className={styles.aiResultCard}>
                <span>口径提醒</span>
                <ul>
                  {aiReview.dataNotes.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              </article>
            )}
          </div>
        )}
      </section>

      {aiSettingsOpen && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setAiSettingsOpen(false)}>
          <section className={styles.aiSettingsModal} role="dialog" aria-modal="true" aria-label="AI 设置" onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2>AI 设置</h2>
                <p>配置 DeepSeek API Key 后即可生成复盘。</p>
              </div>
              <button type="button" onClick={() => setAiSettingsOpen(false)} aria-label="关闭 AI 设置">
                <X size={18} />
              </button>
            </div>
            <label className={styles.settingField}>
              <span>DeepSeek API Key</span>
              <input
                type="password"
                value={deepSeekKeyDraft}
                onChange={(event) => setDeepSeekKeyDraft(event.target.value)}
                placeholder="sk-..."
                autoComplete="off"
                autoFocus
              />
            </label>
            <div className={styles.settingHint}>
              Key 只保存在当前浏览器的 localStorage，不会写入云同步。静态页面会直接请求 DeepSeek。
            </div>
            <div className={styles.modalActions}>
              <button type="button" onClick={clearDeepSeekKey} disabled={!deepSeekKey && !deepSeekKeyDraft}>
                清除 Key
              </button>
              <button type="button" onClick={saveDeepSeekKey}>
                保存并关闭
              </button>
            </div>
          </section>
        </div>
      )}

      <section className={styles.layout}>
        <div className={styles.mainColumn}>
          <Panel title="持仓体检" icon={HeartPulse} aside={`${healthChecks.length} 条提醒`}>
            <div className={styles.healthList}>
              {healthChecks.map((check, index) => {
                const Icon = check.type === 'good' ? CheckCircle2 : AlertTriangle;
                return (
                  <article className={cn(styles.healthItem, styles[check.type])} key={`${check.title}-${index}`}>
                    <Icon size={18} />
                    <div>
                      <strong>{check.title}</strong>
                      <p>{check.text}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </Panel>

          <Panel title="今日影响" icon={Activity} aside="按金额影响排序">
            <div className={styles.impactList}>
              {impactRows.length ? impactRows.map((row, index) => (
                <article className={styles.impactItem} key={row.positionKey}>
                  <i>{index + 1}</i>
                  <div>
                    <strong title={row.positionName}>{row.positionName}</strong>
                    <span>{row.code} · 估算涨跌幅 {formatPct(row.rate)}</span>
                  </div>
                  <b className={signedClassName(row.todayProfit)}>¥ {formatMoney(row.todayProfit)}</b>
                </article>
              )) : (
                <p className={styles.emptyText}>暂无持仓金额，补充份额后展示今日影响。</p>
              )}
            </div>
          </Panel>
        </div>

        <aside className={styles.sideColumn}>
          <Panel title="持仓结构" icon={PieChart} aside="前 6 只">
            <div className={styles.allocationList}>
              {allocationRows.length ? allocationRows.map((row) => (
                <article className={styles.allocationItem} key={row.positionKey}>
                  <div>
                    <strong title={row.positionName}>{row.positionName}</strong>
                    <span>{formatRatio(row.weight)} · ¥ {formatMoney(row.amount)}</span>
                  </div>
                  <div className={styles.bar}>
                    <i style={{ width: `${Math.min(100, Math.max(0, row.weight))}%` }} />
                  </div>
                </article>
              )) : (
                <p className={styles.emptyText}>暂无持仓金额，补充份额后展示持仓结构。</p>
              )}
            </div>
          </Panel>

          <Panel title="收益拖累" icon={RefreshCw} aside={dragRows.length ? '今日' : '暂无'}>
            <div className={styles.dragList}>
              {dragRows.length ? dragRows.map((row) => (
                <article className={styles.dragItem} key={row.positionKey}>
                  <div>
                    <strong title={row.positionName}>{row.positionName}</strong>
                    <span>今日预估 {formatPct(row.rate)}</span>
                  </div>
                  <b className={styles.down}>¥ {formatMoney(row.todayProfit)}</b>
                </article>
              )) : (
                <p className={styles.emptyText}>今天没有负向收益拖累，或当前暂无估值数据。</p>
              )}
            </div>
          </Panel>
        </aside>
      </section>
    </main>
  );
}
