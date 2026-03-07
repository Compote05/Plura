"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, RotateCw, Info, ChevronLeft, ChevronRight, Play, Pause, Download, Volume2, VolumeX, Sparkles, AudioLines, Settings2, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAppContext } from "@/context/AppContext";

interface MessageVariation {
    status?: "generating" | "done" | "error";
    audioUrl?: string;
    metadata?: {
        model: string;
        seed: number | string;
        time: number; // in seconds
    };
}

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    status?: "generating" | "done" | "error";
    audioUrl?: string;
    metadata?: MessageVariation['metadata'];
    variations?: MessageVariation[];
    currentVariationIndex?: number;
}

// Spectrogram Loading Animation
const SpectrogramLoading = ({ className }: { className?: string }) => (
    <div className={cn("flex items-center justify-center gap-[3px] h-6 px-1", className)}>
        {[...Array(6)].map((_, i) => (
            <motion.div
                key={i}
                className="w-[2.5px] bg-emerald-400 rounded-full"
                animate={{ height: ["4px", "16px", "4px"] }}
                transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: i * 0.1,
                }}
            />
        ))}
    </div>
);

// Inline sleek audio player for history cards
const MessageAudioPlayer = ({ src, onDownload }: { src: string, onDownload: () => void }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);

    const togglePlay = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                audioRef.current.play().then(() => {
                    setIsPlaying(true);
                }).catch(err => {
                    console.error("Audio playback failed:", err);
                    setIsPlaying(false);
                });
            }
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            setProgress((audioRef.current.currentTime / duration) * 100 || 0);
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            setDuration(audioRef.current.duration);
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || duration === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        audioRef.current.currentTime = percentage * duration;
    };

    const formatTime = (time: number) => {
        if (isNaN(time)) return "0:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    return (
        <div className="flex flex-col w-full bg-white/[0.02] border border-white/[0.05] rounded-2xl overflow-hidden p-4 gap-3">
            <audio
                ref={audioRef}
                src={src}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => { setIsPlaying(false); setProgress(0); }}
                className="hidden"
            />

            <div className="flex items-center gap-4">
                <button
                    onClick={togglePlay}
                    className="w-10 h-10 shrink-0 flex items-center justify-center bg-white text-black hover:bg-neutral-200 hover:scale-105 active:scale-95 rounded-full transition-all shadow-md"
                >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 ml-0.5 fill-current" />}
                </button>

                <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                    <div className="flex items-center justify-between text-[11px] text-white/50 font-mono font-medium px-1 uppercase tracking-wider">
                        <span>{audioRef.current ? formatTime(audioRef.current.currentTime) : '0:00'}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                    <div
                        className="h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer group relative"
                        onClick={handleSeek}
                    >
                        <div
                            className="h-full bg-emerald-400 transition-all duration-100 ease-linear rounded-full"
                            style={{ width: `${progress}%` }}
                        />
                        <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                </div>

                <div className="flex items-center gap-0.5 shrink-0 pl-1">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (audioRef.current) {
                                audioRef.current.muted = !isMuted;
                                setIsMuted(!isMuted);
                            }
                        }}
                        className="p-2 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5"
                    >
                        {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDownload(); }}
                        className="p-2 text-white/40 hover:text-white transition-colors rounded-full hover:bg-white/5"
                    >
                        <Download size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function TTSArea({ user }: { user: User | null }) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [prompt, setPrompt] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);

    const { activeThreadId: currentThreadId, setActiveThreadId: setCurrentThreadId } = useAppContext();
    const skipNextFetchRef = useRef(false);

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
                    const newUrl = await resolveUrl(msg.audioUrl);
                    const newVariations = msg.variations ? await Promise.all(msg.variations.map(async (v) => ({
                        ...v,
                        audioUrl: await resolveUrl(v.audioUrl)
                    }))) : undefined;
                    return { ...msg, audioUrl: newUrl, variations: newVariations };
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
        let title = "Audio: " + firstPrompt.slice(0, 20);
        if (firstPrompt.length > 20) title += "...";

        const { data } = await supabase
            .from('threads')
            .insert([{
                user_id: user.id,
                title: title,
                model: 'text-to-speech',
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

    const handleDeletePair = async (userId: string, assistantId: string) => {
        const newMessagesState = messages.filter(msg => msg.id !== userId && msg.id !== assistantId);
        setMessages(newMessagesState);
        if (currentThreadId) {
            await handleUpdateThreadMessages(currentThreadId, newMessagesState);
        }
    };


    const handleGenerate = async (e?: React.FormEvent, msgIdToRegenerate?: string, overridePrompt?: string, metadataToRegenerate?: MessageVariation['metadata']) => {
        if (e) e.preventDefault();

        const currentPrompt = overridePrompt || prompt;
        if (!currentPrompt.trim() || isGenerating) return;

        if (!msgIdToRegenerate) setPrompt("");
        setIsGenerating(true);

        const reqSeed = metadataToRegenerate ? Math.floor(Math.random() * 1000000000) : Math.floor(Math.random() * 1000000000);

        let newMessagesState: Message[];
        let asstMsgId: string;

        if (msgIdToRegenerate) {
            asstMsgId = msgIdToRegenerate;
            newMessagesState = messages.map(msg => {
                if (msg.id === msgIdToRegenerate) {
                    const baseVariation: MessageVariation = {
                        status: msg.status,
                        audioUrl: msg.audioUrl,
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

            const res = await fetch('/api/tts/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                    prompt: currentPrompt,
                })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Failed to start generation");
            }

            const { prompt_id } = await res.json();

            let isDone = false;
            let finalAudioUrl = "";

            while (!isDone) {
                await new Promise(resolve => setTimeout(resolve, 2000));

                const statusRes = await fetch(`/api/tts/status?prompt_id=${prompt_id}`, {
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    }
                });
                const statusData = await statusRes.json();

                if (statusData.status === 'done') {
                    finalAudioUrl = statusData.audioUrl;
                    isDone = true;
                } else if (statusData.status === 'error') {
                    throw new Error(statusData.error || "Generation error");
                }
            }

            const timeTaken = (Date.now() - startTime) / 1000;

            const metadata = {
                model: "Qwen3-TTS",
                seed: reqSeed,
                time: parseFloat(timeTaken.toFixed(1))
            };

            let messagesAfterGen = newMessagesState.map((msg): Message => {
                if (msg.id === asstMsgId) {
                    if (msg.variations) {
                        const newVariations = [...msg.variations];
                        const currentIndex = msg.currentVariationIndex ?? 0;
                        newVariations[currentIndex] = {
                            status: "done" as const,
                            audioUrl: finalAudioUrl,
                            metadata: metadata
                        };
                        return {
                            ...msg,
                            status: "done" as const,
                            audioUrl: finalAudioUrl,
                            metadata: metadata,
                            variations: newVariations
                        };
                    } else {
                        return {
                            ...msg,
                            status: "generating" as const, // Hold status as generating until save is done
                            metadata: metadata
                        };
                    }
                }
                return msg;
            });

            setMessages(messagesAfterGen);

            if (activeThreadId && user && finalAudioUrl) {
                try {
                    const saveRes = await fetch('/api/tts/save', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                        },
                        body: JSON.stringify({
                            audioUrl: finalAudioUrl,
                            prompt: currentPrompt,
                        })
                    });
                    if (saveRes.ok) {
                        const saveData = await saveRes.json();
                        if (saveData.permanentUrl) {
                            // Resolve proxy URL to signed URL for immediate display
                            let displayUrl = finalAudioUrl;
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

                            const permanentUrl = saveData.permanentUrl;

                            // Update local state with signed URL for display
                            const displayMessages = messagesAfterGen.map((msg): Message => {
                                if (msg.id === asstMsgId) {
                                    if (msg.variations) {
                                        const newVariations = [...msg.variations];
                                        const currentIndex = msg.currentVariationIndex ?? 0;
                                        newVariations[currentIndex] = { ...newVariations[currentIndex], audioUrl: displayUrl, status: "done" as const };
                                        return { ...msg, audioUrl: displayUrl, status: "done" as const, variations: newVariations };
                                    }
                                    return { ...msg, audioUrl: displayUrl, status: "done" as const };
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
                                        newVariations[currentIndex] = { ...newVariations[currentIndex], audioUrl: permanentUrl, status: "done" as const };
                                        return { ...msg, audioUrl: permanentUrl, status: "done" as const, variations: newVariations };
                                    }
                                    return { ...msg, audioUrl: permanentUrl, status: "done" as const };
                                }
                                return msg;
                            });
                        } else {
                            throw new Error("Missing permanent URL");
                        }
                    } else {
                        throw new Error("Failed to save audio");
                    }
                } catch (e) {
                    console.error("Failed to permanently save audio", e);
                    messagesAfterGen = messagesAfterGen.map((msg): Message => {
                        if (msg.id === asstMsgId) {
                            if (msg.variations) {
                                const newVariations = [...msg.variations];
                                const currentIndex = msg.currentVariationIndex ?? 0;
                                newVariations[currentIndex] = { ...newVariations[currentIndex], status: "error" as const };
                                return { ...msg, status: "error" as const, content: "Failed to upload generated audio.", variations: newVariations };
                            }
                            return { ...msg, status: "error" as const, content: "Failed to upload generated audio." };
                        }
                        return msg;
                    });
                    setMessages(messagesAfterGen);
                }

                if (activeThreadId) {
                    await handleUpdateThreadMessages(activeThreadId, messagesAfterGen);
                }
            }

            setIsGenerating(false);

        } catch (error) {
            console.error("TTS generation failed:", error);
            const messagesAfterError = newMessagesState.map((msg): Message => {
                if (msg.id === asstMsgId) {
                    if (msg.variations) {
                        const newVariations = [...msg.variations];
                        const currentIndex = msg.currentVariationIndex ?? 0;
                        newVariations[currentIndex] = {
                            ...newVariations[currentIndex],
                            status: "error" as const
                        };
                        return { ...msg, status: "error" as const, content: msg.variations ? msg.content : "Failed to generate.", variations: newVariations };
                    }
                    return {
                        ...msg,
                        status: "error" as const,
                        content: "Failed to generate."
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

    const handleDownloadRequest = async (src: string, promptText: string) => {
        try {
            const response = await fetch(src);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `audio-${Date.now()}.${blob.type.includes('wav') ? 'wav' : 'mp3'}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error("Download failed:", error);
            const link = document.createElement('a');
            link.href = src;
            link.download = `audio-${Date.now()}`;
            link.click();
        }
    };

    // Group generations (User prompt -> Assistant audio)
    const groupedGenerations: { userMsg: Message, asstMsg: Message | null }[] = [];
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            groupedGenerations.push({
                userMsg: messages[i],
                asstMsg: messages[i + 1]?.role === 'assistant' ? messages[i + 1] : null
            });
            if (messages[i + 1]?.role === 'assistant') i++;
        }
    }
    groupedGenerations.reverse();

    return (
        <div className="flex h-full w-full bg-background overflow-hidden text-white font-sans selection:bg-emerald-500/30">
            {/* L E F T   P A N E   —   C O M P O S E R */}
            <div className="w-full max-w-[340px] xl:max-w-[400px] flex-shrink-0 border-r border-white-[0.05] bg-sidebar flex flex-col z-20 shadow-[4px_0_24px_rgba(0,0,0,0.1)]">
                {/* Header */}
                <div className="px-5 mx-2 mt-5 pb-5 border-b border-white/[0.04]">
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-8 h-8 flex items-center justify-center rounded-[10px] bg-emerald-500/10 text-emerald-400">
                            <AudioLines size={18} strokeWidth={2} />
                        </div>
                        <h2 className="text-[17px] font-bold tracking-tight">Audio Studio</h2>
                    </div>
                    <p className="text-[12px] text-white/40 leading-relaxed font-medium">Professional Speech Synthesis Engine</p>
                </div>

                {/* Form Area */}
                <div className="flex-1 flex flex-col p-5 mx-2 overflow-y-auto custom-scrollbar">

                    {/* Settings Mockup */}
                    <div className="flex items-center justify-between mb-6 group cursor-pointer hover:bg-white/[0.02] p-2 -mx-2 rounded-xl transition-colors shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="https://api.dicebear.com/7.x/notionists/svg?seed=Rachel&backgroundColor=transparent" alt="Voice Avatar" className="w-full h-full opacity-80" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-medium text-white/40 uppercase tracking-widest leading-none mb-1 mt-0.5">Active Voice</span>
                                <span className="text-[13px] font-medium tracking-wide">Qwen3 Default</span>
                            </div>
                        </div>
                        <button className="text-white/20 group-hover:text-white/60 transition-colors">
                            <Settings2 size={16} />
                        </button>
                    </div>

                    <div className="flex flex-col gap-2 flex-1 mb-6">
                        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-widest pl-1 shrink-0">Script Text</label>
                        <div className="relative flex-1 flex flex-col bg-white/[0.02] border border-white/5 rounded-2xl group focus-within:bg-white/[0.04] focus-within:border-white/10 transition-all overflow-hidden min-h-[160px]">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                disabled={isGenerating}
                                placeholder="Type the text you want to convert into speech here..."
                                className="flex-1 w-full bg-transparent border-none text-white/90 placeholder:text-white/20 text-[14px] leading-relaxed resize-none focus:outline-none focus:ring-0 p-4 custom-scrollbar h-full disabled:opacity-50"
                            />

                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-[0.03] transition-opacity duration-1000">
                                <Mic size={100} />
                            </div>

                            <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.03] bg-black/10 shrink-0">
                                <span className={cn("text-[10px] font-mono", prompt.length > 500 ? "text-emerald-400" : "text-white/30")}>
                                    {prompt.length} / 1000
                                </span>
                                {prompt.length > 0 && (
                                    <button
                                        onClick={() => setPrompt("")}
                                        className="text-[10px] font-medium text-white/30 hover:text-white/80 transition-colors uppercase tracking-widest"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={(e) => handleGenerate(e)}
                        disabled={!prompt.trim() || isGenerating}
                        className={cn(
                            "w-full py-3.5 rounded-xl font-semibold text-[13.5px] transition-all flex items-center justify-center gap-2.5 relative overflow-hidden shrink-0",
                            prompt.trim() && !isGenerating
                                ? "bg-white text-black hover:bg-neutral-200 shadow-md active:scale-[0.98]"
                                : "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
                        )}
                    >
                        {isGenerating ? (
                            <span className="relative z-10 flex items-center gap-2.5 text-black">
                                <SpectrogramLoading className="h-4" />
                                <span className="tracking-wide text-[13px]">Synthesizing...</span>
                            </span>
                        ) : (
                            <>
                                <Sparkles size={15} className={prompt.trim() ? "text-emerald-600" : "text-white/20"} />
                                <span className="tracking-wide">Generate Voice</span>
                            </>
                        )}

                        {isGenerating && (
                            <motion.div
                                className="absolute inset-0 bg-emerald-500/20"
                                initial={{ x: "-100%" }}
                                animate={{ x: "100%" }}
                                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                            />
                        )}
                    </button>
                </div>
            </div>

            {/* R I G H T   P A N E   —   R E S U L T S */}
            <div className="flex-1 flex flex-col relative bg-transparent overflow-hidden">

                {groupedGenerations.length === 0 ? (
                    <div className="flex-1 w-full flex flex-col items-center justify-center p-8 opacity-40">
                        <div className="w-16 h-16 mb-5 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                            <AudioLines size={26} className="text-white/30" />
                        </div>
                        <h3 className="text-lg font-medium text-white mb-1.5">No audio generated yet</h3>
                        <p className="text-white/40 text-[13px] text-center max-w-[280px]">
                            Your generated audio clips will appear here. Enter a script on the left panel to begin.
                        </p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-5 lg:px-8 py-8 flex flex-col gap-6 items-start max-w-4xl mx-auto w-full">

                        <div className="flex items-center gap-3 text-white/30 mb-1 w-full border-b border-white/[0.04] pb-3">
                            <span className="text-[10px] font-semibold uppercase tracking-widest px-1">Generation Library</span>
                        </div>

                        {groupedGenerations.map((gen, idx) => {
                            const msg = gen.asstMsg;
                            const text = gen.userMsg;

                            const variations = msg?.variations || (msg ? [{ status: msg.status, audioUrl: msg.audioUrl, metadata: msg.metadata }] : []);
                            const currentVarIndex = msg?.currentVariationIndex || 0;
                            const currentVariation = variations[currentVarIndex] || variations[0] || {};

                            const handlePrevVar = () => setMessages(prev => prev.map(m => m.id === msg?.id && m.variations ? { ...m, currentVariationIndex: Math.max(0, (m.currentVariationIndex || 0) - 1) } : m));
                            const handleNextVar = () => setMessages(prev => prev.map(m => m.id === msg?.id && m.variations ? { ...m, currentVariationIndex: Math.min(m.variations.length - 1, (m.currentVariationIndex || 0) + 1) } : m));

                            return (
                                <motion.div
                                    key={text.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    className="w-full bg-white/[0.015] border border-white/[0.04] rounded-[20px] p-5 md:p-6 flex flex-col gap-4 hover:bg-white/[0.025] hover:border-white/[0.06] transition-all shadow-sm group"
                                >
                                    {/* Text Snippet Area */}
                                    <div className="flex items-start justify-between gap-5 border-b border-white/[0.03] pb-4">
                                        <div className="text-[14px] text-white/70 leading-relaxed font-serif relative pl-4">
                                            <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-emerald-500/30 rounded-full" />
                                            "{text.content}"
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {msg && (
                                                <button
                                                    onClick={() => handleDeletePair(text.id, msg.id)}
                                                    className="p-1.5 text-white/30 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                                    title="Delete this generation"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Audio Player Area */}
                                    {msg && (
                                        <div className="w-full">
                                            {currentVariation.status === "generating" ? (
                                                <div className="flex items-center justify-center gap-4 bg-white/[0.02] rounded-xl p-5 border border-white/[0.02]">
                                                    <SpectrogramLoading />
                                                    <span className="text-emerald-400/80 text-[12px] font-medium tracking-widest uppercase">Synthesizing stream...</span>
                                                </div>
                                            ) : currentVariation.status === "error" ? (
                                                <div className="px-5 py-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">
                                                    {msg.content}
                                                </div>
                                            ) : currentVariation.status === "done" && currentVariation.audioUrl && (
                                                <div className="flex flex-col gap-3">
                                                    <MessageAudioPlayer
                                                        src={currentVariation.audioUrl}
                                                        onDownload={() => handleDownloadRequest(currentVariation.audioUrl!, text.content)}
                                                    />

                                                    <div className="flex items-center justify-between w-full px-1 pt-1">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => handleGenerate(undefined, msg.id, text.content)}
                                                                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition-all text-[11px] font-medium uppercase tracking-wide"
                                                                title="Regenerate varying voice"
                                                            >
                                                                <RotateCw size={12} />
                                                                <span>Regenerate</span>
                                                            </button>

                                                            <div className="relative group/info flex items-center">
                                                                <button className="flex items-center gap-1.5 px-2 py-1 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition-all text-[11px] font-medium uppercase tracking-wide">
                                                                    <Info size={12} />
                                                                    <span>Details</span>
                                                                </button>
                                                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-black/95 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.5)] opacity-0 invisible group-hover/info:opacity-100 group-hover/info:visible transition-all whitespace-nowrap z-20 pointer-events-none">
                                                                    <div className="flex flex-col gap-2.5 text-[11px] text-white/50 font-mono">
                                                                        <div className="flex justify-between gap-6"><span>Model</span><span className="text-white font-medium">{currentVariation.metadata?.model}</span></div>
                                                                        <div className="flex justify-between gap-6"><span>Seed</span><span className="text-white font-medium">{currentVariation.metadata?.seed}</span></div>
                                                                        <div className="flex justify-between gap-6"><span>Duration</span><span className="text-white font-medium">{currentVariation.metadata?.time}s</span></div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {variations.length > 1 && (
                                                            <div className="flex items-center gap-1.5 text-[11px] text-white/50 bg-black/20 rounded-md px-1.5 py-1 border border-white/5">
                                                                <button onClick={handlePrevVar} disabled={currentVarIndex === 0} className="hover:text-white disabled:opacity-30 p-0.5 rounded transition-colors" title="Previous version">
                                                                    <ChevronLeft size={13} />
                                                                </button>
                                                                <span className="font-semibold select-none min-w-[30px] text-center">{currentVarIndex + 1}/{variations.length}</span>
                                                                <button onClick={handleNextVar} disabled={currentVarIndex === variations.length - 1} className="hover:text-white disabled:opacity-30 p-0.5 rounded transition-colors" title="Next version">
                                                                    <ChevronRight size={13} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
