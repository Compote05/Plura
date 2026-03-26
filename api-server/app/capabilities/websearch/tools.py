from __future__ import annotations
import re
import logging
from urllib.parse import unquote

import httpx

from app.capabilities.base import CapabilityBase, ToolDefinition, ToolResult

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}


def _decode_ddg_url(href: str) -> str:
    m = re.search(r"[?&]uddg=([^&]+)", href)
    if m:
        return unquote(m.group(1))
    if href.startswith("http"):
        return href
    return ""


async def _ddg_search(query: str, max_results: int = 8) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(
                "https://lite.duckduckgo.com/lite/",
                params={"q": query},
                headers=_HEADERS,
            )
        html = resp.text

        # Find all <a> tags that have class='result-link' (href comes before class in DDG HTML)
        href_pattern = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
        snippet_pattern = re.compile(
            r"<td[^>]+class=['\"]result-snippet['\"][^>]*>(.*?)</td>",
            re.DOTALL | re.IGNORECASE,
        )

        full_link_pattern = re.compile(
            r"(<a\s[^>]*class=['\"]result-link['\"][^>]*>)(.*?)</a>",
            re.DOTALL | re.IGNORECASE,
        )
        snippets = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()
            for s in snippet_pattern.findall(html)
        ]

        results = []
        for i, (tag, title) in enumerate(full_link_pattern.findall(html)[:max_results]):
            href_m = href_pattern.search(tag)
            if not href_m:
                continue
            # DDG uses &amp; in HTML — decode it
            raw_href = href_m.group(1).replace("&amp;", "&")
            url = _decode_ddg_url(raw_href)
            clean_title = re.sub(r"<[^>]+>", "", title).strip()
            snippet = snippets[i] if i < len(snippets) else ""
            if url and clean_title:
                results.append({"url": url, "title": clean_title, "snippet": snippet})

        logger.info("DDG search '%s' -> %d results", query, len(results))
        return results

    except Exception as e:
        logger.error("DDG search failed for '%s': %s", query, e)
        return []


class WebSearchCapability(CapabilityBase):
    id = "websearch"
    name = "Web Search"
    description = "Search the internet and read web pages to answer questions about current events, facts, or any URL."
    icon = "Globe"
    color = "cyan"

    @property
    def tools(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="search_web",
                description=(
                    "Search the internet for up-to-date information. Use this whenever the user asks about "
                    "current events, recent news, prices, people, or anything that may have changed. "
                    "Also use this when the user asks 'what happened on [date]' or any factual question "
                    "that benefits from real-time data."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query to look up on the web.",
                        }
                    },
                    "required": ["query"],
                },
            ),
            ToolDefinition(
                name="fetch_url",
                description=(
                    "Fetch and read the content of a specific URL. Use this when the user provides a URL "
                    "or when you want to read a specific webpage found in search results."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The full URL to fetch (must start with https://).",
                        }
                    },
                    "required": ["url"],
                },
            ),
        ]

    async def execute(self, tool_name: str, args: dict) -> ToolResult:
        if tool_name == "search_web":
            return await self._search_web(args.get("query", ""))
        if tool_name == "fetch_url":
            return await self._fetch_url(args.get("url", ""))
        return ToolResult(text="Unknown tool.", result_type="text")

    async def _search_web(self, query: str) -> ToolResult:
        try:
            results = await _ddg_search(query, max_results=8)
            if not results:
                return ToolResult(
                    text=f"No results found for '{query}'.",
                    result_type="text",
                )

            sources = [
                {"url": r["url"], "title": r["title"], "snippet": r["snippet"]}
                for r in results
            ]

            context = f"Web search results for '{query}':\n\n"
            for i, s in enumerate(sources, 1):
                context += f"[{i}] {s['title']}\n"
                if s["snippet"]:
                    context += f"    {s['snippet']}\n"
                context += f"    Source: {s['url']}\n\n"

            context += "Use the above results to answer the user's question. Always cite your sources with their URLs."

            return ToolResult(
                text=context,
                result_type="web_search",
                data={"query": query, "sources": sources},
            )
        except Exception as e:
            logger.exception("Error in search_web for '%s'", query)
            return ToolResult(text=f"Search failed: {e}", result_type="text")

    async def _fetch_url(self, url: str) -> ToolResult:
        try:
            if not url.startswith("http"):
                return ToolResult(text="Invalid URL.", result_type="text")

            async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
                resp = await client.get(url, headers=_HEADERS)

            if resp.status_code != 200:
                return ToolResult(text=f"Could not fetch '{url}' (status {resp.status_code}).", result_type="text")

            html = resp.text
            text = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"&nbsp;", " ", text)
            text = re.sub(r"\s{2,}", " ", text).strip()[:3000]

            title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE)
            title = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else url

            return ToolResult(
                text=f"Content of {url}:\n\n{text}",
                result_type="web_fetch",
                data={"url": url, "title": title},
            )
        except Exception as e:
            logger.exception("Error fetching URL '%s'", url)
            return ToolResult(text=f"Error fetching URL: {e}", result_type="text")
