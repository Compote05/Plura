from __future__ import annotations
import logging

import yfinance as yf

from app.capabilities.base import CapabilityBase, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)


class FinanceCapability(CapabilityBase):
    id = "finance"
    name = "Finance & Markets"
    description = "Real-time prices, charts, and market data for stocks, crypto, and indices."
    icon = "TrendingUp"
    color = "emerald"

    @property
    def tools(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="get_asset_price",
                description=(
                    "Use this when the user asks about the price, value, or chart of a SPECIFIC asset. "
                    "Convert asset names to Yahoo Finance ticker symbols using this mapping: "
                    "Bitcoin/BTC→BTC-USD, Ethereum/ETH→ETH-USD, Solana→SOL-USD, "
                    "Apple→AAPL, Tesla→TSLA, Microsoft→MSFT, Google→GOOGL, Amazon→AMZN, Nvidia→NVDA, "
                    "S&P500/SP500→^GSPC, NASDAQ→^IXIC, Dow Jones→^DJI, "
                    "Gold/Or→GC=F, Silver/Argent→SI=F, "
                    "Oil/Pétrole/Crude/WTI/Brent→CL=F, "
                    "Natural Gas→NG=F, Copper→HG=F, Wheat/Blé→ZW=F. "
                    "Always use the exact ticker symbol."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "symbol": {
                            "type": "string",
                            "description": "Ticker symbol (e.g. BTC-USD, AAPL, ETH-USD, ^GSPC)",
                        }
                    },
                    "required": ["symbol"],
                },
            ),
            ToolDefinition(
                name="get_market_overview",
                description=(
                    "Use this ONLY when the user asks for a general market overview, "
                    "how the markets are doing in general, or asks about multiple indices at once. "
                    "Do NOT use this for a specific asset — use get_asset_price instead."
                ),
                parameters={"type": "object", "properties": {}, "required": []},
            ),
        ]

    async def execute(self, tool_name: str, args: dict) -> ToolResult:
        if tool_name == "get_asset_price":
            return await self._get_asset_price(args.get("symbol", "BTC-USD"))
        if tool_name == "get_market_overview":
            return await self._get_market_overview()
        return ToolResult(text="Unknown tool.", result_type="text")

    async def _get_asset_price(self, symbol: str) -> ToolResult:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="30d", auto_adjust=True)
            if hist.empty:
                return ToolResult(text=f"No data found for symbol '{symbol}'.", result_type="text")

            info = ticker.fast_info
            current_price = float(getattr(info, "last_price", None) or hist["Close"].iloc[-1])
            prev_close = float(getattr(info, "previous_close", None) or hist["Close"].iloc[-2])
            change_pct = ((current_price - prev_close) / prev_close) * 100
            change_abs = current_price - prev_close
            currency = getattr(info, "currency", "USD") or "USD"

            high_30d = round(float(hist["High"].max()), 4)
            low_30d = round(float(hist["Low"].min()), 4)

            # Try to get display name
            try:
                name = ticker.info.get("shortName") or ticker.info.get("longName") or symbol
            except Exception:
                name = symbol

            history = [
                {"date": str(ts.date()), "close": round(float(close), 4)}
                for ts, close in zip(hist.index, hist["Close"])
            ]

            text = (
                f"{name} ({symbol}): {currency} {current_price:,.2f} "
                f"({'▲' if change_pct >= 0 else '▼'}{abs(change_pct):.2f}% today)"
            )
            return ToolResult(
                text=text,
                result_type="chart",
                data={
                    "symbol": symbol,
                    "name": name,
                    "price": current_price,
                    "change_pct": change_pct,
                    "change_abs": round(change_abs, 4),
                    "prev_close": round(prev_close, 4),
                    "high_30d": high_30d,
                    "low_30d": low_30d,
                    "currency": currency,
                    "history": history,
                },
            )
        except Exception as e:
            logger.exception("Error fetching asset price for %s", symbol)
            return ToolResult(text=f"Error fetching data for '{symbol}': {e}", result_type="text")

    async def _get_market_overview(self) -> ToolResult:
        symbols = [
            ("S&P 500", "^GSPC"),
            ("NASDAQ", "^IXIC"),
            ("Bitcoin", "BTC-USD"),
            ("Gold", "GC=F"),
        ]
        markets = []
        for name, symbol in symbols:
            try:
                info = yf.Ticker(symbol).fast_info
                price = float(info.last_price)
                prev = float(info.previous_close)
                change_pct = ((price - prev) / prev) * 100
                markets.append({"name": name, "symbol": symbol, "price": price, "change_pct": change_pct})
            except Exception:
                pass

        text = "Market Overview: " + " | ".join(
            f"{m['name']}: {m['price']:,.2f} ({m['change_pct']:+.2f}%)" for m in markets
        )
        return ToolResult(text=text, result_type="market_overview", data={"markets": markets})
