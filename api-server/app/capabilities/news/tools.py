from __future__ import annotations
import re
import logging

import httpx

from app.capabilities.base import CapabilityBase, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)


class NewsCapability(CapabilityBase):
    id = "news"
    name = "Live News"
    description = "Fetch current news headlines and articles for any topic."
    icon = "Newspaper"
    color = "blue"

    @property
    def tools(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="get_news",
                description=(
                    "Fetch the latest news headlines for a topic, company, event, or query. "
                    "Examples: 'Bitcoin', 'OpenAI', 'US economy', 'climate change'."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The news topic or search query.",
                        }
                    },
                    "required": ["query"],
                },
            ),
        ]

    async def execute(self, tool_name: str, args: dict) -> ToolResult:
        if tool_name == "get_news":
            return await self._get_news(args.get("query", ""))
        return ToolResult(text="Unknown tool.", result_type="text")

    async def _get_news(self, query: str) -> ToolResult:
        try:
            url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
            async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})

            articles = []
            items = re.findall(r"<item>(.*?)</item>", resp.text, re.DOTALL)[:10]
            for item in items:
                title_m = re.search(r"<title>(.*?)</title>", item)
                pub_m = re.search(r"<pubDate>(.*?)</pubDate>", item)
                source_m = re.search(r"<source[^>]*>(.*?)</source>", item)
                link_m = re.search(r"<link>([^<]+)</link>", item) or re.search(r"<link/>\s*(https?://[^\s<]+)", item)

                if not title_m:
                    continue

                raw_title = title_m.group(1).strip()
                raw_title = re.sub(r"<!\[CDATA\[|\]\]>", "", raw_title)
                raw_title = re.sub(r"&amp;", "&", raw_title)
                title = re.sub(r"\s+-\s+[^-]+$", "", raw_title).strip()

                source = re.sub(r"<!\[CDATA\[|\]\]>", "", source_m.group(1)).strip() if source_m else ""
                pub_date = pub_m.group(1).strip() if pub_m else ""
                raw_link = link_m.group(1).strip() if link_m else ""
                link = raw_link if raw_link.startswith("https://") else ""

                articles.append({"title": title, "source": source, "published": pub_date, "link": link})

            if not articles:
                return ToolResult(text=f"No news found for '{query}'.", result_type="text")

            summary = f"Top news for '{query}':\n" + "\n".join(
                f"- {a['title']}" + (f" ({a['source']})" if a["source"] else "")
                for a in articles[:5]
            )
            return ToolResult(
                text=summary,
                result_type="news",
                data={"query": query, "articles": articles},
            )
        except Exception as e:
            logger.exception("Error fetching news for '%s'", query)
            return ToolResult(text=f"Error fetching news: {e}", result_type="text")
