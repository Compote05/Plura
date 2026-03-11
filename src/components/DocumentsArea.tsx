"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { FileText, Trash2, HardDrive, Sparkles, Folder, Mic, ImageIcon, Brain, Search, Play, TrendingUp, Newspaper, ToggleLeft, ToggleRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import ImageViewer from "./ImageViewer";
import AudioViewer from "./AudioViewer";
import Link from "next/link";

interface GeneratedItem {
    id: string;
    type: "image" | "audio";
    prompt: string;
    storage_path: string;
    created_at: string;
}

interface DatabaseDocument {
    id: string;
    filename: string;
    storage_path: string;
    size: number;
    created_at: string;
    content_type?: string;
}

interface DocumentsAreaProps {
    user: User | null;
}

type MainSection = "explore" | "capabilities" | "mydata";

interface Capability {
    id: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    tools: { name: string; description: string }[];
    enabled: boolean;
}
type DataTab = "generated" | "documents";

const EXPLORE_MODES = [
    {
        id: "imgen",
        name: "Image Generation",
        description: "Full control over generation parameters — samplers, CFG scale, seeds, and custom workflows.",
        icon: <ImageIcon size={18} strokeWidth={1.5} />,
        iconBg: "bg-fuchsia-500/10 text-fuchsia-400",
        href: "#",
        available: true,
        tag: null,
    },
    {
        id: "tts",
        name: "Text-to-Speech",
        description: "Convert text to natural-sounding voice across multiple languages and styles.",
        icon: <Mic size={18} strokeWidth={1.5} />,
        iconBg: "bg-emerald-500/10 text-emerald-400",
        href: "/tts",
        available: true,
        tag: null,
    },
    {
        id: "learning",
        name: "Learning",
        description: "Upload documents or courses to generate tailored revision sheets and audio lessons.",
        icon: <Brain size={18} strokeWidth={1.5} />,
        iconBg: "bg-amber-500/10 text-amber-400",
        href: "#",
        available: false,
        tag: "Soon",
    },
    {
        id: "search",
        name: "Deep Search",
        description: "Advanced research mode using verified sources to retrieve accurate, grounded answers.",
        icon: <Search size={18} strokeWidth={1.5} />,
        iconBg: "bg-rose-500/10 text-rose-400",
        href: "#",
        available: false,
        tag: "Soon",
    },
];

type ExploreFilter = "all" | "available" | "coming";

