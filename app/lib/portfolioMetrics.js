const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getDatePart = (value) => {
  const text = value == null ? '' : String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
};

const getTransactionScopeMatcher = (scopeGroupIds) => {
  if (Array.isArray(scopeGroupIds)) {
    const ids = new Set(scopeGroupIds.filter(Boolean));
    return (gid) => ids.has(gid);
  }
  if (scopeGroupIds === null) {
    return (gid) => !gid;
  }
  if (scopeGroupIds) {
    return (gid) => gid === scopeGroupIds;
  }
  return () => true;
};

export const getFundMetricBasis = (fund) => {
  const confirmedNav = toFiniteNumber(fund?.dwjz);
  const estimatedNav = toFiniteNumber(fund?.gsz) ?? confirmedNav;
  const confirmedDate = getDatePart(fund?.jzrq);
  const valuationDate = getDatePart(fund?.gztime);
  const hasConfirmedForValuationDate = Boolean(
    confirmedNav != null &&
    confirmedDate &&
    (!valuationDate || confirmedDate >= valuationDate)
  );
  const useConfirmed = hasConfirmedForValuationDate || fund?.noValuation;
  const nav = useConfirmed ? (confirmedNav ?? estimatedNav) : (estimatedNav ?? confirmedNav);
  const lastNav = toFiniteNumber(fund?.lastNav);
  let changeRate = null;

  if (useConfirmed) {
    changeRate = toFiniteNumber(fund?.zzl);
    if (changeRate == null && confirmedNav != null && lastNav != null && lastNav > 0) {
      changeRate = ((confirmedNav - lastNav) / lastNav) * 100;
    }
  } else if (!fund?.noValuation) {
    changeRate = toFiniteNumber(fund?.gszzl);
  }

  return {
    nav,
    confirmedNav,
    estimatedNav,
    lastNav,
    changeRate,
    useConfirmed,
    source: useConfirmed ? 'confirmed' : 'valuation',
    date: useConfirmed ? confirmedDate : valuationDate,
  };
};

export const getPortfolioHoldingMetrics = (fund, holding, options = {}) => {
  const share = toFiniteNumber(holding?.share);
  const cost = toFiniteNumber(holding?.cost);
  const basis = getFundMetricBasis(fund);

  if (share == null || share <= 0 || basis.nav == null) {
    return {
      ...basis,
      amount: 0,
      estimatedAmount: 0,
      costAmount: 0,
      holdingProfit: 0,
      holdingProfitRate: null,
      todayProfit: 0,
      hasHolding: false,
      hasCost: false,
      hasEstimate: basis.changeRate != null && basis.nav != null,
    };
  }

  let shareForTodayProfit = share;
  const transactions = options.transactions || {};
  const code = fund?.code;
  const basisDate = basis.date;
  if (code && basisDate && transactions?.[code]) {
    const matchScope = getTransactionScopeMatcher(options.scopeGroupIds);
    let buyToday = 0;
    let sellToday = 0;
    for (const tx of transactions[code] || []) {
      if (!tx || tx.date !== basisDate || tx.isHistoryOnly) continue;
      const gid = tx.groupId || null;
      if (!matchScope(gid)) continue;
      const txShare = toFiniteNumber(tx.share);
      if (txShare == null || txShare <= 0) continue;
      if (tx.type === 'buy') buyToday += txShare;
      if (tx.type === 'sell') sellToday += txShare;
    }
    shareForTodayProfit = Math.max(0, share - buyToday + sellToday);
  }

  const exactNav = basis.confirmedNav ?? basis.nav;
  const amount = share * exactNav;
  const estimatedAmount = share * (basis.estimatedNav ?? exactNav);
  const costAmount = cost != null && cost > 0 ? share * cost : 0;
  const holdingProfit = costAmount > 0 ? amount - costAmount : 0;
  const holdingProfitRate = costAmount > 0 ? (holdingProfit / costAmount) * 100 : null;

  let todayProfit = 0;
  if (basis.useConfirmed && basis.confirmedNav != null && basis.lastNav != null && basis.lastNav > 0) {
    todayProfit = (basis.confirmedNav - basis.lastNav) * shareForTodayProfit;
  } else if (basis.changeRate != null) {
    const profitBaseAmount = shareForTodayProfit * basis.nav;
    todayProfit = profitBaseAmount - profitBaseAmount / (1 + basis.changeRate / 100);
  }

  return {
    ...basis,
    amount,
    estimatedAmount,
    costAmount,
    holdingProfit,
    holdingProfitRate,
    todayProfit,
    hasHolding: true,
    hasCost: costAmount > 0,
    hasEstimate: basis.changeRate != null && basis.nav != null,
  };
};
