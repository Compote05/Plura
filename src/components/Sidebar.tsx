"use client";

import { useState, useEffect } from "react";
import { MessageSquare, Image as ImageIcon, Library, PanelLeftClose, User as UserIcon, MoreHorizontal, Edit2, Copy as CopyIcon, Trash2, AudioLines, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/context/AppContext";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";

interface Thread {
    id: string;
    title: string;
    created_at: string;
}

const NAV_ITEMS = [
    { tab: "chat" as const, label: "Chat", icon: MessageSquare },
    { tab: "image" as const, label: "Image", icon: ImageIcon },
    { tab: "tts" as const, label: "Audio", icon: AudioLines },
    { tab: "library" as const, label: "Library", icon: Library },
];

export default function Sidebar() {
    const {
        user,
        activeThreadId,
        setActiveThreadId: onThreadSelect,
        renamedThread,
        setIsAuthModalOpen,
        setIsSettingsModalOpen
    } = useAppContext();

    const pathname = usePathname();
    const router = useRouter();

    let activeTab: "chat" | "image" | "library" | "tts" = "chat";
    if (pathname.includes("/generate")) activeTab = "image";
    else if (pathname.includes("/library")) activeTab = "library";
    else if (pathname.includes("/tts")) activeTab = "tts";

    const onTabChange = (tab: "chat" | "image" | "library" | "tts") => {
        if (tab === "chat") router.push("/chat");
        if (tab === "image") router.push("/generate");
        if (tab === "library") router.push("/library");
        if (tab === "tts") router.push("/tts");
    };

    const [isCollapsed, setIsCollapsed] = useState(false);
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState("");

    const fetcher = async ([_, userId, tab]: [string, string, string]) => {
        if (tab === "library") {
            const { data, error } = await supabase
                .from('documents')
                .select('id, filename, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []).map(d => ({ id: d.id, title: d.filename, created_at: d.created_at })) as Thread[];
        }

        let query = supabase
            .from('threads')
            .select('id, title, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (tab === "image") query = query.eq('session_type', 'image_generation');
        else if (tab === "tts") query = query.eq('session_type', 'text_to_speech');
        else if (tab === "chat") query = query.eq('session_type', 'chat');

        const { data, error } = await query;
        if (error) throw error;
        return data as Thread[];
    };

    const { data: threadsData, mutate } = useSWR(
        user ? ['threads', user.id, activeTab] : null,
        fetcher,
        { fallbackData: [] }
    );

    const threads = threadsData || [];

    useEffect(() => {
        if (!activeThreadId) return;
        const isRealUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeThreadId);
        const isInList = threads.some(t => t.id === activeThreadId);
        if (isRealUUID && !isInList) mutate();
    }, [activeThreadId, threads, mutate]);

    useEffect(() => {
        if (renamedThread) {
            mutate(
                (prev) => (prev || []).map(t => t.id === renamedThread.id ? { ...t, title: renamedThread.title } : t),
                { revalidate: false }
            );
        }
    }, [renamedThread, mutate]);

    const handleRename = async (id: string, newTitle: string) => {
        if (!newTitle.trim() || !user) return;
        mutate((prev) => (prev || []).map(t => t.id === id ? { ...t, title: newTitle.trim() } : t), { revalidate: false });
        await supabase.from('threads').update({ title: newTitle.trim() }).eq('id', id).eq('user_id', user.id);
        setEditingThreadId(null);
        mutate();
    };

    const handleClone = async (thread: Thread) => {
        if (!user) return;
        const { data: fullThread } = await supabase.from('threads').select('*').eq('id', thread.id).single();
        if (!fullThread) return;
        const { data: newThread } = await supabase.from('threads').insert([{
            user_id: user.id,
            title: `${fullThread.title} (Copy)`,
            session_type: fullThread.session_type,
            model: fullThread.model,
            messages: fullThread.messages
        }]).select().single();
        if (newThread) {
            mutate((prev) => [{ id: newThread.id, title: newThread.title, created_at: newThread.created_at }, ...(prev || [])], { revalidate: false });
            if (fullThread.session_type === 'image_generation') onTabChange("image");
            else if (fullThread.session_type === 'text_to_speech') onTabChange("tts");
            else onTabChange("chat");
            onThreadSelect(newThread.id);
        }
    };

    const handleDelete = async (id: string) => {
        if (!user) return;
        mutate((prev) => (prev || []).filter(t => t.id !== id), { revalidate: false });
        await supabase.from('threads').delete().eq('id', id).eq('user_id', user.id);
        if (activeThreadId === id) onThreadSelect(null);
        mutate();
    };

    const displayName = user
        ? (user.user_metadata?.full_name || user.email?.split('@')[0] || "User")
        : "Sign in";

    return (
        <aside className={cn(
            "h-full flex flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground shrink-0 transition-all duration-300 ease-in-out relative z-20",
            isCollapsed ? "w-[56px]" : "w-[240px]"
        )}>

            {/* Header */}
            <div className={cn(
                "flex items-center h-14 border-b border-sidebar-border px-3 gap-2 shrink-0",
                isCollapsed ? "justify-center" : "justify-between"
            )}>
                {!isCollapsed && (
                    <span className="text-sm font-semibold text-sidebar-foreground tracking-tight select-none">AI.HUB</span>
                )}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="p-1.5 rounded-md text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors shrink-0"
                >
                    <motion.div animate={{ rotate: isCollapsed ? 180 : 0 }} transition={{ duration: 0.25 }}>
                        <PanelLeftClose size={15} />
                    </motion.div>
                </button>
            </div>

            {/* Navigation */}
            <div className={cn("flex flex-col gap-0.5 p-2 border-b border-sidebar-border shrink-0")}>
                {NAV_ITEMS.map(({ tab, label, icon: Icon }) => {
                    const isActive = tab === "library" ? activeTab === "library" : activeTab === tab && activeThreadId === null;
                    return (
                        <button
                            key={tab}
                            onClick={() => { onTabChange(tab); if (tab !== "library") onThreadSelect(null); }}
                            title={isCollapsed ? label : undefined}
                            className={cn(
                                "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors duration-100 w-full",
                                isCollapsed && "justify-center",
                                isActive
                                    ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                                    : "text-sidebar-foreground/45 hover:text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
                            )}
                        >
                            <Icon size={14} strokeWidth={isActive ? 2.2 : 1.8} />
                            {!isCollapsed && <span>{label}</span>}
                        </button>
                    );
                })}
            </div>

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 custom-scrollbar">
                {!isCollapsed && activeTab !== "library" && (
                    <p className="px-2.5 pt-2 pb-1 text-[10px] font-medium text-sidebar-foreground/25 uppercase tracking-widest">Recent</p>
                )}
                {!isCollapsed && threads.map((thread) => (
                    <div
                        key={thread.id}
                        className={cn(
                            "group relative flex items-center rounded-md text-[13px] cursor-pointer transition-colors duration-100 my-0.5",
                            activeThreadId === thread.id
                                ? "bg-sidebar-accent text-sidebar-foreground"
                                : "text-sidebar-foreground/45 hover:text-sidebar-foreground/80 hover:bg-sidebar-accent/40"
                        )}
                    >
                        {editingThreadId === thread.id ? (
                            <input
                                autoFocus
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onBlur={() => handleRename(thread.id, editTitle)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRename(thread.id, editTitle);
                                    if (e.key === 'Escape') setEditingThreadId(null);
                                }}
                                className="bg-transparent border-none outline-none w-full px-2.5 py-1.5 text-sidebar-foreground"
                            />
                        ) : (
                            <div
                                className="flex-1 truncate px-2.5 py-1.5 pr-1"
                                onClick={() => onThreadSelect(thread.id)}
                            >
                                {thread.title}
                            </div>
                        )}

                        {editingThreadId !== thread.id && activeTab !== "library" && (
                            <div className="shrink-0 pr-1">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuId(openMenuId === thread.id ? null : thread.id);
                                    }}
                                    className={cn(
                                        "p-1 rounded text-sidebar-foreground/30 hover:text-sidebar-foreground transition-opacity",
                                        openMenuId === thread.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                    )}
                                >
                                    <MoreHorizontal size={13} />
                                </button>

                                <AnimatePresence>
                                    {openMenuId === thread.id && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); }} />
                                            <motion.div
                                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                                transition={{ duration: 0.1 }}
                                                className="absolute right-0 top-full mt-1 w-32 bg-[#1e1d1c] border border-[#2a2927] rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.5)] z-50 overflow-hidden py-1"
                                            >
                                                {[
                                                    { label: "Rename", icon: Edit2, action: () => { setEditingThreadId(thread.id); setEditTitle(thread.title); setOpenMenuId(null); }, danger: false },
                                                    { label: "Clone", icon: CopyIcon, action: () => { handleClone(thread); setOpenMenuId(null); }, danger: false },
                                                    { label: "Delete", icon: Trash2, action: () => { handleDelete(thread.id); setOpenMenuId(null); }, danger: true },
                                                ].map(({ label, icon: Icon, action, danger }) => (
                                                    <button
                                                        key={label}
                                                        onClick={(e) => { e.stopPropagation(); action(); }}
                                                        className={cn(
                                                            "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                                                            danger
                                                                ? "text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
                                                                : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-white/5"
                                                        )}
                                                    >
                                                        <Icon size={11} /> {label}
                                                    </button>
                                                ))}
                                            </motion.div>
                                        </>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className={cn(
                "shrink-0 border-t border-sidebar-border p-2 flex items-center gap-2",
                isCollapsed ? "justify-center flex-col" : "justify-between"
            )}>
                <button
                    onClick={() => user ? setIsSettingsModalOpen(true) : setIsAuthModalOpen(true)}
                    className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent min-w-0",
                        !isCollapsed && "flex-1"
                    )}
                    title={isCollapsed ? displayName : undefined}
                >
                    <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold",
                        user ? "bg-sidebar-foreground/15 text-sidebar-foreground" : "bg-sidebar-accent text-sidebar-foreground/40"
                    )}>
                        {user ? displayName[0].toUpperCase() : <UserIcon size={12} />}
                    </div>
                    {!isCollapsed && (
                        <span className="text-xs text-sidebar-foreground/60 truncate">{displayName}</span>
                    )}
                </button>

                {!isCollapsed && (
                    <button
                        onClick={() => user ? setIsSettingsModalOpen(true) : setIsAuthModalOpen(true)}
                        className="p-1.5 rounded-md text-sidebar-foreground/30 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent transition-colors shrink-0"
                    >
                        <Settings size={14} />
                    </button>
                )}
            </div>
        </aside>
    );
}
