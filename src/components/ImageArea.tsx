"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowUp, Square, ChevronDown, Layers, RectangleHorizontal, RectangleVertical, Info, RotateCw, ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/context/AppContext";
import ImageViewer from "./ImageViewer";

interface MessageVariation {
    status?: "generating" | "done" | "error";
    imageUrl?: string;
    metadata?: {
        model: string;
        seed: number | string;
        aspectRatio: string;
        steps: number;
        time: number;
    };
}

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    status?: "generating" | "done" | "error";
    imageUrl?: string;
    metadata?: MessageVariation['metadata'];
    variations?: MessageVariation[];
    currentVariationIndex?: number;
}

export default function ImageArea({ user }: { user: User | null }) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [prompt, setPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [useAdvanced, setUseAdvanced] = useState(false);

    const DEFAULT_SETTINGS = { steps: 8, seed: -1, sampler: "res_multistep", cfgScale: 1.0, width: 1024, height: 1024 };
    const [aspectRatio, setAspectRatio] = useState<"square" | "landscape" | "vertical">("square");
    const [advancedSettings, setAdvancedSettings] = useState({
        steps: 8,
        seed: -1,
        sampler: "res_multistep",
        cfgScale: 1.0,
        width: 1024,
        height: 1024,
    });

    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerImage, setViewerImage] = useState<{ src: string; prompt: string } | null>(null);

    const { activeThreadId: currentThreadId, setActiveThreadId: setCurrentThreadId, lastUsedMode, setLastUsedMode } = useAppContext();
    const skipNextFetchRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
        }
    }, [prompt]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (prompt.trim() && !isGenerating) handleGenerate();
        }
    };

    useEffect(() => {
        if (!currentThreadId) { setMessages([]); setHighlightId(null); return; }
        if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }

        const fetchMessages = async () => {
            const { data } = await supabase.from('threads').select('messages').eq('id', currentThreadId).single();
            if (data?.messages) {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;
                const resolveUrl = async (url: string | undefined): Promise<string | undefined> => {
                    if (!url?.startsWith('/api/library/')) return url;
                    try {
                        const res = await fetch(url, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
                        if (res.ok) { const { signedUrl } = await res.json(); return signedUrl; }
                    } catch { }
                    return url;
                };
                const mapped = await Promise.all((data.messages as Message[]).map(async (msg) => ({
                    ...msg,
                    imageUrl: await resolveUrl(msg.imageUrl),
                    variations: msg.variations ? await Promise.all(msg.variations.map(async (v) => ({ ...v, imageUrl: await resolveUrl(v.imageUrl) }))) : undefined
                })));
                setMessages(mapped);
                const lastAssistant = mapped.filter(m => m.role === "assistant").at(-1);
                if (lastAssistant) {
                    setHighlightId(lastAssistant.id);
                    setTimeout(() => itemRefs.current[lastAssistant.id]?.scrollIntoView({ behavior: "instant", block: "center" }), 50);
                }
            } else {
                setMessages([]);
            }
        };
        fetchMessages();
    }, [currentThreadId]);

    const createNewThread = async (firstPrompt: string, initialMessages: Message[]) => {
        if (!user) return null;
        const title = firstPrompt.slice(0, 30) + (firstPrompt.length > 30 ? "..." : "");
        const { data } = await supabase.from('threads').insert([{
            user_id: user.id, title, session_type: 'image_generation', model: 'image-generation', messages: initialMessages
        }]).select().single();
        if (data) { skipNextFetchRef.current = true; setCurrentThreadId(data.id); return data.id; }
        return null;
    };

    const handleUpdateThreadMessages = async (threadId: string, updatedMessages: Message[]) => {
        if (!user) return;
        await supabase.from('threads').update({ messages: updatedMessages }).eq('id', threadId).eq('user_id', user.id);
    };

    const handleGenerate = async (e?: React.FormEvent, msgIdToRegenerate?: string, overridePrompt?: string) => {
        if (e) e.preventDefault();
        const currentPrompt = overridePrompt || prompt;
        if (!currentPrompt.trim() || isGenerating) return;
        if (!msgIdToRegenerate) setPrompt("");
        setIsGenerating(true);

        if (lastUsedMode === "chat") {
            const { data: { session } } = await supabase.auth.getSession();
            fetch("/api/vram/clear", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {}) },
                body: JSON.stringify({ target: "ollama" })
            }).catch(() => { });
        }
        setLastUsedMode("image_generation");

        const reqSeed = advancedSettings.seed === -1 ? Math.floor(Math.random() * 1000000000) : advancedSettings.seed;

        let newMessagesState: Message[];
        let asstMsgId: string;

        if (msgIdToRegenerate) {
            asstMsgId = msgIdToRegenerate;
            newMessagesState = messages.map(msg => {
                if (msg.id !== msgIdToRegenerate) return msg;
                const baseVariation: MessageVariation = { status: msg.status, imageUrl: msg.imageUrl, metadata: msg.metadata };
                const variations = msg.variations || [baseVariation];
                return { ...msg, status: "generating", variations: [...variations, { status: "generating" }], currentVariationIndex: variations.length };
            });
        } else {
            const userMsgId = Date.now().toString();
            asstMsgId = (Date.now() + 1).toString();
            newMessagesState = [
                ...messages,
                { id: userMsgId, role: "user", content: currentPrompt },
                { id: asstMsgId, role: "assistant", content: currentPrompt, status: "generating" }
            ];
        }

        setMessages(newMessagesState);
        setHighlightId(asstMsgId);
        setTimeout(() => itemRefs.current[asstMsgId]?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);

        let activeThreadId = currentThreadId;
        if (!activeThreadId) activeThreadId = await createNewThread(currentPrompt, newMessagesState);
        else await handleUpdateThreadMessages(activeThreadId, newMessagesState);

        const startTime = Date.now();

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const res = await fetch('/api/imgen/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({
                    prompt: currentPrompt,
                    aspectRatio,
                    ...(useAdvanced ? {
                        steps: advancedSettings.steps,
                        seed: reqSeed,
                        sampler: advancedSettings.sampler,
                        cfgScale: advancedSettings.cfgScale,
                            width: advancedSettings.width,
                        height: advancedSettings.height,
                    } : {})
                })
            });
            if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed"); }
            const { prompt_id } = await res.json();

            let isDone = false;
            let finalImageUrl = "";
            while (!isDone) {
                await new Promise(r => setTimeout(r, 2000));
                const s = await fetch(`/api/imgen/status?prompt_id=${prompt_id}`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
                const sd = await s.json();
                if (sd.status === 'done') { finalImageUrl = sd.imageUrl; isDone = true; }
                else if (sd.status === 'error') throw new Error(sd.error || "Generation error");
            }

            const metadata = { model: "Flux.1", seed: reqSeed, aspectRatio, steps: advancedSettings.steps, time: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)) };

            let messagesAfterGen = newMessagesState.map((msg): Message => {
                if (msg.id !== asstMsgId) return msg;
                if (msg.variations) {
                    const nv = [...msg.variations];
                    nv[msg.currentVariationIndex ?? 0] = { status: "done", imageUrl: finalImageUrl, metadata };
                    return { ...msg, status: "done", imageUrl: finalImageUrl, metadata, variations: nv };
                }
                return { ...msg, status: "done", imageUrl: finalImageUrl, metadata };
            });
            setMessages(messagesAfterGen);

            if (activeThreadId && user && finalImageUrl) {
                try {
                    const saveRes = await fetch('/api/imgen/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                        body: JSON.stringify({ imageUrl: finalImageUrl, prompt: currentPrompt, metadata })
                    });
                    if (saveRes.ok) {
                        const saveData = await saveRes.json();
                        if (saveData.permanentUrl) {
                            let displayUrl = finalImageUrl;
                            try {
                                const sr = await fetch(saveData.permanentUrl, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
                                if (sr.ok) { const { signedUrl } = await sr.json(); displayUrl = signedUrl; }
                            } catch { }
                            const permanentUrl = saveData.permanentUrl;
                            setMessages(messagesAfterGen.map((msg): Message => {
                                if (msg.id !== asstMsgId) return msg;
                                if (msg.variations) { const nv = [...msg.variations]; nv[msg.currentVariationIndex ?? 0] = { ...nv[msg.currentVariationIndex ?? 0], imageUrl: displayUrl }; return { ...msg, imageUrl: displayUrl, variations: nv }; }
                                return { ...msg, imageUrl: displayUrl };
                            }));
                            messagesAfterGen = messagesAfterGen.map((msg): Message => {
                                if (msg.id !== asstMsgId) return msg;
                                if (msg.variations) { const nv = [...msg.variations]; nv[msg.currentVariationIndex ?? 0] = { ...nv[msg.currentVariationIndex ?? 0], imageUrl: permanentUrl }; return { ...msg, imageUrl: permanentUrl, variations: nv }; }
                                return { ...msg, imageUrl: permanentUrl };
                            });
                        }
                    }
                } catch {
                    messagesAfterGen = messagesAfterGen.map((msg): Message => {
                        if (msg.id !== asstMsgId) return msg;
                        const nv = msg.variations?.map((v, i) => i === (msg.currentVariationIndex ?? 0) ? { ...v, status: "error" as const, imageUrl: undefined } : v);
                        return { ...msg, status: "error", imageUrl: undefined, ...(nv && { variations: nv }) };
                    });
                    setMessages(messagesAfterGen);
                }
                if (activeThreadId) await handleUpdateThreadMessages(activeThreadId, messagesAfterGen);
            }

            setIsGenerating(false);
        } catch (error) {
            console.error("Generation failed:", error);
            setMessages(newMessagesState.map((msg): Message => {
                if (msg.id !== asstMsgId) return msg;
                if (msg.variations) { const nv = [...msg.variations]; nv[msg.currentVariationIndex ?? 0] = { ...nv[msg.currentVariationIndex ?? 0], status: "error" }; return { ...msg, status: "error", variations: nv }; }
                return { ...msg, status: "error", content: "Failed to generate." };
            }));
            setIsGenerating(false);
        }
    };

    const feedRef = useRef<HTMLDivElement>(null);

    // Sync filmstrip highlight with scroll position
    useEffect(() => {
        const feed = feedRef.current;
        if (!feed) return;
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
                if (visible.length > 0) setHighlightId(visible[0].target.getAttribute('data-id'));
            },
            { root: feed, threshold: 0.5 }
        );
        Object.entries(itemRefs.current).forEach(([, el]) => { if (el) observer.observe(el); });
        return () => observer.disconnect();
    }, [messages]);

    const assistantMessages = messages.filter(m => m.role === "assistant");

    return (
        <div className="h-full w-full flex flex-col overflow-hidden">

            {/* Main area: feed + right filmstrip */}
            <div className="flex-1 flex overflow-hidden min-h-0">

                {/* Feed */}
                <div ref={feedRef} className="flex-1 overflow-y-auto custom-scrollbar">
                    {assistantMessages.length === 0 ? (
                        <div className="h-full flex items-center justify-center">
                            <p className="text-sm text-foreground/25">Describe what you want to generate</p>
                        </div>
                    ) : (
                        <div className="py-6 pb-8 px-6 flex flex-col gap-6 max-w-sm mx-auto">
                            {assistantMessages.map((msg) => {
                                const userMsg = messages[messages.indexOf(msg) - 1];
                                const entryPrompt = userMsg?.content ?? msg.content;
                                const variations = msg.variations || [{ status: msg.status, imageUrl: msg.imageUrl, metadata: msg.metadata }];
                                const currentVarIndex = msg.currentVariationIndex ?? 0;
                                const currentVar = variations[currentVarIndex] || variations[0];
                                const isHighlighted = msg.id === highlightId;

                                const handlePrevVar = () => setMessages(prev => prev.map(m =>
                                    m.id === msg.id && m.variations ? { ...m, currentVariationIndex: Math.max(0, (m.currentVariationIndex ?? 0) - 1) } : m
                                ));
                                const handleNextVar = () => setMessages(prev => prev.map(m =>
                                    m.id === msg.id && m.variations ? { ...m, currentVariationIndex: Math.min(m.variations.length - 1, (m.currentVariationIndex ?? 0) + 1) } : m
                                ));

                                return (
                                    <div
                                        key={msg.id}
                                        ref={el => { itemRefs.current[msg.id] = el; }}
                                        data-id={msg.id}
                                        className={cn("flex flex-col gap-2 transition-opacity duration-300", isHighlighted ? "opacity-100" : "opacity-70 hover:opacity-100")}
                                        onClick={() => setHighlightId(msg.id)}
                                    >
                                        {/* Prompt */}
                                        <p className="text-xs text-foreground/45 leading-relaxed">{entryPrompt}</p>

                                        {/* Image */}
                                        <div className="rounded-xl overflow-hidden border border-border bg-card">
                                            {currentVar.status === "generating" && (
                                                <div className={cn(
                                                    "w-full bg-foreground/[0.02] flex items-center justify-center gap-2",
                                                    aspectRatio === "landscape" ? "aspect-video" : aspectRatio === "vertical" ? "aspect-[9/16]" : "aspect-square"
                                                )}>
                                                    <div className="w-4 h-4 rounded-full border border-foreground/20 border-t-foreground/50 animate-spin" />
                                                    <span className="text-xs text-foreground/25">Generating</span>
                                                </div>
                                            )}
                                            {currentVar.status === "error" && (
                                                <div className="aspect-square flex items-center justify-center">
                                                    <span className="text-xs text-red-400/50">Failed</span>
                                                </div>
                                            )}
                                            {currentVar.status === "done" && currentVar.imageUrl && (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={currentVar.imageUrl}
                                                    alt={entryPrompt}
                                                    className="w-full h-auto block cursor-zoom-in"
                                                    onClick={(e) => { e.stopPropagation(); setViewerImage({ src: currentVar.imageUrl!, prompt: entryPrompt }); setViewerOpen(true); }}
                                                />
                                            )}
                                        </div>

                                        {/* Actions */}
                                        {currentVar.status !== "generating" && (
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleGenerate(undefined, msg.id, entryPrompt); }}
                                                        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-foreground/35 hover:text-foreground/65 hover:bg-accent transition-colors"
                                                    >
                                                        <RotateCw size={11} /> Retry
                                                    </button>
                                                    {currentVar.metadata && (
                                                        <div className="relative group/info">
                                                            <button className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-foreground/35 hover:text-foreground/65 hover:bg-accent transition-colors">
                                                                <Info size={11} /> {currentVar.metadata.time}s
                                                            </button>
                                                            <div className="absolute left-0 bottom-full mb-1.5 bg-card border border-border rounded-lg px-3 py-2 shadow-xl opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all whitespace-nowrap z-20 pointer-events-none">
                                                                <div className="flex flex-col gap-0.5 text-[11px] text-foreground/50 font-mono">
                                                                    <span>Model <span className="text-foreground/75 ml-2">{currentVar.metadata.model}</span></span>
                                                                    <span>Steps <span className="text-foreground/75 ml-2">{currentVar.metadata.steps}</span></span>
                                                                    <span>Seed <span className="text-foreground/75 ml-2">{currentVar.metadata.seed}</span></span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {variations.length > 1 && (
                                                    <div className="flex items-center gap-0.5">
                                                        <button onClick={(e) => { e.stopPropagation(); handlePrevVar(); }} disabled={currentVarIndex === 0} className="p-1 text-foreground/30 hover:text-foreground/65 disabled:opacity-20 transition-colors">
                                                            <ChevronLeft size={13} />
                                                        </button>
                                                        <span className="text-[11px] text-foreground/30 select-none tabular-nums">{currentVarIndex + 1}/{variations.length}</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleNextVar(); }} disabled={currentVarIndex === variations.length - 1} className="p-1 text-foreground/30 hover:text-foreground/65 disabled:opacity-20 transition-colors">
                                                            <ChevronRight size={13} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Filmstrip — right vertical strip */}
                {assistantMessages.length > 0 && (
                    <div className="w-[72px] border-l border-border overflow-y-auto custom-scrollbar flex flex-col gap-2 p-2 shrink-0">
                        {assistantMessages.map((msg) => {
                            const v = msg.variations ? (msg.variations[msg.currentVariationIndex ?? 0] ?? msg.variations[0]) : { status: msg.status, imageUrl: msg.imageUrl };
                            const isActive = msg.id === highlightId;
                            return (
                                <button
                                    key={msg.id}
                                    onClick={() => {
                                        setHighlightId(msg.id);
                                        itemRefs.current[msg.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
                                    }}
                                    className={cn(
                                        "w-full aspect-square rounded-lg overflow-hidden border-2 shrink-0 transition-all duration-150",
                                        isActive ? "border-foreground/50" : "border-transparent opacity-40 hover:opacity-70"
                                    )}
                                >
                                    {v.status === "done" && v.imageUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={v.imageUrl} alt="" className="w-full h-full object-cover" />
                                    ) : v.status === "generating" ? (
                                        <div className="w-full h-full bg-foreground/5 flex items-center justify-center">
                                            <div className="w-3 h-3 rounded-full border border-foreground/30 border-t-foreground/60 animate-spin" />
                                        </div>
                                    ) : (
                                        <div className="w-full h-full bg-foreground/5 flex items-center justify-center">
                                            <ImageIcon size={12} className="text-foreground/20" />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Input bar */}
            <div className="shrink-0 pb-6">
                <div className="max-w-3xl mx-auto flex flex-col gap-2">
                    <AnimatePresence>
                        {showAdvanced && (
                            <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 4 }}
                                transition={{ duration: 0.12 }}
                                className="bg-card border border-border rounded-xl p-3 flex flex-col gap-3"
                            >
                                {/* Header: toggle + reset */}
                                <div className="flex items-center justify-between">
                                    <button type="button" onClick={() => setUseAdvanced(v => !v)}
                                        className="flex items-center gap-2 text-xs text-foreground/50 hover:text-foreground/80 transition-colors">
                                        <div className={cn("w-7 h-4 rounded-full transition-colors relative", useAdvanced ? "bg-foreground/50" : "bg-foreground/15")}>
                                            <div className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-background transition-all", useAdvanced ? "left-3.5" : "left-0.5")} />
                                        </div>
                                        <span>{useAdvanced ? "Custom settings" : "Workflow defaults"}</span>
                                    </button>
                                    <button type="button" onClick={() => setAdvancedSettings(DEFAULT_SETTINGS)}
                                        className="text-[10px] text-foreground/25 hover:text-foreground/60 transition-colors">
                                        Reset
                                    </button>
                                </div>

                                <div className={cn("flex flex-col gap-3 transition-opacity", !useAdvanced && "opacity-30 pointer-events-none")}>
                                {/* Row 1: Steps, CFG, Sampler */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-foreground/40 uppercase tracking-wider">Steps</label>
                                        <input type="number" step={1} min={1} max={50} value={advancedSettings.steps}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, steps: e.target.value === "" ? "" as unknown as number : parseInt(e.target.value) }))}
                                            onBlur={(e) => setAdvancedSettings(prev => ({ ...prev, steps: Math.min(50, Math.max(1, parseInt(e.target.value) || 8)) }))}
                                            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground/80 focus:outline-none w-full" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-foreground/40 uppercase tracking-wider">CFG</label>
                                        <input type="number" step={0.1} min={0} max={20} value={advancedSettings.cfgScale}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, cfgScale: parseFloat(e.target.value) || 0 }))}
                                            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground/80 focus:outline-none w-full" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-foreground/40 uppercase tracking-wider">Sampler</label>
                                        <select value={advancedSettings.sampler} onChange={(e) => setAdvancedSettings(prev => ({ ...prev, sampler: e.target.value }))}
                                            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground/80 focus:outline-none appearance-none w-full">
                                            <option value="res_multistep">Res Multistep</option>
                                            <option value="euler">Euler</option>
                                            <option value="euler_ancestral">Euler a</option>
                                            <option value="dpmpp_2m">DPM++ 2M</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Row 2: Width, Height, Seed — with custom size toggle */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-foreground/40 uppercase tracking-wider">Height</label>
                                        <input type="number" step={64} min={256} max={2048} value={advancedSettings.height}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, height: e.target.value === "" ? "" as unknown as number : parseInt(e.target.value) }))}
                                            onBlur={(e) => setAdvancedSettings(prev => ({ ...prev, height: Math.min(2048, Math.max(256, parseInt(e.target.value) || 1024)) }))}
                                            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground/80 focus:outline-none w-full" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-foreground/40 uppercase tracking-wider">Width</label>
                                        <input type="number" step={64} min={256} max={2048} value={advancedSettings.width}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, width: e.target.value === "" ? "" as unknown as number : parseInt(e.target.value) }))}
                                            onBlur={(e) => setAdvancedSettings(prev => ({ ...prev, width: Math.min(2048, Math.max(256, parseInt(e.target.value) || 1024)) }))}
                                            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground/80 focus:outline-none w-full" />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] text-foreground/40 uppercase tracking-wider">Seed</label>
                                        <input type="number" step={1} min={-1} value={advancedSettings.seed}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, seed: parseInt(e.target.value) || -1 }))}
                                            className="bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground/80 focus:outline-none w-full" />
                                    </div>
                                </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <form onSubmit={handleGenerate} className="bg-card border border-border rounded-xl flex flex-col p-2 gap-1 focus-within:border-foreground/15 transition-colors">
                        <textarea
                            ref={textareaRef}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isGenerating}
                            placeholder="Describe what you want to generate..."
                            className="align-middle w-full bg-transparent text-foreground placeholder:text-foreground/25 px-2 pt-1.5 pb-1.5 focus:outline-none resize-none text-sm leading-relaxed disabled:opacity-50"
                            rows={1}
                        />
                        <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-1">
                                <div className="relative flex items-center text-foreground/35 hover:text-foreground/60 transition-colors rounded-lg px-2 py-1 cursor-pointer hover:bg-accent">
                                    <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as "square" | "landscape" | "vertical")}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10">
                                        <option value="square">Square</option>
                                        <option value="landscape">Landscape</option>
                                        <option value="vertical">Vertical</option>
                                    </select>
                                    <div className="flex items-center gap-1.5 pointer-events-none text-xs">
                                        {aspectRatio === "square" && <><Square size={12} strokeWidth={2} /><span>Square</span></>}
                                        {aspectRatio === "landscape" && <><RectangleHorizontal size={12} strokeWidth={2} /><span>Landscape</span></>}
                                        {aspectRatio === "vertical" && <><RectangleVertical size={12} strokeWidth={2} /><span>Vertical</span></>}
                                        <ChevronDown size={10} className="opacity-40" />
                                    </div>
                                </div>

                                <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                                    className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors",
                                        showAdvanced ? "text-foreground/70 bg-accent" : "text-foreground/35 hover:text-foreground/60 hover:bg-accent")}>
                                    <Layers size={12} strokeWidth={1.8} /> Advanced
                                </button>
                            </div>

                            <button type="submit" disabled={!prompt.trim() || isGenerating}
                                className={cn("p-1.5 rounded-lg transition-colors",
                                    prompt.trim() && !isGenerating ? "bg-foreground text-background hover:bg-foreground/90" : "bg-foreground/6 text-foreground/20 cursor-not-allowed")}>
                                <ArrowUp size={14} strokeWidth={2.5} />
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <ImageViewer
                isOpen={viewerOpen}
                src={viewerImage?.src || null}
                prompt={viewerImage?.prompt}
                onClose={() => setViewerOpen(false)}
                onRegenerate={() => { if (viewerImage?.prompt) { setPrompt(viewerImage.prompt); handleGenerate(); } }}
            />
        </div>
    );
}
