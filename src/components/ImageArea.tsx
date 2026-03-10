"use client";

import { useState, useRef, useEffect } from "react";
import { Sparkles, ArrowUp, Square, ChevronDown, Layers, RectangleHorizontal, RectangleVertical, Info, RotateCw, ChevronLeft, ChevronRight } from "lucide-react";
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
        time: number; // in seconds
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

    const { activeThreadId: currentThreadId, setActiveThreadId: setCurrentThreadId, lastUsedMode, setLastUsedMode } = useAppContext();
    const skipNextFetchRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Form state
    const [aspectRatio, setAspectRatio] = useState<"square" | "landscape" | "vertical">("square");
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [advancedSettings, setAdvancedSettings] = useState({
        steps: 4,
        seed: -1,
        sampler: "euler",
        cfgScale: 1.0,
    });

    // Viewer state
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerImage, setViewerImage] = useState<{ src: string, prompt: string } | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [prompt]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (prompt.trim() && !isGenerating) {
                handleGenerate();
            }
        }
    };



    // Fetch Messages when thread changes
    useEffect(() => {
        if (!currentThreadId) {
            setMessages([]);
            return;
        }

        if (skipNextFetchRef.current) {
            skipNextFetchRef.current = false;
            return;
        }

        const fetchMessages = async () => {
            const { data } = await supabase
                .from('threads')
                .select('messages')
                .eq('id', currentThreadId)
                .single();

            if (data && data.messages) {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;

                // Resolve proxy URLs (/api/library/...) to signed URLs for display
                const resolveUrl = async (url: string | undefined): Promise<string | undefined> => {
                    if (!url?.startsWith('/api/library/')) return url;
                    try {
                        const res = await fetch(url, {
                            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                        });
                        if (res.ok) {
                            const { signedUrl } = await res.json();
                            return signedUrl;
                        }
                    } catch (err) {
                        console.error("Failed to resolve signed URL:", err);
                    }
                    return url;
                };

                const mappedMessages = await Promise.all((data.messages as Message[]).map(async (msg) => {
                    const newUrl = await resolveUrl(msg.imageUrl);
                    const newVariations = msg.variations ? await Promise.all(msg.variations.map(async (v) => ({
                        ...v,
                        imageUrl: await resolveUrl(v.imageUrl)
                    }))) : undefined;
                    return { ...msg, imageUrl: newUrl, variations: newVariations };
                }));

                setMessages(mappedMessages);
            } else {
                setMessages([]);
            }
        };
        fetchMessages();
    }, [currentThreadId]);



    const createNewThread = async (firstPrompt: string, initialMessages: Message[]) => {
        if (!user) return null;
        let title = firstPrompt.slice(0, 30);
        if (firstPrompt.length > 30) title += "...";

        const { data } = await supabase
            .from('threads')
            .insert([{
                user_id: user.id,
                title: title,
                session_type: 'image_generation',
                model: 'image-generation',
                messages: initialMessages
            }])
            .select()
            .single();

        if (data) {
            skipNextFetchRef.current = true;
            setCurrentThreadId(data.id);
            return data.id;
        }
        return null;
    };

    const handleUpdateThreadMessages = async (threadId: string, updatedMessages: Message[]) => {
        if (!user) return;
        await supabase
            .from('threads')
            .update({ messages: updatedMessages })
            .eq('id', threadId)
            .eq('user_id', user.id);
    };


    const handleGenerate = async (e?: React.FormEvent, msgIdToRegenerate?: string, overridePrompt?: string, metadataToRegenerate?: MessageVariation['metadata']) => {
        if (e) e.preventDefault();

        const currentPrompt = overridePrompt || prompt;
        if (!currentPrompt.trim() || isGenerating) return;

        if (!msgIdToRegenerate) setPrompt("");
        setIsGenerating(true);

        // Clear Ollama VRAM if switching from chat to image generation
        if (lastUsedMode === "chat") {
            const { data: { session } } = await supabase.auth.getSession();
            fetch("/api/vram/clear", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {}) },
                body: JSON.stringify({ target: "ollama" })
            }).catch(() => {});
        }
        setLastUsedMode("image_generation");

        const reqAspectRatio = metadataToRegenerate?.aspectRatio || aspectRatio;
        const reqSteps = metadataToRegenerate?.steps || advancedSettings.steps;
        const reqSeed = metadataToRegenerate ? Math.floor(Math.random() * 1000000000) : (advancedSettings.seed === -1 ? Math.floor(Math.random() * 1000000000) : advancedSettings.seed);

        let newMessagesState: Message[];
        let asstMsgId: string;

        if (msgIdToRegenerate) {
            asstMsgId = msgIdToRegenerate;
            newMessagesState = messages.map(msg => {
                if (msg.id === msgIdToRegenerate) {
                    const baseVariation: MessageVariation = {
                        status: msg.status,
                        imageUrl: msg.imageUrl,
                        metadata: msg.metadata
                    };
                    const variations = msg.variations || [baseVariation];
                    return {
                        ...msg,
                        status: "generating",
                        variations: [...variations, { status: "generating" }],
                        currentVariationIndex: variations.length
                    };
                }
                return msg;
            });
        } else {
            const userMsgId = Date.now().toString();
            asstMsgId = (Date.now() + 1).toString();

            const userMessage: Message = { id: userMsgId, role: "user", content: currentPrompt };
            const asstMessage: Message = { id: asstMsgId, role: "assistant", content: currentPrompt, status: "generating" };

            newMessagesState = [
                ...messages,
                userMessage,
                asstMessage
            ];
        }

        setMessages(newMessagesState);

        let activeThreadId = currentThreadId;
        if (!activeThreadId) {
            activeThreadId = await createNewThread(currentPrompt, newMessagesState);
        } else {
            await handleUpdateThreadMessages(activeThreadId, newMessagesState);
        }

        const startTime = Date.now();

        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const res = await fetch('/api/imgen/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    prompt: currentPrompt,
                    aspectRatio: reqAspectRatio,
                })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Failed to start generation");
            }

            const { prompt_id } = await res.json();

            let isDone = false;
            let finalImageUrl = "";

            while (!isDone) {
                await new Promise(resolve => setTimeout(resolve, 2000));

                const statusRes = await fetch(`/api/imgen/status?prompt_id=${prompt_id}`, {
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    }
                });
                const statusData = await statusRes.json();

                if (statusData.status === 'done') {
                    finalImageUrl = statusData.imageUrl;
                    isDone = true;
                } else if (statusData.status === 'error') {
                    throw new Error(statusData.error || "Generation error");
                }
            }

            const timeTaken = (Date.now() - startTime) / 1000;

            const metadata = {
                model: "Flux.1",
                seed: reqSeed,
                aspectRatio: reqAspectRatio,
                steps: reqSteps,
                time: parseFloat(timeTaken.toFixed(1))
            };

            // 1. Instantly display the image from ComfyUI locally
            let messagesAfterGen = newMessagesState.map((msg): Message => {
                if (msg.id === asstMsgId) {
                    if (msg.variations) {
                        const newVariations = [...msg.variations];
                        const currentIndex = msg.currentVariationIndex ?? 0;
                        newVariations[currentIndex] = {
                            status: "done" as const,
                            imageUrl: finalImageUrl,
                            metadata: metadata
                        };
                        return {
                            ...msg,
                            status: "done" as const,
                            imageUrl: finalImageUrl,
                            metadata: metadata,
                            variations: newVariations
                        };
                    } else {
                        return {
                            ...msg,
                            status: "done" as const,
                            imageUrl: finalImageUrl,
                            metadata: metadata
                        };
                    }
                }
                return msg;
            });

            setMessages(messagesAfterGen);

            // 2. Perform background save to DB and Storage
            if (activeThreadId && user && finalImageUrl) {
                try {
                    const saveRes = await fetch('/api/imgen/save', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                        },
                        body: JSON.stringify({
                            imageUrl: finalImageUrl,
                            prompt: currentPrompt,
                            metadata: metadata
                        })
                    });
                    if (saveRes.ok) {
                        const saveData = await saveRes.json();
                        if (saveData.permanentUrl) {
                            // Resolve the permanent proxy URL to a signed URL for immediate display
                            let displayUrl = finalImageUrl; // fallback to ComfyUI URL
                            try {
                                const signedRes = await fetch(saveData.permanentUrl, {
                                    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                                });
                                if (signedRes.ok) {
                                    const { signedUrl } = await signedRes.json();
                                    displayUrl = signedUrl;
                                }
                            } catch (err) {
                                console.error("Failed to resolve signed URL:", err);
                            }

                            // Update display with signed URL, but store permanent proxy URL in DB
                            const permanentUrl = saveData.permanentUrl;

                            // Update local state with display URL
                            const displayMessages = messagesAfterGen.map((msg): Message => {
                                if (msg.id === asstMsgId) {
                                    if (msg.variations) {
                                        const newVariations = [...msg.variations];
                                        const currentIndex = msg.currentVariationIndex ?? 0;
                                        newVariations[currentIndex] = { ...newVariations[currentIndex], imageUrl: displayUrl };
                                        return { ...msg, imageUrl: displayUrl, variations: newVariations };
                                    }
                                    return { ...msg, imageUrl: displayUrl };
                                }
                                return msg;
                            });
                            setMessages(displayMessages);

                            // Store permanent proxy URL in DB (not the signed URL which expires)
                            messagesAfterGen = messagesAfterGen.map((msg): Message => {
                                if (msg.id === asstMsgId) {
                                    if (msg.variations) {
                                        const newVariations = [...msg.variations];
                                        const currentIndex = msg.currentVariationIndex ?? 0;
                                        newVariations[currentIndex] = { ...newVariations[currentIndex], imageUrl: permanentUrl };
                                        return { ...msg, imageUrl: permanentUrl, variations: newVariations };
                                    }
                                    return { ...msg, imageUrl: permanentUrl };
                                }
                                return msg;
                            });
                        }
                    }
                } catch (e) {
                    console.error("Failed to permanently save image to storage", e);
                    // Don't persist raw ComfyUI URL in DB — clear imageUrl so it won't break on IP change
                    messagesAfterGen = messagesAfterGen.map((msg): Message => {
                        if (msg.id !== asstMsgId) return msg;
                        const newVariations = msg.variations?.map((v, i) =>
                            i === (msg.currentVariationIndex ?? 0) ? { ...v, status: "error" as const, imageUrl: undefined } : v
                        );
                        return { ...msg, status: "error" as const, imageUrl: undefined, ...(newVariations && { variations: newVariations }) };
                    });
                    setMessages(messagesAfterGen);
                }

                if (activeThreadId) {
                    await handleUpdateThreadMessages(activeThreadId, messagesAfterGen);
                }
            }

            setIsGenerating(false);

        } catch (error) {
            console.error("Image generation failed:", error);
            const messagesAfterError = newMessagesState.map((msg): Message => {
                if (msg.id === asstMsgId) {
                    if (msg.variations) {
                        const newVariations = [...msg.variations];
                        const currentIndex = msg.currentVariationIndex ?? 0;
                        newVariations[currentIndex] = {
                            ...newVariations[currentIndex],
                            status: "error" as const
                        };
                        return { ...msg, status: "error" as const, content: msg.variations ? msg.content : "Failed to generate image. Please try again.", variations: newVariations };
                    }
                    return {
                        ...msg,
                        status: "error" as const,
                        content: "Failed to generate image. Please try again."
                    }
                }
                return msg;
            });

            setMessages(messagesAfterError);
            setIsGenerating(false);

            if (activeThreadId) {
                await handleUpdateThreadMessages(activeThreadId, messagesAfterError);
            }
        }
    };

    const handleImageClick = (src: string, promptText: string) => {
        setViewerImage({ src, prompt: promptText });
        setViewerOpen(true);
    };

    return (
        <div className="relative h-full w-full flex flex-col pt-6 items-center overflow-hidden">

            {/* Removed the History Overlay Dropdown - now handled by the main Sidebar */}

            {messages.length === 0 ? (
                // Initial State
                <div className="flex-1 w-full flex flex-col items-center justify-center p-8">
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-center w-16 h-16 rounded-2xl bg-white/[0.02] border border-white/[0.05] shadow-sm mb-6"
                    >
                        <Sparkles size={28} className="text-white/60" />
                    </motion.div>
                    <h2 className="text-3xl font-semibold text-white tracking-tight mb-2">Image Studio</h2>
                    <p className="text-white/40 text-[15px] max-w-md text-center">
                        Describe your vision in detail to generate high-fidelity images using premium models.
                    </p>
                </div>
            ) : (
                // Chat Area
                <div className="flex-1 w-full overflow-y-auto custom-scrollbar px-4">
                    <div className="max-w-3xl mx-auto flex flex-col gap-8 pb-36 pt-10">
                        {messages.map((msg) => {
                            const variations = msg.variations || [{ status: msg.status, imageUrl: msg.imageUrl, metadata: msg.metadata }];
                            const currentVarIndex = msg.currentVariationIndex || 0;
                            const currentVariation = variations[currentVarIndex] || variations[0];

                            const handlePrevVar = () => {
                                setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id && m.variations) {
                                        return { ...m, currentVariationIndex: Math.max(0, (m.currentVariationIndex || 0) - 1) };
                                    }
                                    return m;
                                }));
                            };

                            const handleNextVar = () => {
                                setMessages(prev => prev.map(m => {
                                    if (m.id === msg.id && m.variations) {
                                        return { ...m, currentVariationIndex: Math.min(m.variations.length - 1, (m.currentVariationIndex || 0) + 1) };
                                    }
                                    return m;
                                }));
                            };

                            return (
                                <motion.div
                                    key={msg.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={cn(
                                        "flex w-full",
                                        msg.role === "user" ? "justify-end" : "justify-start"
                                    )}
                                >
                                    {msg.role === "user" ? (
                                        <div className="max-w-[80%] px-5 py-3.5 rounded-2xl bg-white/[0.04] text-white text-[15px] leading-relaxed border border-white/[0.05]">
                                            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col w-full max-w-[85%]">
                                            {currentVariation.status === "generating" && (
                                                <div className="flex items-center gap-3 text-white/50 text-[14px] px-1 py-1.5">
                                                    <div className="relative flex items-center justify-center w-4 h-4">
                                                        <div className="absolute inset-0 rounded-full border border-white/10" />
                                                        <div className="absolute inset-0 rounded-full border border-white/50 border-t-transparent animate-spin" />
                                                    </div>
                                                    <span className="font-medium">Generating image...</span>
                                                </div>
                                            )}
                                            {currentVariation.status === "error" && (
                                                <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                                                    {msg.content}
                                                </div>
                                            )}
                                            {currentVariation.status === "done" && currentVariation.imageUrl && (
                                                <div className="group flex flex-col gap-3 items-start">
                                                    <div
                                                        className="relative cursor-zoom-in overflow-hidden rounded-xl border border-white/[0.08] shadow-sm transition-transform hover:scale-[1.01] bg-black/20"
                                                        onClick={() => handleImageClick(currentVariation.imageUrl!, msg.content)}
                                                    >
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={currentVariation.imageUrl}
                                                            alt={msg.content}
                                                            className={cn(
                                                                "object-contain w-auto h-auto max-h-[60vh]",
                                                                currentVariation.metadata?.aspectRatio === "landscape" ? "aspect-video"
                                                                    : currentVariation.metadata?.aspectRatio === "vertical" ? "aspect-[9/16]"
                                                                        : "aspect-square"
                                                            )}
                                                            style={{ maxWidth: "100%" }}
                                                        />
                                                    </div>

                                                    {currentVariation.metadata && (
                                                        <div className="flex items-center gap-1.5 px-0.5 mt-0.5">
                                                            <button
                                                                onClick={() => handleGenerate(undefined, msg.id, msg.content)}
                                                                className="p-1 text-white/30 hover:text-white/80 transition-colors"
                                                                title="Regenerate"
                                                            >
                                                                <RotateCw size={14} />
                                                            </button>

                                                            <div className="relative group/info flex items-center">
                                                                <button className="p-1 text-white/30 hover:text-white/80 transition-colors">
                                                                    <Info size={14} />
                                                                </button>
                                                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 bg-[#141414] border border-white/10 rounded-xl px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.8)] opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all whitespace-nowrap z-20 pointer-events-none">
                                                                    <div className="flex flex-col gap-1.5 text-[12px] text-white/70 font-mono">
                                                                        <span>Model: <span className="text-white font-medium">{currentVariation.metadata.model}</span></span>
                                                                        <span>Steps: <span className="text-white font-medium">{currentVariation.metadata.steps}</span></span>
                                                                        <span>Seed: <span className="text-white font-medium">{currentVariation.metadata.seed}</span></span>
                                                                        <span>Time: <span className="text-white font-medium">{currentVariation.metadata.time}s</span></span>
                                                                    </div>
                                                                </div>
                                                                {/* Tooltip Arrow */}
                                                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1a1d29]" />
                                                            </div>

                                                            {variations.length > 1 && (
                                                                <div className="flex items-center gap-1.5 text-[11px] text-white/50 bg-white/5 rounded-md px-1 py-0.5 ml-1 border border-white/5">
                                                                    <button onClick={handlePrevVar} disabled={currentVarIndex === 0} className="hover:text-white disabled:opacity-30 disabled:hover:text-white/50 p-0.5" title="Previous version">
                                                                        <ChevronLeft size={13} />
                                                                    </button>
                                                                    <span className="font-medium select-none">{currentVarIndex + 1}/{variations.length}</span>
                                                                    <button onClick={handleNextVar} disabled={currentVarIndex === variations.length - 1} className="hover:text-white disabled:opacity-30 disabled:hover:text-white/50 p-0.5" title="Next version">
                                                                        <ChevronRight size={13} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                        <div ref={messagesEndRef} className="h-4" />
                    </div>
                </div>
            )}

            {/* Input Area */}
            <div className="w-full shrink-0 px-4 pb-8 absolute bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent z-10 pt-10 pointer-events-none">
                <div className="max-w-3xl mx-auto w-full flex flex-col gap-2 pointer-events-auto">
                    {/* Advanced Params Toggle Menu */}
                    <AnimatePresence>
                        {showAdvanced && (
                            <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                                className="mb-2 bg-sidebar/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden shadow-lg p-5"
                            >
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-medium text-white/50 uppercase tracking-wider">Steps</label>
                                        <input
                                            type="number"
                                            value={advancedSettings.steps}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, steps: parseInt(e.target.value) || 20 }))}
                                            className="bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/20 transition-colors"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-medium text-white/50 uppercase tracking-wider">Seed (-1 = Random)</label>
                                        <input
                                            type="number"
                                            value={advancedSettings.seed}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, seed: parseInt(e.target.value) || -1 }))}
                                            className="bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/20 transition-colors"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-medium text-white/50 uppercase tracking-wider">CFG Scale</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={advancedSettings.cfgScale}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, cfgScale: parseFloat(e.target.value) || 7.0 }))}
                                            className="bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/20 transition-colors"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[11px] font-medium text-white/50 uppercase tracking-wider">Sampler</label>
                                        <select
                                            value={advancedSettings.sampler}
                                            onChange={(e) => setAdvancedSettings(prev => ({ ...prev, sampler: e.target.value }))}
                                            className="bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-white/20 transition-colors appearance-none"
                                        >
                                            <option value="euler">Euler</option>
                                            <option value="euler_ancestral">Euler a</option>
                                            <option value="dpmpp_2m">DPM++ 2M</option>
                                        </select>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <form
                        onSubmit={handleGenerate}
                        className="bg-sidebar backdrop-blur-xl rounded-2xl relative flex items-center focus-within:ring-1 focus-within:ring-white/10 w-full border border-white/[0.08] shadow-lg"
                    >
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className={cn(
                                "pl-4 pr-2 hover:text-white/80 transition-colors shrink-0 flex items-center justify-center p-2 pl-5 rounded-lg",
                                showAdvanced ? "text-white/80" : "text-white/30"
                            )}
                            title="Advanced parameters"
                        >
                            <Layers size={18} strokeWidth={1.5} />
                        </button>

                        <textarea
                            ref={textareaRef}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isGenerating}
                            placeholder="Describe what you want to see..."
                            className="flex-1 bg-transparent border-none text-white placeholder:text-white/40 px-2 py-4 focus:outline-none focus:ring-0 disabled:opacity-50 text-[15px] leading-relaxed resize-none overflow-y-auto"
                            rows={1}
                        />

                        <div className="p-1.5 shrink-0 flex items-center gap-1.5">
                            <div className="relative flex items-center text-white/50 hover:text-white/90 transition-colors bg-white/5 hover:bg-white/10 rounded-xl px-3 py-2 cursor-pointer border border-white/5 group">
                                <select
                                    value={aspectRatio}
                                    onChange={(e) => setAspectRatio(e.target.value as "square" | "landscape" | "vertical")}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                    title="Aspect Ratio"
                                >
                                    <option value="square" className="bg-sidebar text-sidebar-foreground">Square</option>
                                    <option value="landscape" className="bg-sidebar text-sidebar-foreground">Landscape</option>
                                    <option value="vertical" className="bg-sidebar text-sidebar-foreground">Vertical</option>
                                </select>
                                <div className="flex items-center gap-1.5 pointer-events-none relative z-0">
                                    {aspectRatio === "square" && <Square className="w-4 h-4 shrink-0" strokeWidth={2} />}
                                    {aspectRatio === "landscape" && <RectangleHorizontal className="w-4 h-4 shrink-0" strokeWidth={2} />}
                                    {aspectRatio === "vertical" && <RectangleVertical className="w-4 h-4 shrink-0" strokeWidth={2} />}
                                    <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={!prompt.trim() || isGenerating}
                                className={cn(
                                    "p-3 rounded-xl flex items-center justify-center transition-all duration-200",
                                    prompt.trim() && !isGenerating
                                        ? "bg-white text-black hover:bg-neutral-200 shadow-sm"
                                        : "bg-white/[0.05] text-white/20 cursor-not-allowed"
                                )}
                            >
                                <ArrowUp size={18} strokeWidth={2.5} />
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
                onRegenerate={() => {
                    if (viewerImage?.prompt) {
                        setPrompt(viewerImage.prompt);
                        handleGenerate();
                    }
                }}
            />
        </div>
    );
}
