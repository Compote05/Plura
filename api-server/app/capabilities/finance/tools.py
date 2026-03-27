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
                    "Use this when the user asks about the price, value, or chart of a SPECIFIC asset "
                    "(stock, crypto, commodity, index). Pass the asset name or ticker symbol as-is — "
                    "the tool will automatically resolve it. Examples: 'bitcoin', 'apple', 'pétrole', "
                    "'crude oil', 'S&P 500', 'AAPL', 'BTC-USD'. "
                    "IMPORTANT: The price returned is real-time data from Yahoo Finance. "
                    "Always report it exactly as returned — never question, correct, or second-guess it."
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
                    "Use this when the user asks for a market overview or asks how markets are doing. "
                    "Pick the most relevant symbols based on the conversation context. "
                    "For general market talk: use ^GSPC, ^IXIC, ^FCHI, ^GDAXI, BTC-USD. "
                    "For crypto talk: use BTC-USD, ETH-USD, SOL-USD, BNB-USD. "
                    "For commodities talk: use GC=F (Gold), CL=F (Oil), SI=F (Silver), NG=F (Natural Gas). "
                    "For European markets: use ^FCHI, ^GDAXI, ^FTSE, ^AEX. "
                    "Always choose symbols relevant to what the user is discussing. "
                    "IMPORTANT: All prices returned are real-time from Yahoo Finance. "
                    "Report them exactly as-is — never question or correct them."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "symbols": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of 3-6 ticker symbols to display (e.g. ['^GSPC', '^IXIC', 'BTC-USD'])",
                        }
                    },
                    "required": ["symbols"],
                },
            ),
        ]

    async def execute(self, tool_name: str, args: dict) -> ToolResult:
        if tool_name == "get_asset_price":
            return await self._get_asset_price(args.get("symbol", "BTC-USD"))
        if tool_name == "get_market_overview":
            return await self._get_market_overview(args.get("symbols", ["^GSPC", "^IXIC", "BTC-USD", "GC=F"]))
        return ToolResult(text="Unknown tool.", result_type="text")

    def _resolve_symbol(self, query: str) -> str:
        """Try to resolve a name/query to a valid ticker using yfinance search."""
        try:
            results = yf.Search(query, max_results=1).quotes
            if results:
                return results[0].get("symbol", query)
        except Exception:
            pass
        return query

    async def _get_asset_price(self, symbol: str) -> ToolResult:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="30d", auto_adjust=True)

            # If no data, try resolving via search
            if hist.empty:
                resolved = self._resolve_symbol(symbol)
                if resolved != symbol:
                    logger.info("Resolved '%s' → '%s'", symbol, resolved)
                    symbol = resolved
                    ticker = yf.Ticker(symbol)
                    hist = ticker.history(period="30d", auto_adjust=True)

            if hist.empty:
                return ToolResult(text=f"No data found for '{symbol}'.", result_type="text")

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

    async def _get_market_overview(self, symbols: list[str]) -> ToolResult:
        markets = []
        for symbol in symbols[:6]:
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.fast_info
                price = float(info.last_price)
                prev = float(info.previous_close)
                change_pct = ((price - prev) / prev) * 100
                try:
                    display_name = ticker.info.get("shortName") or ticker.info.get("longName") or symbol
                except Exception:
                    display_name = symbol
                markets.append({"name": display_name, "symbol": symbol, "price": price, "change_pct": change_pct})
            except Exception:
                pass

        text = "Market Overview: " + " | ".join(
            f"{m['name']}: {m['price']:,.2f} ({m['change_pct']:+.2f}%)" for m in markets
        )
        return ToolResult(text=text, result_type="market_overview", data={"markets": markets})
