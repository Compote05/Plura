"use client";

import { useState, useEffect } from "react";
import { MessageSquare, Image as ImageIcon, Settings, LayoutGrid, Library, PanelLeftClose, User as UserIcon, MoreVertical, Edit2, Copy as CopyIcon, Trash2, AudioLines } from "lucide-react";
import { User } from "@supabase/supabase-js";
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

export default function Sidebar() {
    const {
        user,
        activeThreadId,
        setActiveThreadId: onThreadSelect,
        renamedThread,
        setIsAuthModalOpen,
        setIsSettingsModalOpen
    } = useAppContext();

    const openAuthModal = () => setIsAuthModalOpen(true);
    const openSettingsModal = () => setIsSettingsModalOpen(true);

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
    const [isProfileOpen, setIsProfileOpen] = useState(false);
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

        if (tab === "image") {
            query = query.eq('session_type', 'image_generation');
        } else if (tab === "tts") {
            query = query.eq('session_type', 'text_to_speech');
        } else if (tab === "chat") {
            query = query.eq('session_type', 'chat');
        }

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

    // Add new thread to list when activeThreadId changes to a real UUID not yet in the list
    useEffect(() => {
        if (!activeThreadId) return;
        const isRealUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeThreadId);
        const isInList = threads.some(t => t.id === activeThreadId);
        if (isRealUUID && !isInList) {
            mutate();
        }
    }, [activeThreadId, threads, mutate]);

    // Listen for auto-generated title updates from the ChatArea
    useEffect(() => {
        if (renamedThread) {
            mutate((prev) =>
                (prev || []).map(t =>
                    t.id === renamedThread.id ? { ...t, title: renamedThread.title } : t
                ),
                { revalidate: false }
            );
        }
    }, [renamedThread, mutate]);

    const handleRename = async (id: string, newTitle: string) => {
        if (!newTitle.trim() || !user) return;

        // Optimistic update
        mutate(
            (prev) => (prev || []).map(t => t.id === id ? { ...t, title: newTitle.trim() } : t),
            { revalidate: false }
        );

        await supabase.from('threads').update({ title: newTitle.trim() }).eq('id', id).eq('user_id', user.id);
        setEditingThreadId(null);
        mutate(); // Revalidate to ensure consistency
    };

    const handleClone = async (thread: Thread) => {
        if (!user) return;

        // Fetch full thread to clone messages and model
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
            mutate(
                (prev) => [{ id: newThread.id, title: newThread.title, created_at: newThread.created_at }, ...(prev || [])],
                { revalidate: false }
            );

            // Stay within the correct tab context
            if (fullThread.session_type === 'image_generation') {
                onTabChange("image");
            } else if (fullThread.session_type === 'text_to_speech') {
                onTabChange("tts");
            } else {
                onTabChange("chat");
            }
            onThreadSelect(newThread.id);
        }
    };

    const handleDelete = async (id: string) => {
        if (!user) return;

        // Optimistic update
        mutate(
            (prev) => (prev || []).filter(t => t.id !== id),
            { revalidate: false }
        );

        await supabase.from('threads').delete().eq('id', id).eq('user_id', user.id);
        if (activeThreadId === id) {
            onThreadSelect(null);
        }
        mutate(); // Revalidate after deletion
    };


    return (
        <aside
            className={cn(
                "h-full flex flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground py-4 shrink-0 transition-all duration-300 ease-in-out relative z-20 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.5)]",
                isCollapsed ? "w-[72px]" : "w-[260px]"
            )}
        >
            {/* Header */}
            < div className={cn("flex items-center mb-6 mt-1", isCollapsed ? "justify-center px-0" : "px-4 gap-3")} >
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground shrink-0 border border-white/5">
                    <LayoutGrid size={18} />
                </div>
                {!isCollapsed && <h1 className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">AI.HUB</h1>}
            </ div>

            {/* Navigation */}
            <div className="flex flex-col gap-1 px-3">
                {!isCollapsed && <p className="px-3 text-[11px] font-bold text-white/30 mb-2 tracking-[0.15em] uppercase">Modes</p>}

                {[
                    { tab: "chat" as const, label: "Chat", icon: MessageSquare, check: activeTab === "chat" && activeThreadId === null },
                    { tab: "image" as const, label: "Image Generation", icon: ImageIcon, check: activeTab === "image" && activeThreadId === null },
                    { tab: "tts" as const, label: "Audio Studio", icon: AudioLines, check: activeTab === "tts" && activeThreadId === null },
                    { tab: "library" as const, label: "Library", icon: Library, check: activeTab === "library" },
                ].map(({ tab, label, icon: Icon, check }) => (
                    <button
                        key={tab}
                        onClick={() => { onTabChange(tab); if (tab !== "library") onThreadSelect(null); }}
                        title={label}
                        className={cn(
                            "flex items-center gap-3 transition-colors duration-150 relative",
                            isCollapsed ? "justify-center p-2.5 rounded-lg" : "px-3 py-2 rounded-lg w-full",
                            check
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                        )}
                    >
                        {check && !isCollapsed && (
                            <div className="absolute left-[2px] top-1/2 -translate-y-1/2 w-[3px] h-[55%] bg-primary rounded-full" />
                        )}
                        <Icon size={isCollapsed ? 20 : 15} />
                        {!isCollapsed && <span className="text-sm font-medium">{label}</span>}
                    </button>
                ))}
            </div>

            {/* History Area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden pt-2 px-3 custom-scrollbar">
                {!isCollapsed && (
                    <div className="flex flex-col gap-[1px]">
                        <div className="flex items-center justify-between px-2 mb-1 mt-1">
                            <p className="text-[10px] font-bold text-white/30 tracking-[0.16em] uppercase">
                                {activeTab === 'chat' && "Chat History"}
                                {activeTab === 'image' && "Image History"}
                                {activeTab === 'tts' && "Audio History"}
                                {activeTab === 'library' && "History"}
                            </p>
                        </div>
                        {threads.map((thread) => (
                            <div
                                key={thread.id}
                                className={cn(
                                    "relative group px-3 py-1 rounded-md text-[13px] transition-colors cursor-pointer flex items-center justify-between mx-1",
                                    (activeThreadId === thread.id)
                                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                                        : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
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
                                        className="bg-transparent border-none outline-none w-full text-white"
                                    />
                                ) : (
                                    <div
                                        className="truncate w-full pr-2"
                                        onClick={() => onThreadSelect(thread.id)}
                                    >
                                        <span className="truncate">{thread.title}</span>
                                    </div>
                                )}

                                {/* Hover Actions Menu */}
                                {editingThreadId !== thread.id && activeTab !== "library" && (
                                    <div className="flex-shrink-0 relative">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenMenuId(openMenuId === thread.id ? null : thread.id);
                                            }}
                                            className={cn(
                                                "p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-opacity",
                                                openMenuId === thread.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                            )}
                                        >
                                            <MoreVertical size={13} />
                                        </button>

                                        <AnimatePresence>
                                            {openMenuId === thread.id && (
                                                <>
                                                    <div
                                                        className="fixed inset-0 z-40"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId(null);
                                                        }}
                                                    />
                                                    <motion.div
                                                        initial={{ opacity: 0, scale: 0.95, y: -5 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.95, y: -5 }}
                                                        className="absolute right-0 top-full mt-1 w-36 bg-[#1e1d1c] border border-[#2a2927] rounded-lg shadow-[0_8px_30px_rgb(0,0,0,0.6)] z-50 overflow-hidden py-1"
                                                    >
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingThreadId(thread.id);
                                                                setEditTitle(thread.title);
                                                                setOpenMenuId(null);
                                                            }}
                                                            className="w-full text-left px-3 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/5 flex items-center gap-2"
                                                        >
                                                            <Edit2 size={12} /> Rename
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleClone(thread);
                                                                setOpenMenuId(null);
                                                            }}
                                                            className="w-full text-left px-3 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/5 flex items-center gap-2"
                                                        >
                                                            <CopyIcon size={12} /> Clone
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDelete(thread.id);
                                                                setOpenMenuId(null);
                                                            }}
                                                            className="w-full text-left px-3 py-1.5 text-xs text-red-500/70 hover:text-red-500 hover:bg-red-500/10 flex items-center gap-2"
                                                        >
                                                            <Trash2 size={12} /> Delete
                                                        </button>
                                                    </motion.div>
                                                </>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer Items */}
            <div className="mt-auto px-3 pb-4 flex flex-col gap-2 relative">
                <AnimatePresence>
                    {isProfileOpen && !isCollapsed && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute bottom-full left-3 right-3 mb-2 bg-popover border border-border rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.5)] z-50 overflow-hidden"
                        >
                            {user ? (
                                <button
                                    onClick={openSettingsModal}
                                    className="flex items-center gap-3 w-full p-3 text-sm font-medium text-popover-foreground/70 hover:text-popover-foreground hover:bg-accent transition-colors"
                                >
                                    <Settings size={16} />
                                    Settings
                                </button>
                            ) : (
                                <button
                                    onClick={openAuthModal}
                                    className="flex items-center gap-3 w-full p-3 text-sm font-medium text-popover-foreground/70 hover:text-popover-foreground hover:bg-accent transition-colors"
                                >
                                    <UserIcon size={16} />
                                    Sign In / Register
                                </button>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className={cn(
                    "flex items-center",
                    isCollapsed ? "flex-col gap-4" : "justify-between"
                )}>
                    <button
                        onClick={() => {
                            if (isCollapsed) {
                                setIsCollapsed(false);
                            } else {
                                setIsProfileOpen(!isProfileOpen);
                            }
                        }}
                        className={cn(
                            "flex items-center transition-all p-1.5 rounded-lg hover:bg-sidebar-accent overflow-hidden mx-1",
                            !isCollapsed && "flex-1"
                        )}
                    >
                        <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border border-white/5",
                            user ? "bg-primary" : "bg-sidebar-accent"
                        )}>
                            <UserIcon size={16} className="text-primary-foreground" />
                        </div>
                        {!isCollapsed && (
                            <p className="ml-3 text-sm font-medium text-white whitespace-nowrap overflow-hidden">
                                {user
                                    ? (user.user_metadata?.full_name || user.email?.split('@')[0] || "User")
                                    : "Sign in"}
                            </p>
                        )}
                    </button>

                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className="p-1.5 text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-lg transition-colors shrink-0 mr-1"
                    >
                        <motion.div animate={{ rotate: isCollapsed ? 180 : 0 }} transition={{ duration: 0.3 }}>
                            <PanelLeftClose size={16} />
                        </motion.div>
                    </button>
                </div>
            </div>
        </aside>
    );
}
