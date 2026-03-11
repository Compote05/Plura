"use client";

import { motion } from "framer-motion";
import { Newspaper, ExternalLink } from "lucide-react";

interface PricePoint {
    date: string;
    close: number;
}

interface ChartData {
    symbol: string;
    name: string;
    price: number;
    change_pct: number;
    change_abs: number;
    prev_close: number;
    high_30d: number;
    low_30d: number;
    currency: string;
    history: PricePoint[];
}

interface MarketItem {
    name: string;
    symbol: string;
    price: number;
    change_pct: number;
}

interface NewsArticle {
    title: string;
    source: string;
    published: string;
    link: string;
}

export interface ToolResult {
    tool_name: string;
    result_type: string;
    data: Record<string, unknown>;
}

// Smooth SVG chart with bezier curves and Y-axis labels
function PriceChart({ history, isUp }: { history: PricePoint[]; isUp: boolean }) {
    if (!history || history.length < 2) return null;

    const values = history.map((p) => p.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const W = 600;
    const H = 140;
    const PAD_X = 0;
    const PAD_Y = 8;

    const pts = values.map((v, i) => ({
        x: PAD_X + (i / (values.length - 1)) * (W - PAD_X * 2),
        y: PAD_Y + (1 - (v - min) / range) * (H - PAD_Y * 2),
    }));

    // Smooth bezier path (catmull-rom style)
    let linePath = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const cpx = (prev.x + curr.x) / 2;
        linePath += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    const areaPath = `${linePath} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`;

    const color = isUp ? "#10b981" : "#f87171";
    const gradId = `cg-${isUp ? "up" : "dn"}`;

    // Y-axis labels (3 levels)
    const yLabels = [
        { value: max, y: PAD_Y },
        { value: min + range / 2, y: H / 2 },
        { value: min, y: H - PAD_Y },
    ];

    return (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }} preserveAspectRatio="none">
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                    <stop offset="85%" stopColor={color} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            {/* Y-axis grid lines */}
            {yLabels.map((l, i) => (
                <line key={i} x1={0} y1={l.y} x2={W} y2={l.y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            ))}
            <path d={areaPath} fill={`url(#${gradId})`} />
            <path d={linePath} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
            {/* Last price dot */}
            <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill={color} />
        </svg>
    );
}

function ChartBlock({ data }: { data: ChartData }) {
    const isUp = data.change_pct >= 0;
    const color = isUp ? "#10b981" : "#f87171";
    const textColor = isUp ? "text-emerald-400" : "text-red-400";

    const fmt = (p: number) =>
        p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: p > 100 ? 2 : 4 });

    const stats = [
        { label: "Prev Close", value: fmt(data.prev_close) },
        { label: "30d High", value: fmt(data.high_30d) },
        { label: "30d Low", value: fmt(data.low_30d) },
    ];

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="my-3 rounded-2xl bg-white/[0.03] border border-white/[0.07] overflow-hidden"
        >
            {/* Header */}
            <div className="px-5 pt-5 pb-1">
                <div className="text-[12px] text-white/40 font-medium mb-2">
                    {data.name && data.name !== data.symbol ? (
                        <><span className="text-white/70">{data.name}</span> · <span>{data.symbol}</span></>
                    ) : (
                        <span>{data.symbol}</span>
                    )}
                </div>
                <div className="flex items-end gap-3">
                    <span className="text-[28px] font-semibold text-white tracking-tight leading-none">
                        {data.currency} {fmt(data.price)}
                    </span>
                    <span className={`text-[14px] font-semibold pb-0.5 ${textColor}`}>
                        {isUp ? "+" : ""}{fmt(data.change_abs)} ({isUp ? "+" : ""}{data.change_pct.toFixed(2)}%)
                    </span>
                </div>
            </div>

            {/* Chart */}
            <div className="px-1 py-2">
                <PriceChart history={data.history} isUp={isUp} />
            </div>

            {/* X-axis dates */}
            {data.history.length > 0 && (
                <div className="flex justify-between px-5 pb-3 text-[10px] text-white/20">
                    <span>{data.history[0]?.date}</span>
                    <span>{data.history[data.history.length - 1]?.date}</span>
                </div>
            )}

            {/* Stats row */}
            <div className="flex divide-x divide-white/[0.05] border-t border-white/[0.05]">
                {stats.map((s) => (
                    <div key={s.label} className="flex-1 px-4 py-3">
                        <div className="text-[10px] text-white/30 uppercase tracking-widest mb-1">{s.label}</div>
                        <div className="text-[13px] font-medium text-white/80">{s.value}</div>
                    </div>
                ))}
            </div>
        </motion.div>
    );
}

function MarketOverviewBlock({ data }: { data: { markets: MarketItem[] } }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="my-3 grid grid-cols-2 gap-2"
        >
            {data.markets.map((m) => {
                const isUp = m.change_pct >= 0;
                const textColor = isUp ? "text-emerald-400" : "text-red-400";
                const borderColor = isUp ? "border-emerald-500/15" : "border-red-500/15";
                const bg = isUp ? "bg-emerald-500/[0.05]" : "bg-red-500/[0.05]";
                return (
                    <div key={m.symbol} className={`rounded-xl border ${borderColor} ${bg} px-4 py-3.5`}>
                        <div className="text-[11px] text-white/35 uppercase tracking-widest mb-1.5 font-medium">
                            {m.name}
                        </div>
                        <div className="text-[17px] font-semibold text-white leading-none">
                            {m.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                        </div>
                        <div className={`text-[12px] font-medium mt-1.5 ${textColor}`}>
                            {isUp ? "+" : ""}
                            {m.change_pct.toFixed(2)}%
                        </div>
                    </div>
                );
            })}
        </motion.div>
    );
}

function NewsBlock({ data }: { data: { query: string; articles: NewsArticle[] } }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="my-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden"
        >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.05]">
                <Newspaper size={13} className="text-white/35" />
                <span className="text-[11px] text-white/40 uppercase tracking-[0.12em] font-medium">
                    News · {data.query}
                </span>
            </div>
            <div className="divide-y divide-white/[0.04]">
                {data.articles.slice(0, 6).map((article, i) => (
                    <a
                        key={i}
                        href={article.link || undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-white/[0.03] transition-colors group/news cursor-pointer"
                    >
                        <div className="flex-1 min-w-0">
                            <p className="text-[14px] text-white/75 leading-snug group-hover/news:text-white transition-colors line-clamp-2">
                                {article.title}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5">
                                {article.source && (
                                    <span className="text-[11px] text-white/30 font-medium">{article.source}</span>
                                )}
                                {article.published && (
                                    <span className="text-[11px] text-white/20">
                                        {(() => {
                                            try {
                                                return new Date(article.published).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                                            } catch { return ""; }
                                        })()}
                                    </span>
                                )}
                            </div>
                        </div>
                        <ExternalLink size={12} className="shrink-0 text-white/15 group-hover/news:text-white/50 transition-colors mt-1" />
                    </a>
                ))}
            </div>
        </motion.div>
    );
}

export default function ToolResultBlock({ result }: { result: ToolResult }) {
    if (result.result_type === "chart") {
        return <ChartBlock data={result.data as unknown as ChartData} />;
    }
    if (result.result_type === "market_overview") {
        return <MarketOverviewBlock data={result.data as unknown as { markets: MarketItem[] }} />;
    }
    if (result.result_type === "news") {
        return <NewsBlock data={result.data as unknown as { query: string; articles: NewsArticle[] }} />;
    }
    return null;
}
