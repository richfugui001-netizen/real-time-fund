export const PORTFOLIO_METRIC_NOTES = {
  totalAsset: '全部资产使用确权净值口径',
  todayProfit: '今日预估收益使用估值口径',
  holdingProfit: '持有收益使用确权净值减持仓成本',
  refresh: '刷新时间表示最近一次大屏主动拉取行情完成时间',
};

const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const formatRatio = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '--';
};

const formatMoney = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const getPortfolioDataQuality = (rows, pendingTrades = []) => {
  const heldRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.hasHolding && Number(row.amount) > 0);
  const totalCount = heldRows.length;
  const missingCostRows = heldRows.filter((row) => !row.hasCost);
  const missingEstimateRows = heldRows.filter((row) => !row.hasEstimate);
  const abnormalCostRows = heldRows.filter((row) => {
    const cost = toFiniteNumber(row.costAmount);
    const amount = toFiniteNumber(row.amount);
    if (cost == null || amount == null || cost <= 0 || amount <= 0) return false;
    const profitRate = toFiniteNumber(row.holdingProfitRate);
    const nav = toFiniteNumber(row.nav ?? row.currentNav);
    const costNav = toFiniteNumber(row.cost);
    const navRatio = nav && costNav ? costNav / nav : null;
    return Math.abs(profitRate ?? 0) >= 80 || (navRatio != null && (navRatio >= 5 || navRatio <= 0.2));
  });
  const amountDeviationRows = heldRows.filter((row) => {
    const amount = toFiniteNumber(row.amount);
    const estimatedAmount = toFiniteNumber(row.estimatedAmount);
    if (amount == null || estimatedAmount == null || amount <= 0) return false;
    return Math.abs(estimatedAmount - amount) / amount >= 0.05;
  });
  const pendingTradeCount = Array.isArray(pendingTrades) ? pendingTrades.length : 0;

  const estimateCoverage = totalCount ? ((totalCount - missingEstimateRows.length) / totalCount) * 100 : 0;
  const costCoverage = totalCount ? ((totalCount - missingCostRows.length) / totalCount) * 100 : 0;
  const warnings = [];

  if (missingCostRows.length) {
    warnings.push({
      type: 'info',
      title: '成本缺失',
      text: `${missingCostRows.length} 只持仓缺少成本，持有收益会按 0 处理。`,
    });
  }
  if (missingEstimateRows.length) {
    warnings.push({
      type: 'info',
      title: '今日收益不可估算',
      text: `${missingEstimateRows.length} 只持仓暂无今日估值或净值涨跌，今日预估收益未完整覆盖。`,
    });
  }
  if (abnormalCostRows.length) {
    const first = abnormalCostRows[0];
    warnings.push({
      type: 'danger',
      title: '成本净值可能异常',
      text: `${first.name || first.code} 的持有收益率为 ${formatRatio(first.holdingProfitRate)}，请检查成本净值是否填成了购买金额。`,
    });
  }
  if (amountDeviationRows.length) {
    const first = amountDeviationRows[0];
    warnings.push({
      type: 'warn',
      title: '持仓金额口径偏差',
      text: `${first.name || first.code} 的确权金额 ${formatMoney(first.amount)} 与估值金额 ${formatMoney(first.estimatedAmount)} 差异较大。`,
    });
  }
  if (pendingTradeCount) {
    warnings.push({
      type: 'info',
      title: '有待确认交易',
      text: `${pendingTradeCount} 条买入或卖出还在待确认，确认后资产和收益口径会更准确。`,
    });
  }

  return {
    totalCount,
    estimateCoverage,
    costCoverage,
    pendingTradeCount,
    missingCostCount: missingCostRows.length,
    missingEstimateCount: missingEstimateRows.length,
    abnormalCostCount: abnormalCostRows.length,
    amountDeviationCount: amountDeviationRows.length,
    warnings,
    notes: PORTFOLIO_METRIC_NOTES,
  };
};
