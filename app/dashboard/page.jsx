'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dayjs from 'dayjs';
import { isArray } from 'lodash';
import {
  Activity,
  ArrowLeft,
  Clock3,
  Gauge,
  ListChecks,
  LineChart,
  Maximize2,
  Minimize2,
  PieChart,
  Radar,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from 'lucide-react';

import { fetchFundData, fetchMarketIndices } from '@/app/api/fund';
import PositionLabel from '@/app/components/PositionLabel';
import { getFundMetricBasis, getPortfolioHoldingMetrics, getPortfolioPositions } from '@/app/lib/portfolioMetrics';
import { getPortfolioDataQuality, PORTFOLIO_METRIC_NOTES } from '@/app/lib/portfolioQuality';
import { getAllValuationSeries, recordValuation } from '@/app/lib/valuationTimeseries';
import { storageStore, useStorageStore } from '@/app/stores';
import styles from './dashboard.module.css';

const cn = (...names) => names.filter(Boolean).join(' ');

const formatNumber = (value, digits = 2) => {
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

const signedClassName = (value) => (Number(value) >= 0 ? styles.up : styles.down);

const buildSparklinePath = (points, width = 180, height = 54) => {
  if (!isArray(points) || points.length < 2) return '';
  const values = points.map((p) => Number(p.value)).filter(Number.isFinite);
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
};

function MiniSparkline({ series, positive }) {
  const path = buildSparklinePath(series);
  return (
    <svg className={styles.sparkline} viewBox="0 0 180 54" role="img" aria-label="估值分时走势">
      <defs>
        <linearGradient id={positive ? 'spark-red' : 'spark-green'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={positive ? '#ff6262' : '#21d39b'} stopOpacity="0.45" />
          <stop offset="100%" stopColor={positive ? '#ff6262' : '#21d39b'} stopOpacity="0" />
        </linearGradient>
      </defs>
      {path ? (
        <>
          <path d={`${path} L180 54 L0 54 Z`} fill={`url(#${positive ? 'spark-red' : 'spark-green'})`} />
          <path d={path} fill="none" stroke={positive ? '#ff6262' : '#21d39b'} strokeWidth="2.5" strokeLinecap="round" />
        </>
      ) : (
        <path d="M0 27 L180 27" fill="none" stroke="rgba(255,255,255,.22)" strokeDasharray="4 7" />
      )}
    </svg>
  );
}

function StatTile({ icon: Icon, label, value, sub, tone = 'neutral', valueTone = 'neutral' }) {
  return (
    <section className={cn(styles.statTile, styles[tone])}>
      <div className={styles.statIcon}><Icon size={18} /></div>
      <div>
        <div className={styles.statLabel}>{label}</div>
        <div className={cn(styles.statValue, styles[valueTone])}>{value}</div>
        {sub && <div className={styles.statSub}>{sub}</div>}
      </div>
    </section>
  );
}

function EmptyDashboard() {
  return (
    <main className={cn(styles.screen, styles.emptyScreen)}>
      <div className={styles.emptyPanel}>
        <div className={styles.emptyMark}><Radar size={42} /></div>
        <h1>监控大屏已就绪</h1>
        <p>先回到首页添加几只基金，或导入你的持仓配置；大屏会自动读取同一份本地数据。</p>
        <Link className={styles.primaryLink} href="/">
          <ArrowLeft size={16} /> 返回基金列表
        </Link>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  const {
    funds,
    holdings,
    groups,
    groupHoldings,
    transactions,
    refreshMs,
    initFunds,
    initHoldings,
    initGroups,
    initGroupHoldings,
    initTransactions,
    initRefreshMs,
  } = useStorageStore();

  const [marketIndices, setMarketIndices] = useState([]);
  const [valuationSeries, setValuationSeries] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [clock, setClock] = useState(() => dayjs().format('HH:mm:ss'));
  const timerRef = useRef(null);
  const refreshingRef = useRef(false);

  useEffect(() => {
    initFunds();
    initHoldings();
    initGroups();
    initGroupHoldings();
    initTransactions();
    initRefreshMs();
  }, [initFunds, initGroupHoldings, initGroups, initHoldings, initRefreshMs, initTransactions]);

  useEffect(() => {
    setValuationSeries(getAllValuationSeries(funds));
  }, [funds]);

  useEffect(() => {
    const timer = setInterval(() => setClock(dayjs().format('HH:mm:ss')), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    document.addEventListener('webkitfullscreenchange', syncFullscreen);
    syncFullscreen();
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen);
      document.removeEventListener('webkitfullscreenchange', syncFullscreen);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
      if (fullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
        return;
      }

      const el = document.documentElement;
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      }
    } catch {
      // 浏览器可能因权限或非用户手势拒绝全屏，保持当前状态即可。
    }
  }, []);

  const fundCodes = useMemo(
    () => Array.from(new Set((isArray(funds) ? funds : []).map((f) => String(f?.code || '').trim()).filter(Boolean))),
    [funds]
  );

  const refreshDashboard = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const indexes = await fetchMarketIndices().catch(() => []);
      setMarketIndices(isArray(indexes) ? indexes : []);
      if (!fundCodes.length) return;
      const updated = [];
      const chunks = [];
      for (let i = 0; i < fundCodes.length; i += 4) chunks.push(fundCodes.slice(i, i + 4));
      for (const chunk of chunks) {
        const rows = await Promise.all(chunk.map(async (code) => {
          try {
            const data = await fetchFundData(code);
            if (data?.code && data?.gsz != null) {
              recordValuation(data.code, data, data.dataSource || 1);
            }
            return data;
          } catch {
            return null;
          }
        }));
        updated.push(...rows.filter(Boolean));
      }
      if (updated.length) {
        const map = new Map((storageStore.getItem('funds', []) || []).map((f) => [f.code, f]));
        updated.forEach((f) => map.set(f.code, { ...(map.get(f.code) || {}), ...f }));
        storageStore.setItem('funds', JSON.stringify(Array.from(map.values())));
      }
      setValuationSeries(getAllValuationSeries(storageStore.getItem('funds', [])));
      setLastUpdated(dayjs().format('HH:mm:ss'));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [fundCodes]);

  useEffect(() => {
    refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const ms = Number(refreshMs) >= 5000 ? Number(refreshMs) : 30000;
    timerRef.current = setInterval(refreshDashboard, ms);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refreshDashboard, refreshMs]);

  const portfolioPositions = useMemo(() => {
    return getPortfolioPositions({ funds, holdings, groupHoldings, groups });
  }, [funds, groupHoldings, groups, holdings]);

  const fundRows = useMemo(() => {
    return portfolioPositions.map(({ fund, holding, scopeGroupIds, scopeName, scopeTitle, positionKey }) => {
      const metrics = getPortfolioHoldingMetrics(fund, holding, {
        transactions,
        scopeGroupIds,
      });
      const basis = getFundMetricBasis(fund);
      const fundName = fund.name || fund.code;
      return {
        ...fund,
        ...metrics,
        positionKey,
        scopeName,
        scopeTitle,
        positionName: scopeName ? `${fundName} · ${scopeName}` : fundName,
        share: Number(holding?.share) || 0,
        cost: Number(holding?.cost) || null,
        rate: basis.changeRate,
        currentNav: basis.nav,
        metricSource: basis.source,
        series: valuationSeries?.[fund.code] || [],
      };
    });
  }, [portfolioPositions, transactions, valuationSeries]);

  const totals = useMemo(() => {
    const total = fundRows.reduce((acc, fund) => {
      acc.amount += fund.amount;
      acc.costAmount += fund.costAmount;
      acc.todayProfit += fund.todayProfit;
      acc.holdingProfit += fund.holdingProfit;
      if (fund.rate != null) {
        acc.rateSum += fund.rate;
        acc.rateCount += 1;
      }
      return acc;
    }, { amount: 0, costAmount: 0, todayProfit: 0, holdingProfit: 0, rateSum: 0, rateCount: 0 });

    total.holdingProfitRate = total.costAmount > 0 ? (total.holdingProfit / total.costAmount) * 100 : null;
    total.avgRate = total.rateCount > 0 ? total.rateSum / total.rateCount : null;
    return total;
  }, [fundRows]);

  const topFunds = useMemo(
    () => [...fundRows].sort((a, b) => Math.abs(b.todayProfit) - Math.abs(a.todayProfit)).slice(0, 4),
    [fundRows]
  );

  const restFundsSummary = useMemo(() => {
    const sorted = [...fundRows].sort((a, b) => Math.abs(b.todayProfit) - Math.abs(a.todayProfit));
    const rest = sorted.slice(4);
    if (!rest.length) return null;
    return {
      count: rest.length,
      todayProfit: rest.reduce((sum, fund) => sum + (Number(fund.todayProfit) || 0), 0),
      amount: rest.reduce((sum, fund) => sum + (Number(fund.amount) || 0), 0),
    };
  }, [fundRows]);

  const contributionRows = useMemo(
    () => [...fundRows]
      .filter((fund) => Number.isFinite(Number(fund.todayProfit)) && Number(fund.amount) > 0)
      .sort((a, b) => Math.abs(b.todayProfit) - Math.abs(a.todayProfit))
      .slice(0, 5),
    [fundRows]
  );

  const allocationRows = useMemo(
    () => [...fundRows]
      .filter((fund) => Number(fund.amount) > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((fund) => ({
        ...fund,
        weight: totals.amount > 0 ? (fund.amount / totals.amount) * 100 : 0,
      })),
    [fundRows, totals.amount]
  );

  const todayStatus = useMemo(() => {
    return fundRows.reduce((acc, fund) => {
      const rate = Number(fund.rate);
      if (!Number.isFinite(rate)) {
        acc.unknown += 1;
      } else if (rate > 0) {
        acc.up += 1;
      } else if (rate < 0) {
        acc.down += 1;
      } else {
        acc.flat += 1;
      }
      return acc;
    }, { up: 0, down: 0, flat: 0, unknown: 0 });
  }, [fundRows]);

  const rankPanel = useMemo(() => {
    const rows = [...fundRows].filter((f) => f.rate != null);
    const rising = rows.filter((f) => Number(f.rate) > 0);
    const falling = rows.filter((f) => Number(f.rate) < 0);

    if (!rows.length) {
      return { title: '估值变化', icon: TrendingUp, items: [] };
    }

    if (rising.length && falling.length) {
      return { title: '涨跌幅靠前', icon: Activity, items: rows.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate)).slice(0, 5) };
    }

    if (rising.length) {
      return { title: '涨幅靠前', icon: TrendingUp, items: [...rising].sort((a, b) => b.rate - a.rate).slice(0, 5) };
    }

    if (falling.length) {
      return { title: '跌幅靠前', icon: TrendingDown, items: [...falling].sort((a, b) => a.rate - b.rate).slice(0, 5) };
    }

    return { title: '估值持平', icon: Activity, items: rows.slice(0, 5) };
  }, [fundRows]);

  const marketFocus = useMemo(() => {
    const preferred = ['上证指数', '深证成指', '创业板指', '沪深300'];
    const map = new Map(marketIndices.map((item) => [item.name, item]));
    const picked = preferred.map((name) => map.get(name)).filter(Boolean);
    return picked.length ? picked : marketIndices.slice(0, 4);
  }, [marketIndices]);

  const portfolioDataQuality = useMemo(() => getPortfolioDataQuality(fundRows), [fundRows]);

  if (!fundCodes.length) return <EmptyDashboard />;

  const RankIcon = rankPanel.icon;
  const fundMatrixClass = topFunds.length <= 1
    ? styles.fundMatrix1
    : topFunds.length === 2
      ? styles.fundMatrix2
      : topFunds.length === 3
        ? styles.fundMatrix3
        : styles.fundMatrix4;
  const fundMatrixStyle = topFunds.length === 1
    ? { gridTemplateColumns: 'minmax(0, 1fr)', gridAutoRows: 'minmax(154px, 176px)' }
    : topFunds.length === 2
      ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridAutoRows: 'minmax(154px, 176px)' }
      : topFunds.length === 3
        ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoRows: 'minmax(148px, 170px)' }
        : restFundsSummary
          ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(108px, 1fr)) auto' }
          : { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(128px, 1fr))' };

  return (
    <main className={styles.screen}>
      <div className={styles.gridGlow} />
      <header className={styles.header}>
        <div className={styles.brandBlock}>
          <div>
            <p className={styles.kicker}>实时估值 / 持仓收益 / 主要市场</p>
            <h1>基金持仓大屏</h1>
            <div className={styles.scopeNote}>
              <span>确权净值</span>
              <span>今日估值</span>
              <span>成本覆盖 {formatPct(portfolioDataQuality.costCoverage)}</span>
              <span>{lastUpdated ? `更新 ${lastUpdated}` : PORTFOLIO_METRIC_NOTES.refresh}</span>
            </div>
          </div>
        </div>
        <div className={styles.headerMeta}>
          <div className={styles.clock}><Clock3 size={17} />{clock}</div>
          <Link href="/" className={styles.headerButton} title="打开基金列表">
            <ListChecks size={17} />
            基金列表
          </Link>
          <button
            className={styles.headerButton}
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? '退出全屏' : '进入全屏'}
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
          <button className={styles.headerButton} type="button" onClick={refreshDashboard} disabled={refreshing}>
            <RefreshCw size={17} className={refreshing ? styles.spin : ''} />
            {refreshing ? '刷新中' : '立即刷新'}
          </button>
        </div>
      </header>

      <section className={styles.stats}>
        <StatTile icon={WalletCards} label="全部资产" value={`¥ ${formatNumber(totals.amount)}`} sub={`${fundRows.length} 只基金，确权口径`} tone="cyan" />
        <StatTile icon={Gauge} label="持有收益" value={`¥ ${formatNumber(totals.holdingProfit)}`} sub={`确权口径 ${formatPct(totals.holdingProfitRate)}`} tone={totals.holdingProfit >= 0 ? 'red' : 'green'} valueTone={totals.holdingProfit >= 0 ? 'valueUp' : 'valueDown'} />
      </section>

      <section className={styles.layout}>
        <aside className={styles.leftRail}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span><Activity size={16} />今日状态</span>
              <em>{fundRows.length} 只</em>
            </div>
            <div className={styles.statusSummary}>
              <div>
                <span>上涨</span>
                <strong className={styles.up}>{todayStatus.up}</strong>
              </div>
              <div>
                <span>下跌</span>
                <strong className={styles.down}>{todayStatus.down}</strong>
              </div>
              <div>
                <span>持平</span>
                <strong>{todayStatus.flat}</strong>
              </div>
              <div>
                <span>暂无估值</span>
                <strong>{todayStatus.unknown}</strong>
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span><RankIcon size={16} />{rankPanel.title}</span>
            </div>
            <div className={styles.rankList}>
              {rankPanel.items.map((fund, index) => (
                <div className={styles.rankItem} key={`${rankPanel.title}-${fund.positionKey}`}>
                  <i>{index + 1}</i>
                  <PositionLabel row={fund} compact muted />
                  <b className={signedClassName(fund.rate)}>{formatPct(fund.rate)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span><LineChart size={16} />主要市场</span>
              <em>{marketFocus.length} 项</em>
            </div>
            <div className={styles.marketMiniList}>
              {marketFocus.map((item) => {
                const up = Number(item.changePercent) >= 0;
                return (
                  <div className={styles.marketMiniItem} key={item.name}>
                    <span>{item.name}</span>
                    <strong>{formatNumber(item.price, 2)}</strong>
                    <b className={up ? styles.up : styles.down}>{formatPct(item.changePercent)}</b>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className={styles.centerStage}>
          <div className={styles.portfolioPanel}>
            <div>
              <p>今日预估收益</p>
              <h2 className={signedClassName(totals.todayProfit)}>¥ {formatNumber(totals.todayProfit)}</h2>
              <span>平均估算涨跌幅 {formatPct(totals.avgRate)}；收益金额按已配置份额估算</span>
            </div>
            <div className={styles.orbit}>
              <div className={styles.orbitRing} />
              <div className={styles.orbitCore}>
                <strong className={signedClassName(totals.avgRate)}>{formatPct(totals.avgRate)}</strong>
                <span>平均涨跌幅</span>
              </div>
            </div>
          </div>

          <div className={cn(styles.fundMatrix, fundMatrixClass)} style={fundMatrixStyle}>
            {topFunds.map((fund) => {
              const positive = Number(fund.rate) >= 0;
              return (
                <article className={styles.fundCard} key={fund.positionKey}>
                  <div className={styles.fundTop}>
                    <PositionLabel row={fund} compact />
                    <b className={signedClassName(fund.rate)}>{formatPct(fund.rate)}</b>
                  </div>
                  <MiniSparkline series={fund.series} positive={positive} />
                  <div className={styles.fundBottom}>
                    <span>估值 {formatNumber(fund.currentNav, 4)}</span>
                    <span className={signedClassName(fund.todayProfit)}>
                      ¥ {formatNumber(fund.todayProfit)}
                    </span>
                  </div>
                </article>
              );
            })}
            {restFundsSummary && (
              <div className={styles.restSummary}>
                <span>其余 {restFundsSummary.count} 只合计影响</span>
                <strong className={signedClassName(restFundsSummary.todayProfit)}>¥ {formatNumber(restFundsSummary.todayProfit)}</strong>
                <em>资产 ¥ {formatNumber(restFundsSummary.amount)}</em>
              </div>
            )}
          </div>
        </section>

        <aside className={styles.rightRail}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span><PieChart size={16} />持仓占比</span>
            </div>
            <div className={styles.allocationList}>
              {allocationRows.length ? allocationRows.map((fund) => (
                <div className={styles.allocationItem} key={fund.positionKey}>
                  <div>
                    <PositionLabel row={fund} compact muted />
                    <b>{formatNumber(fund.weight)}%</b>
                  </div>
                  <div className={styles.allocationBar}><i style={{ width: `${fund.weight}%` }} /></div>
                </div>
              )) : <p className={styles.emptyHint}>暂无持仓金额，设置持仓后展示持仓占比。</p>}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <span><Activity size={16} />今日影响</span>
            </div>
            <div className={styles.eventList}>
              {contributionRows.length ? contributionRows.map((fund, index) => (
                <div className={styles.eventItem} key={fund.positionKey}>
                  <i>{index + 1}</i>
                  <PositionLabel row={fund} compact muted />
                  <b className={signedClassName(fund.todayProfit)}>¥ {formatNumber(fund.todayProfit)}</b>
                </div>
              )) : <p className={styles.emptyHint}>暂无持仓金额，设置持仓后展示今日影响。</p>}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