function ExploreModes() {
    const [filter, setFilter] = useState<ExploreFilter>("all");

    const filters: { id: ExploreFilter; label: string; count: number }[] = [
        { id: "all", label: "All", count: EXPLORE_MODES.length },
        { id: "available", label: "Available", count: EXPLORE_MODES.filter(m => m.available).length },
        { id: "coming", label: "Coming Soon", count: EXPLORE_MODES.filter(m => !m.available).length },
    ];

    const filtered = filter === "all" ? EXPLORE_MODES
        : filter === "available" ? EXPLORE_MODES.filter(m => m.available)
        : EXPLORE_MODES.filter(m => !m.available);

    return (
        <div className="flex gap-8 flex-1 pb-12 min-h-0">
            {/* Sidebar */}
            <div className="w-44 shrink-0 flex flex-col gap-1 pt-1">
                <p className="text-[10px] font-medium text-white/25 uppercase tracking-[0.15em] px-3 mb-3">
                    Filter
                </p>
                {filters.map((f) => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={cn(
                            "flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all text-left",
                            filter === f.id
                                ? "bg-white/[0.07] text-white"
                                : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"
                        )}
                    >
                        <span>{f.label}</span>
                        <span className={cn("text-[11px] tabular-nums", filter === f.id ? "text-white/50" : "text-white/20")}>
                            {f.count}
                        </span>
                    </button>
                ))}

                <div className="mt-auto pt-6 px-3">
                    <div className="text-[10px] text-white/20 uppercase tracking-widest mb-1">Available</div>
                    <div className="text-[22px] font-semibold text-white/80 leading-none">
                        {EXPLORE_MODES.filter(m => m.available).length}
                    </div>
                    <div className="text-[11px] text-white/25 mt-0.5">of {EXPLORE_MODES.length} modes</div>
                </div>
            </div>

            {/* Cards */}
            <div className="flex-1 min-w-0">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {filtered.map((mode) => {
                        const Wrapper = mode.available && mode.href !== "#" ? Link : "a";
                        return (
                            <Wrapper
                                key={mode.id}
                                href={mode.href}
                                className={cn(
                                    "group flex flex-col p-5 rounded-2xl border transition-all duration-200",
                                    mode.available
                                        ? "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10 cursor-pointer"
                                        : "bg-white/[0.01] border-white/[0.04] cursor-default opacity-60"
                                )}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div className={cn("w-10 h-10 flex items-center justify-center rounded-xl transition-colors", mode.iconBg)}>
                                        {mode.icon}
                                    </div>
                                    {mode.tag && (
                                        <span className="text-[10px] font-medium text-white/25 uppercase tracking-widest px-2.5 py-1 border border-white/[0.06] rounded-full">
                                            {mode.tag}
                                        </span>
                                    )}
                                    {mode.available && (
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                            <span className="text-[11px] text-white/30">Active</span>
                                        </div>
                                    )}
                                </div>
                                <h4 className="text-[14px] font-semibold text-white/90 mb-1.5 tracking-tight group-hover:text-white transition-colors">
                                    {mode.name}
                                </h4>
                                <p className="text-[12.5px] text-white/40 leading-relaxed">
                                    {mode.description}
                                </p>
                            </Wrapper>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

const CATEGORY_LABELS: Record<string, string> = {
    finance: "Finance",
    news: "News",
    weather: "Weather",
    search: "Search",
};

function CapabilitiesSection({
    user,
    capabilities,
    togglingCap,
    onToggle,
    getIcon,
}: {
    user: User | null;
    capabilities: Capability[];
    togglingCap: string | null;
    onToggle: (id: string, enabled: boolean) => void;
    getIcon: (icon: string, color: string) => React.ReactNode;
}) {
    const [activeFilter, setActiveFilter] = useState<string>("all");

    const categories = ["all", ...Array.from(new Set(capabilities.map((c) => c.id)))];

    const filtered = activeFilter === "all"
        ? capabilities
        : capabilities.filter((c) => c.id === activeFilter);

    const activeCount = capabilities.filter((c) => c.enabled).length;

    const colorDot: Record<string, string> = {
        emerald: "bg-emerald-400",
        blue: "bg-blue-400",
        amber: "bg-amber-400",
        rose: "bg-rose-400",
        purple: "bg-purple-400",
    };

    if (!user) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-2xl">
                <Zap className="w-10 h-10 text-white/20 mb-4" strokeWidth={1.5} />
                <h3 className="text-lg font-medium text-white mb-2">Login Required</h3>
                <p className="text-white/40 text-[15px] max-w-sm">Sign in to manage capabilities.</p>
            </div>
        );
    }

    return (
        <div className="flex gap-8 flex-1 pb-12 min-h-0">
            {/* Left sidebar */}
            <div className="w-44 shrink-0 flex flex-col gap-1 pt-1">
                <p className="text-[10px] font-medium text-white/25 uppercase tracking-[0.15em] px-3 mb-3">
                    Categories
                </p>
                {categories.map((cat) => {
                    const cap = capabilities.find((c) => c.id === cat);
                    const isActive = activeFilter === cat;
                    return (
                        <button
                            key={cat}
                            onClick={() => setActiveFilter(cat)}
                            className={cn(
                                "flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-medium transition-all text-left",
                                isActive
                                    ? "bg-white/[0.07] text-white"
                                    : "text-white/40 hover:text-white/70 hover:bg-white/[0.03]"
                            )}
                        >
                            <div className="flex items-center gap-2.5">
                                {cat === "all" ? (
                                    <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                                ) : (
                                    <div className={cn("w-1.5 h-1.5 rounded-full", colorDot[cap?.color || ""] || "bg-white/30")} />
                                )}
                                {cat === "all" ? "All" : (CATEGORY_LABELS[cat] || cat)}
                            </div>
                            <span className={cn(
                                "text-[11px] tabular-nums",
                                isActive ? "text-white/50" : "text-white/20"
                            )}>
                                {cat === "all" ? capabilities.length : 1}
                            </span>
                        </button>
                    );
                })}

                {/* Active count */}
                <div className="mt-auto pt-6 px-3">
                    <div className="text-[10px] text-white/20 uppercase tracking-widest mb-1">Active</div>
                    <div className="text-[22px] font-semibold text-white/80 leading-none">{activeCount}</div>
                    <div className="text-[11px] text-white/25 mt-0.5">of {capabilities.length} enabled</div>
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0">
                {capabilities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-2xl">
                        <Zap className="w-10 h-10 text-white/20 mb-4" strokeWidth={1.5} />
                        <p className="text-white/40 text-[15px]">No capabilities found. Make sure the api-server is running.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <AnimatePresence mode="popLayout">
                            {filtered.map((cap) => (
                                <motion.div
                                    key={cap.id}
                                    layout
                                    initial={false}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0, scale: 0.97 }}
                                    transition={{ duration: 0.15 }}
                                    className={cn(
                                        "relative flex flex-col p-5 rounded-2xl border transition-all duration-300",
                                        cap.enabled
                                            ? "bg-white/[0.04] border-white/10"
                                            : "bg-white/[0.015] border-white/[0.06]"
                                    )}
                                >
                                    {/* Top row */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            {getIcon(cap.icon, cap.color)}
                                            <div>
                                                <h4 className="text-[14px] font-semibold text-white/90 leading-tight">
                                                    {cap.name}
                                                </h4>
                                                <div className="flex items-center gap-1.5 mt-1">
                                                    <div className={cn(
                                                        "w-1.5 h-1.5 rounded-full transition-all",
                                                        cap.enabled ? "bg-emerald-400" : "bg-white/15"
                                                    )} />
                                                    <span className="text-[11px] text-white/30">
                                                        {cap.enabled ? "Active" : "Inactive"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Toggle */}
                                        <button
                                            onClick={() => onToggle(cap.id, cap.enabled)}
                                            disabled={togglingCap === cap.id}
                                            className={cn(
                                                "relative w-10 h-5.5 rounded-full transition-all duration-300 disabled:opacity-40 shrink-0 mt-0.5",
                                                cap.enabled ? "bg-emerald-500/80" : "bg-white/10"
                                            )}
                                            style={{ height: 22, width: 40 }}
                                        >
                                            <motion.div
                                                animate={{ x: cap.enabled ? 20 : 2 }}
                                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                                className="absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm"
                                            />
                                        </button>
                                    </div>

                                    {/* Description */}
                                    <p className="text-[12.5px] text-white/40 leading-relaxed mb-4 flex-1">
                                        {cap.description}
                                    </p>

                                    {/* Tools */}
                                    <div className="flex flex-wrap gap-1.5">
                                        {cap.tools.map((tool) => (
                                            <span
                                                key={tool.name}
                                                className="text-[10px] px-2 py-1 bg-white/[0.04] border border-white/[0.06] text-white/30 rounded-lg font-mono"
                                            >
                                                {tool.name}
                                            </span>
                                        ))}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function DocumentsArea({ user }: DocumentsAreaProps) {
    const [generatedItems, setGeneratedItems] = useState<GeneratedItem[]>([]);
    const [documents, setDocuments] = useState<DatabaseDocument[]>([]);
    const [activeSection, setActiveSection] = useState<MainSection>("explore");
    const [activeDataTab, setActiveDataTab] = useState<DataTab>("generated");
    const [capabilities, setCapabilities] = useState<Capability[]>([]);
    const [togglingCap, setTogglingCap] = useState<string | null>(null);
    const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
    const resolvingUrls = useRef<Set<string>>(new Set());

    // Viewer state
    const [imageViewerOpen, setImageViewerOpen] = useState(false);
    const [viewerImage, setViewerImage] = useState<{ src: string, prompt: string } | null>(null);

    const [audioViewerOpen, setAudioViewerOpen] = useState(false);
    const [viewerAudio, setViewerAudio] = useState<{ src: string, prompt: string } | null>(null);

    useEffect(() => {
        if (!user) return;

        const fetchGenerated = async () => {
            const [{ data: images }, { data: audio }] = await Promise.all([
                supabase.from("images").select("id, prompt, storage_path, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
                supabase.from("audio").select("id, prompt, storage_path, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
            ]);

            const items: GeneratedItem[] = [
                ...(images || []).map(i => ({ ...i, type: "image" as const })),
                ...(audio || []).map(a => ({ ...a, type: "audio" as const })),
            ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

            setGeneratedItems(items);
        };

        const fetchDocuments = async () => {
            const { data } = await supabase
                .from("documents")
                .select("id, filename, storage_path, size, content_type, created_at")
                .eq("user_id", user.id)
                .order("created_at", { ascending: false });

            if (data) setDocuments(data);
        };

        const fetchCapabilities = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) return;
                const res = await fetch('/api/capabilities', {
                    headers: { Authorization: `Bearer ${session.access_token}` }
                });
                if (res.ok) setCapabilities(await res.json());
            } catch { }
        };

        fetchGenerated();
        fetchDocuments();
        fetchCapabilities();
    }, [user]);

    const handleDeleteGenerated = async (item: GeneratedItem) => {
        if (!user) return;

        await supabase.storage.from("library").remove([item.storage_path]);
        await supabase.from(item.type === "image" ? "images" : "audio").delete().eq("id", item.id);
        setGeneratedItems(prev => prev.filter(i => i.id !== item.id));

        // Mark as deleted in all image generation threads
        if (item.type === "image") {
            const apiPath = '/api/library/' + item.storage_path.split('/').slice(1).join('/');
            const fileName = item.storage_path.split('/').pop()!;
            const { data: threads } = await supabase
                .from('threads')
                .select('id, messages')
                .eq('user_id', user.id)
                .eq('session_type', 'image_generation');

            for (const thread of threads || []) {
                let changed = false;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const updatedMessages = (thread.messages || []).map((msg: any) => {
                    if (msg.role !== 'assistant') return msg;
                    const matchUrl = (url: string | undefined) => url && (url === apiPath || url.includes(apiPath) || url.includes(fileName));
                    if (matchUrl(msg.imageUrl)) {
                        changed = true;
                        return { ...msg, status: 'deleted', imageUrl: undefined };
                    }
                    if (msg.variations) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const newVariations = msg.variations.map((v: any) =>
                            matchUrl(v.imageUrl) ? { ...v, status: 'deleted', imageUrl: undefined } : v
                        );
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        if (newVariations.some((v: any, i: number) => v !== msg.variations[i])) {
                            changed = true;
                            return { ...msg, variations: newVariations };
                        }
                    }
                    return msg;
                });
                if (changed) {
                    await supabase.from('threads').update({ messages: updatedMessages }).eq('id', thread.id);
                }
            }
        }
    };

    const handleDeleteDocument = async (doc: DatabaseDocument) => {
        if (!user) return;

        await supabase.storage.from("library").remove([doc.storage_path]);
        await supabase.from("documents").delete().eq("id", doc.id);
        setDocuments(prev => prev.filter(d => d.id !== doc.id));
    };

    const handleToggleCapability = async (capId: string, currentEnabled: boolean) => {
        if (!user || togglingCap) return;
        setTogglingCap(capId);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;
            await fetch('/api/capabilities', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({ capability_id: capId, enabled: !currentEnabled }),
            });
            setCapabilities((prev) =>
                prev.map((c) => (c.id === capId ? { ...c, enabled: !currentEnabled } : c))
            );
        } finally {
            setTogglingCap(null);
        }
    };

    const getCapabilityIcon = (iconName: string, color: string) => {
        const colorMap: Record<string, string> = {
            emerald: "text-emerald-400 bg-emerald-500/10",
            blue: "text-blue-400 bg-blue-500/10",
            amber: "text-amber-400 bg-amber-500/10",
        };
        const cls = colorMap[color] || "text-white/50 bg-white/5";
        const iconMap: Record<string, React.ReactNode> = {
            TrendingUp: <TrendingUp size={18} strokeWidth={1.5} />,
            Newspaper: <Newspaper size={18} strokeWidth={1.5} />,
        };
        return (
            <div className={`w-10 h-10 flex items-center justify-center rounded-xl ${cls}`}>
                {iconMap[iconName] ?? <Zap size={18} strokeWidth={1.5} />}
            </div>
        );
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const getSignedUrl = (storage_path: string) => {
        if (signedUrls[storage_path]) return signedUrls[storage_path];
        return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    };

    const signedUrlsRef = useRef(signedUrls);
    signedUrlsRef.current = signedUrls;

    const resolveSignedUrl = useCallback(async (storage_path: string) => {
        if (signedUrlsRef.current[storage_path] || resolvingUrls.current.has(storage_path)) return;
        resolvingUrls.current.add(storage_path);

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) { resolvingUrls.current.delete(storage_path); return; }

            const relativePath = storage_path.split("/").slice(1).join("/");
            const res = await fetch(`/api/library/${relativePath}`, {
                headers: { "Authorization": `Bearer ${session.access_token}` }
            });

            if (res.ok) {
                const { signedUrl } = await res.json();
                setSignedUrls(prev => ({ ...prev, [storage_path]: signedUrl }));
            }
        } catch (err) {
            console.error("Failed to resolve signed URL:", err);
        } finally {
            resolvingUrls.current.delete(storage_path);
        }
    }, []);

    useEffect(() => {
        if (activeDataTab === "generated") {
            generatedItems.forEach(item => resolveSignedUrl(item.storage_path));
        }
    }, [generatedItems, activeDataTab, resolveSignedUrl]);

    const handleItemClick = (item: GeneratedItem) => {
        const url = getSignedUrl(item.storage_path);
        if (item.type === "image") {
            setViewerImage({ src: url, prompt: item.prompt });
            setImageViewerOpen(true);
        } else {
            setViewerAudio({ src: url, prompt: item.prompt });
            setAudioViewerOpen(true);
        }
    };

    return (
        <div className="flex-1 w-full h-full p-8 md:p-12 overflow-y-auto custom-scrollbar">
            <div className="max-w-7xl mx-auto flex flex-col h-full">

                {/* Header & Segments */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10 shrink-0">
                    <div>
                        <h2 className="text-3xl font-semibold text-white tracking-tight mb-2">Library</h2>
                        <p className="text-white/40 text-[15px]">Explore available capabilities or manage your data.</p>
                    </div>

                    <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 shrink-0">
                        <button
                            onClick={() => setActiveSection("explore")}
                            className={cn(
                                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                                activeSection === "explore" ? "bg-white/10 text-white shadow-sm" : "text-white/40 hover:text-white/70"
                            )}
                        >
                            Explore Modes
                        </button>
                        <button
                            onClick={() => setActiveSection("capabilities")}
                            className={cn(
                                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                                activeSection === "capabilities" ? "bg-white/10 text-white shadow-sm" : "text-white/40 hover:text-white/70"
                            )}
                        >
                            Capabilities
                        </button>
                        <button
                            onClick={() => setActiveSection("mydata")}
                            className={cn(
                                "px-6 py-2 rounded-lg text-sm font-medium transition-all",
                                activeSection === "mydata" ? "bg-white/10 text-white shadow-sm" : "text-white/40 hover:text-white/70"
                            )}
                        >
                            My Data
                        </button>
                    </div>
                </div>

                {activeSection === "explore" ? (
                    <ExploreModes />
                ) : activeSection === "capabilities" ? (
                    <CapabilitiesSection
                        user={user}
                        capabilities={capabilities}
                        togglingCap={togglingCap}
                        onToggle={handleToggleCapability}
                        getIcon={getCapabilityIcon}
                    />
                ) : (
                    <div className="flex flex-col flex-1">
                        <div className="flex items-center gap-6 border-b border-white/5 pb-0 mb-8 shrink-0">
                            <button
                                onClick={() => setActiveDataTab("generated")}
                                className={cn(
                                    "pb-3 text-sm font-medium transition-all relative flex items-center gap-2",
                                    activeDataTab === "generated" ? "text-white" : "text-white/40 hover:text-white/70"
                                )}
                            >
                                <Sparkles size={16} />
                                Generated Output
                                {activeDataTab === "generated" && (
                                    <motion.div layoutId="mydata-tab" className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-t-full" />
                                )}
                            </button>
                            <button
                                onClick={() => setActiveDataTab("documents")}
                                className={cn(
                                    "pb-3 text-sm font-medium transition-all relative flex items-center gap-2",
                                    activeDataTab === "documents" ? "text-white" : "text-white/40 hover:text-white/70"
                                )}
                            >
                                <Folder size={16} />
                                Documents Context
                                {activeDataTab === "documents" && (
                                    <motion.div layoutId="mydata-tab" className="absolute bottom-0 left-0 right-0 h-[2px] bg-white rounded-t-full" />
                                )}
                            </button>
                        </div>

                        {!user ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-2xl bg-white/[0.01]">
                                <HardDrive className="w-10 h-10 text-white/20 mb-4" strokeWidth={1.5} />
                                <h3 className="text-lg font-medium text-white mb-2">Login Required</h3>
                                <p className="text-white/40 text-[15px] max-w-sm mb-6">
                                    Please sign in to access the Library.
                                </p>
                            </div>
                        ) : activeDataTab === "generated" && generatedItems.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-2xl bg-white/[0.01]">
                                <Sparkles className="w-10 h-10 text-white/20 mb-4" strokeWidth={1.5} />
                                <h3 className="text-lg font-medium text-white mb-2">No generated content yet</h3>
                                <p className="text-white/40 text-[15px] max-w-sm">
                                    Images and audio you generate will automatically be saved and organized here.
                                </p>
                            </div>
                        ) : activeDataTab === "documents" && documents.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-2xl bg-white/[0.01]">
                                <FileText className="w-10 h-10 text-white/20 mb-4" strokeWidth={1.5} />
                                <h3 className="text-lg font-medium text-white mb-2">No documents yet</h3>
                                <p className="text-white/40 text-[15px] max-w-sm">
                                    Files and documents you upload into conversations will appear here.
                                </p>
                            </div>
                        ) : (
                            <div className="pb-10">
                                {activeDataTab === "documents" ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        <AnimatePresence mode="popLayout">
                                            {documents.map((doc) => (
                                                <motion.div
                                                    layout
                                                    initial={{ opacity: 0, scale: 0.95 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    key={doc.id}
                                                    className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 flex flex-col group hover:bg-white/[0.04] transition-colors"
                                                >
                                                    <div className="flex items-start justify-between mb-4">
                                                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/60">
                                                            <FileText size={20} strokeWidth={1.5} />
                                                        </div>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteDocument(doc); }}
                                                            className="text-white/20 hover:text-red-400 hover:bg-red-400/10 p-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                            title="Delete file"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                    <h4 className="text-[15px] font-medium text-white/90 truncate mb-1" title={doc.filename}>
                                                        {doc.filename}
                                                    </h4>
                                                    <div className="flex items-center justify-between text-[13px] text-white/40 mt-auto pt-2">
                                                        <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                                                        <span>{formatBytes(doc.size)}</span>
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </AnimatePresence>
                                    </div>
                                ) : (
                                    <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4">
                                        <AnimatePresence mode="popLayout">
                                            {generatedItems.map((item) => (
                                                <motion.div
                                                    layout
                                                    initial={{ opacity: 0, y: 20 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.9 }}
                                                    key={item.id}
                                                    className="break-inside-avoid relative group rounded-xl overflow-hidden cursor-zoom-in bg-white/5 border border-white/5 mb-4"
                                                    onClick={() => handleItemClick(item)}
                                                >
                                                    {item.type === "audio" ? (
                                                        <div className="w-full aspect-[4/3] bg-black/40 flex flex-col items-center justify-center p-6 border border-white/5 rounded-xl transition-colors group-hover:bg-black/60">
                                                            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-4 group-hover:scale-110 group-hover:bg-emerald-500 group-hover:text-white transition-all shadow-[0_0_15px_rgba(16,185,129,0.1)] group-hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]">
                                                                <Play size={24} className="ml-1" strokeWidth={2} />
                                                            </div>
                                                            <div className="w-full flex items-center justify-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                                                                {[...Array(5)].map((_, i) => (
                                                                    <div key={i} className={`w-1 bg-emerald-500/50 rounded-full animate-[pulse_1s_ease-in-out_${i * 0.2}s_infinite] h-${[3, 5, 3, 6, 4][i]}`} />
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        /* eslint-disable-next-line @next/next/no-img-element */
                                                        <img
                                                            src={getSignedUrl(item.storage_path)}
                                                            alt={item.prompt}
                                                            className="w-full h-auto block transform transition-transform duration-500 group-hover:scale-105"
                                                            loading="lazy"
                                                        />
                                                    )}
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between p-3">
                                                        <div className="flex justify-end">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteGenerated(item); }}
                                                                className="p-2 text-white/60 hover:text-red-400 hover:bg-red-400/20 rounded-lg backdrop-blur-md transition-all"
                                                                title="Delete item"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                        <div>
                                                            <p className="text-xs text-white/80 line-clamp-2 drop-shadow-md">
                                                                {item.type === "audio" ? "Audio Generation" : item.prompt}
                                                            </p>
                                                            <p className="text-[10px] text-white/50 mt-1">
                                                                {new Date(item.created_at).toLocaleDateString()}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </AnimatePresence>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <ImageViewer
                isOpen={imageViewerOpen}
                src={viewerImage?.src || null}
                prompt={viewerImage?.prompt}
                onClose={() => setImageViewerOpen(false)}
            />

            <AudioViewer
                isOpen={audioViewerOpen}
                src={viewerAudio?.src || null}
                prompt={viewerAudio?.prompt}
                onClose={() => setAudioViewerOpen(false)}
            />
        </div>
    );
}
