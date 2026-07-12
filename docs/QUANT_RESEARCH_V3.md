# Nirvana Quant Research v3

## Purpose

Research AI now combines fundamental research with quantitative diagnostics. The implementation uses the ideas in the supplied image as research modules, but does not misrepresent unavailable datasets or convert classroom models into unsupported trade advice.

## Automatic for every ticker

- 1M, 3M, 6M, YTD and 1Y absolute momentum
- relative returns versus SPY
- short/long trend-average regime
- annualized volatility
- maximum drawdown
- correlation and estimated beta versus SPY
- strengthening, weakening or mixed momentum classification
- explicit comparison between the quant signal and fundamental thesis

This is a single-security diagnostic using available one-year closing-price history. It is not described as a cross-sectional long-winner/short-loser backtest.

## Available research modules

### Momentum backtesting

The skill requires a defined universe, formation period, holding period, rebalance frequency, benchmark, costs and bias controls before treating output as a backtest.

### Options pricing

The skill can discuss Black-Scholes and Greeks when spot, strike, time, risk-free rate, volatility and option type are supplied. A live options chain is required for implied-volatility surface or mispricing claims.

### Statistical-arbitrage pairs

The skill requires two securities, overlapping history, cointegration/stationarity evidence, spread definition, z-score rules, half-life, structural-break checks and costs. Correlation alone is not accepted as a pairs-trading edge.

### Earnings volatility

The skill requires earnings dates and event-window returns; option-mispricing analysis also requires historical option IV/chain data. It will name the missing dataset rather than improvise.

### Order-book research

The skill requires timestamped Level II or exchange-quality quote/trade data. Daily and weekly closes are explicitly rejected for microstructure conclusions.

## Changed files

- `server/skills/quant-equity-research.md`
- `server/skills/stock-market-analyst.md`
- `server/services/chat-routing.js`
- `server/services/chat-service.js`
- `server/services/market/analytics.js`
- `server/services/market/index.js`
- `tests/quant-research.test.js`

No database migration or npm dependency is required.
