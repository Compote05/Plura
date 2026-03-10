"use client";

import { useState, useRef, useEffect } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css"; // Math styling
import InputBar from "./InputBar";
import { Copy, Check, ChevronDown, BrainCircuit, ArrowDown, FileText } from "lucide-react";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ImageViewer from "./ImageViewer";

import { cn } from "@/lib/utils";
import { useAppContext } from "@/context/AppContext";

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={() => {
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }}
            className="flex items-center justify-center w-8 h-8 text-white/40 hover:text-white/80 transition-colors hover:bg-white/10 rounded-lg shrink-0"
            title="Copy message"
        >
            {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
    );
}

function ThinkingBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Auto-scroll inside the thinking block if streaming
    useEffect(() => {
        if (isStreaming && contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [text, isStreaming]);

    return (
        <div className="mb-4 bg-sidebar/50 border border-white/[0.05] rounded-xl overflow-hidden shadow-sm backdrop-blur-sm">
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-white/50" />
                    <span className="text-xs font-medium text-white/60 tracking-wider uppercase flex items-center gap-2">
                        {isStreaming ? "Thinking" : "Thought Process"}
                        {isStreaming && (
                            <div className="flex items-center gap-0.5 mt-1">
                                <motion.div animate={{ y: [0, -2, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }} className="w-1 h-1 bg-white/40 rounded-full" />
                                <motion.div animate={{ y: [0, -2, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }} className="w-1 h-1 bg-white/40 rounded-full" />
                                <motion.div animate={{ y: [0, -2, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }} className="w-1 h-1 bg-white/40 rounded-full" />
                            </div>
                        )}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <motion.div
                        animate={{ rotate: isExpanded ? 0 : -90 }}
                        className="text-white/40"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </motion.div>
                </div>
            </button>
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div
                            ref={contentRef}
                            className={cn(
                                "px-4 pb-4 pt-2 text-[14px] text-white/60 leading-relaxed font-mono whitespace-pre-wrap overflow-y-auto custom-scrollbar",
                                isStreaming ? "max-h-[300px]" : "max-h-[500px]"
                            )}
                        >
                            {text}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    images?: string[];
    thinking?: string;
    attachedDocs?: DatabaseDocument[];
}

interface DatabaseDocument {
    id: string;
    filename: string;
    storage_path: string;
    extracted_text?: string;
}

interface ChatAreaProps {
    user: User | null;
    activeThreadId: string | null;
    onThreadCreated: (id: string) => void;
    onThreadGeneratedTitle?: (thread: { id: string, title: string }) => void;
    openAuthModal: () => void;
}

export default function ChatArea({ user, activeThreadId, onThreadCreated, onThreadGeneratedTitle }: ChatAreaProps) {
    const { lastUsedMode, setLastUsedMode } = useAppContext();
    const [messages, setMessages] = useState<Message[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const isInitial = messages.length === 0;
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerImage, setViewerImage] = useState<{ src: string, prompt: string } | null>(null);

    const handleImageClick = (src: string, promptText: string) => {
        setViewerImage({ src, prompt: promptText });
        setViewerOpen(true);
    };

    const isStreamingRef = useRef(false);
    isStreamingRef.current = isStreaming;

    useEffect(() => {
        if (!activeThreadId) {
            setMessages([]);
            return;
        }

        if (isStreamingRef.current) {
            return;
        }

        const abortController = new AbortController();

        const fetchMessages = async () => {
            try {
                const { data, error } = await supabase
                    .from('threads')
                    .select('messages')
                    .eq('id', activeThreadId)
                    .abortSignal(abortController.signal)
                    .single();

                if (!abortController.signal.aborted && !isStreamingRef.current) {
                    if (data?.messages) {
                        setMessages(data.messages as Message[]);
                    } else if (error && error.name !== 'AbortError') {
                        console.error('Failed to fetch messages:', error);
                    }
                }
            } catch (err) {
                // Ignore abort errors
            }
        };

        fetchMessages();

        return () => {
            abortController.abort();
        };
    }, [activeThreadId]);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [showScrollBottom, setShowScrollBottom] = useState(false);
    const isAutoScrollEnabledRef = useRef(true);

    const handleScroll = () => {
        if (!scrollContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        // 50px threshold to determine if user is at the bottom
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceToBottom <= 50;

        isAutoScrollEnabledRef.current = isNearBottom;

        if (isNearBottom && showScrollBottom) {
            setShowScrollBottom(false);
        } else if (!isNearBottom && !showScrollBottom) {
            setShowScrollBottom(true);
        }
    };

    const lastAssistantMessageIndex = messages.map(m => m.role).lastIndexOf("assistant");

    // Smart auto-scroll execution: instantly sticks to bottom if user is already there.
    // Setting scrollTop directly absolutely guarantees no "fighting/stutter" during tokens.
    useEffect(() => {
        if (!isInitial && isAutoScrollEnabledRef.current && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        }
    }, [messages, isInitial]);

    const handleSubmit = async (text: string, model: string, attachedDocs: DatabaseDocument[], attachedImages: string[], think: boolean) => {
        isAutoScrollEnabledRef.current = true;

        // Clear ComfyUI VRAM if switching from image/tts to chat
        if (lastUsedMode && lastUsedMode !== "chat") {
            const { data: { session } } = await supabase.auth.getSession();
            fetch("/api/vram/clear", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(session?.access_token ? { "Authorization": `Bearer ${session.access_token}` } : {}) },
                body: JSON.stringify({ target: "comfyui" })
            }).catch(() => {});
        }
        setLastUsedMode("chat");

        // Add Document text context to the user's prompt if there are attached documents
        let fullContent = text;
        if (attachedDocs.length > 0) {
            fullContent += "\n\n";
            for (const doc of attachedDocs) {
                fullContent += `[Attached Document: ${doc.filename}]\n`;
            }
        }

        // Add User message
        const newMsgId = Date.now().toString();
        const userMsg: Message = {
            id: newMsgId,
            role: "user",
            content: text, // Only save text since docs are rendered separately now
            images: attachedImages && attachedImages.length > 0 ? attachedImages : undefined,
            attachedDocs: attachedDocs.length > 0 ? attachedDocs : undefined
        };
        const newMessagesContext = [...messages, userMsg];
        setMessages(newMessagesContext);

        isAutoScrollEnabledRef.current = true;
        setShowScrollBottom(false);
        setTimeout(() => {
            if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTo({
                    top: scrollContainerRef.current.scrollHeight,
                    behavior: "smooth"
                });
            }
        }, 50);

        let currentThreadId = activeThreadId;

        if (user) {
            if (!currentThreadId) {
                // Immediately save the user's first prompt as the temporary title
                const title = text.slice(0, 40) + (text.length > 40 ? "..." : "");

                // Optimistically tell the sidebar a thread was created so it switches tab IMMEDIATELY
                const tempNewId = Date.now().toString();
                currentThreadId = tempNewId;
                onThreadCreated(tempNewId);
                if (onThreadGeneratedTitle) {
                    onThreadGeneratedTitle({ id: tempNewId, title: title });
                }

                // Actually perform the DB insert in the background
                supabase
                    .from('threads')
                    .insert([{
                        user_id: user.id,
                        title: title,
                        session_type: 'chat',
                        model: model,
                        messages: newMessagesContext
                    }])
                    .select()
                    .single()
                    .then(({ data, error }) => {
                        if (data) {
                            // The true ID from the database
                            // We might need to handle ID reconciliation if doing complex optimistic UI, 
                            // but for now, since we only insert once at the start, updating the ref is fine.
                            currentThreadId = data.id;
                            onThreadCreated(data.id);
                        } else if (error) {
                            console.error("Failed to create thread in Supabase:", error);
                        }
                    });
            } else {
                await supabase
                    .from('threads')
                    .update({ messages: newMessagesContext })
                    .eq('id', currentThreadId);
            }
        } else {
            console.log("Anonymous session or no user. Skipping database save, running locally.");
        }

        // Real Assistant Streaming Response via Next.js Proxy
        const assistantId = (Date.now() + 1).toString();
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
        setIsStreaming(true);
        let responseText = "";

        try {
            // Setup AbortController for stopping generation
            abortControllerRef.current = new AbortController();

            // Transform for Ollama API
            const ollamaMessages = newMessagesContext.map(m => {
                const oMsg: { role: "user" | "assistant", content: string, images?: string[] } = { role: m.role, content: m.content };
                if (m.images) {
                    oMsg.images = m.images;
                }
                return oMsg;
            });

            // Aggregate all attached document IDs from the entire conversation history
            const allAttachedDocIds = Array.from(new Set(
                newMessagesContext.flatMap(msg => msg.attachedDocs?.map(doc => doc.id) || [])
            ));

            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const res = await fetch("/api/ollama/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                },
                signal: abortControllerRef.current.signal,
                body: JSON.stringify({
                    model: model,
                    messages: ollamaMessages,
                    stream: true,
                    think: think,
                    attachedDocIds: allAttachedDocIds
                }),
            });

            if (!res.ok) {
                throw new Error("Failed to get response");
            }

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            let thinkingText = "";

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(line => line.trim() !== '');

                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            let requiresUpdate = false;

                            if (parsed.message?.thinking) {
                                thinkingText += parsed.message.thinking;
                                requiresUpdate = true;
                            }
                            if (parsed.message?.content) {
                                responseText += parsed.message.content;
                                requiresUpdate = true;
                            }

                            if (requiresUpdate) {
                                setMessages((prev) =>
                                    prev.map((msg) =>
                                        msg.id === assistantId ? { ...msg, content: responseText, thinking: thinkingText } : msg
                                    )
                                );
                            }
                        } catch (e) {
                            console.error("Error parsing stream chunk", e);
                        }
                    }
                }
            }

            // Stream complete, save final message to DB
            if (currentThreadId && user) {
                const finalAssistantMsg: Message = { id: assistantId, role: "assistant", content: responseText, thinking: thinkingText };
                const finalMessages = [...newMessagesContext, finalAssistantMsg];
                await supabase
                    .from('threads')
                    .update({ messages: finalMessages })
                    .eq('id', currentThreadId);

                // If this is the very first exchange (1 user msg + 1 assistant msg), trigger auto-title generation
                if (finalMessages.length === 2 && onThreadGeneratedTitle) {
                    // Fire-and-forget background request to generate title
                    supabase.auth.getSession().then(({ data: { session } }) => {
                        const token = session?.access_token;
                        fetch('/api/threads/title', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                            },
                            body: JSON.stringify({
                                messages: finalMessages,
                                model: model,
                                chat_id: currentThreadId,
                                user_id: user.id
                            })
                        }).then(res => res.json()).then(data => {
                            if (data.title && currentThreadId) {
                                onThreadGeneratedTitle({ id: currentThreadId, title: data.title });
                            }
                        }).catch(err => console.error("Auto-title generation failed:", err));
                    });
                }
            }

        } catch (error: NodeJS.ErrnoException | unknown) {
            // Check if it's an AbortError safely
            const isAbortError = error instanceof Error && error.name === 'AbortError';

            if (isAbortError) {
                console.log("Stream aborted by user");

                // If the user aborted before getting any text, remove the empty assistant bubble
                if (!responseText.trim()) {
                    setMessages(prev => prev.filter(msg => msg.id !== assistantId));
                    return;
                }

                // The current partial message is already in state, just save it to DB
                if (currentThreadId && user) {
                    setMessages(currentMessages => {
                        const finalMessages = currentMessages;
                        supabase
                            .from('threads')
                            .update({ messages: finalMessages })
                            .eq('id', currentThreadId)
                            .then(({ error }) => {
                                if (error) console.error("Failed to save aborted thread state", error);
                            });
                        return finalMessages;
                    });
                }
            } else {
                console.error("Chat Error:", error);
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === assistantId ? { ...msg, content: "Sorry, I couldn't connect to Ollama right now." } : msg
                    )
                );
            }
        } finally {
            setIsStreaming(false);
            abortControllerRef.current = null;
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    };

    return (
        <div className="relative h-full w-full flex flex-col items-center overflow-hidden">
            {/* Background Glow when Initial */}
            <AnimatePresence>
                {isInitial && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none"
                    >
                        <div className="w-full h-full max-w-[800px] max-h-[800px]" />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Absolute Layout (to allow overlap) */}
            <div className="absolute inset-0 w-full h-full pointer-events-none">

                {/* Hero section */}
                <AnimatePresence>
                    {isInitial && (
                        <motion.div
                            key="hero"
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20, filter: "blur(10px)", scale: 0.95 }}
                            transition={{ duration: 0.4 }}
                            className="absolute inset-0 flex flex-col items-center justify-center z-10 pb-[15vh]"
                        >
                            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-white mb-3 text-center">
                                What can I help you with?
                            </h2>
                            <p className="text-white/40 text-[15px] max-w-xl text-center">
                                A premium, unified interface for all your intelligence needs.
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Messages Section - Extends full height, scrolls behind InputBar */}
                <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className={cn(
                        "absolute inset-0 w-full overflow-y-auto px-4 z-10 transition-all duration-500 pointer-events-auto custom-scrollbar",
                        isInitial ? "opacity-0 translate-y-4" : "opacity-100 translate-y-0"
                    )}>
                    <div className="max-w-3xl px-2 mx-auto flex flex-col gap-6 pt-16 pb-32">
                        <AnimatePresence initial={false}>
                            {messages.map((msg, idx) => (
                                <motion.div
                                    key={msg.id}
                                    initial={{ opacity: 0, y: 15, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    transition={{ type: "spring", stiffness: 200, damping: 20 }}
                                    className={cn(
                                        "flex w-full",
                                        msg.role === "user" ? "justify-end" : "justify-start"
                                    )}
                                >
                                    <div
                                        className={cn(
                                            msg.role === "user"
                                                ? "flex flex-col items-end gap-3 max-w-[85%]"
                                                : "w-full text-foreground/90 text-[15px] leading-relaxed group"
                                        )}
                                    >
                                        {msg.role === "assistant" && msg.content === "" && !msg.thinking ? (
                                            <div className="flex items-center gap-1 h-6 px-1">
                                                <motion.div
                                                    animate={{ y: [0, -5, 0] }}
                                                    transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                                                    className="w-1.5 h-1.5 bg-white/40 rounded-full"
                                                />
                                                <motion.div
                                                    animate={{ y: [0, -5, 0] }}
                                                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                                                    className="w-1.5 h-1.5 bg-white/40 rounded-full"
                                                />
                                                <motion.div
                                                    animate={{ y: [0, -5, 0] }}
                                                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                                                    className="w-1.5 h-1.5 bg-white/40 rounded-full"
                                                />
                                            </div>
                                        ) : msg.role === "user" ? (
                                            <>
                                                {msg.images && msg.images.length > 0 && (
                                                    <div className="flex gap-2 flex-wrap justify-end">
                                                        {msg.images.map((imgBase64, idx) => (
                                                            /* eslint-disable-next-line @next/next/no-img-element */
                                                            <div key={idx} className="relative group/media cursor-zoom-in rounded-xl overflow-hidden border border-white/10 shadow-sm transition-all hover:border-white/30" onClick={() => handleImageClick(`data:image/jpeg;base64,${imgBase64}`, "User uploaded image")}>
                                                                <img
                                                                    src={`data:image/jpeg;base64,${imgBase64}`}
                                                                    alt="user upload"
                                                                    className="h-32 w-auto min-w-32 object-cover"
                                                                />
                                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/media:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                                                    <div className="text-white/90 font-medium text-xs bg-black/50 px-2 py-1 rounded-md backdrop-blur-sm">View</div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {msg.attachedDocs && msg.attachedDocs.length > 0 && (
                                                    <div className="flex gap-2 flex-wrap justify-end">
                                                        {msg.attachedDocs.map((doc, idx) => (
                                                            <div key={idx} className="flex items-center gap-3 bg-white/[0.02] hover:bg-white/[0.04] transition-colors pl-3 pr-2 py-2 rounded-xl border border-white/5 shadow-sm min-w-[180px] group/doc">
                                                                <div className="p-2 bg-white/5 rounded-lg text-white/50 group-hover/doc:text-white/80 transition-colors">
                                                                    <FileText size={16} />
                                                                </div>
                                                                <div className="flex flex-col overflow-hidden flex-1">
                                                                    <span className="text-[13px] font-medium text-white/90 truncate">{doc.filename}</span>
                                                                    <span className="text-[11px] text-white/40 uppercase tracking-wider">Document</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {msg.content && (
                                                    <div className="px-5 py-3.5 rounded-2xl bg-white/[0.04] text-white text-[15px] leading-relaxed border border-white/[0.05]">
                                                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div className="flex flex-col w-full">
                                                {msg.thinking && (
                                                    <ThinkingBlock text={msg.thinking} isStreaming={isStreaming && idx === lastAssistantMessageIndex && !msg.content} />
                                                )}
                                                <div className="prose prose-invert max-w-none w-full prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-none prose-pre:shadow-none">
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm, remarkMath]}
                                                        rehypePlugins={[rehypeKatex]}
                                                        components={{
                                                            code({ node, className, children, ...props }: any) {
                                                                const match = /language-(\w+)/.exec(className || '');
                                                                const language = match ? match[1] : '';
                                                                const isInline = !match;

                                                                if (!isInline && match) {
                                                                    return (
                                                                        <div className="relative group/code rounded-xl overflow-hidden border border-white/10 shadow-lg">
                                                                            <div className="flex items-center justify-between pl-3 pr-1.5 py-1 bg-[#1A1A1A] border-b border-white/5">
                                                                                <span className="text-[11px] uppercase tracking-wider font-semibold text-white/40">{language}</span>
                                                                                <CopyButton text={String(children).replace(/\n$/, '')} />
                                                                            </div>
                                                                            <SyntaxHighlighter
                                                                                {...props}
                                                                                style={vscDarkPlus as any}
                                                                                language={language}
                                                                                PreTag="div"
                                                                                customStyle={{
                                                                                    margin: 0,
                                                                                    background: '#0D0D0D', // Very dark for code
                                                                                    padding: '1.25rem',
                                                                                    fontSize: '13px',
                                                                                    lineHeight: '1.6'
                                                                                }}
                                                                            >
                                                                                {String(children).replace(/\n$/, '')}
                                                                            </SyntaxHighlighter>
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <code className={cn("bg-white/[0.08] px-1.5 py-0.5 rounded-md text-[13px] font-mono text-white/90", className)} {...props}>
                                                                        {children}
                                                                    </code>
                                                                );
                                                            },
                                                            img({ node, src, alt, ...props }: any) {
                                                                if (!src) return null;
                                                                return (
                                                                    <div className="my-4 relative group/img inline-flex cursor-zoom-in rounded-xl overflow-hidden border border-white/10 shadow-sm hover:shadow-md transition-all hover:border-white/20 bg-black/20" onClick={() => handleImageClick(src, alt || "")}>
                                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                                        <img src={src} alt={alt || "Generated Image"} className="max-w-full sm:max-w-[400px] h-auto object-cover m-0" {...props} />
                                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col items-center justify-center pointer-events-none">
                                                                            <div className="text-white/90 font-medium text-xs bg-black/60 px-3 py-1.5 rounded-lg backdrop-blur-sm border border-white/10 shadow-lg translate-y-2 group-hover/img:translate-y-0 transition-transform">View Full Screen</div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            }
                                                        }}
                                                    >
                                                        {msg.content}
                                                    </ReactMarkdown>
                                                </div>
                                                <div className={cn(
                                                    "flex justify-start transition-opacity mt-2",
                                                    (msg.role === "assistant" && idx === lastAssistantMessageIndex && !isStreaming) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                                )}>
                                                    {!(isStreaming && idx === lastAssistantMessageIndex) && (
                                                        <CopyButton text={msg.content} />
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                        <div ref={messagesEndRef} className="h-4" />
                    </div>
                </div>

                {/* Scroll to Bottom Button */}
                <AnimatePresence>
                    {showScrollBottom && !isInitial && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.9 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.9 }}
                            className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 pointer-events-auto"
                        >
                            <button
                                onClick={() => {
                                    isAutoScrollEnabledRef.current = true;
                                    setShowScrollBottom(false);
                                    if (scrollContainerRef.current) {
                                        scrollContainerRef.current.scrollTo({
                                            top: scrollContainerRef.current.scrollHeight,
                                            behavior: "smooth"
                                        });
                                    }
                                }}
                                className="flex items-center justify-center p-2 rounded-full bg-sidebar/95 border border-white/5 text-muted-foreground hover:text-foreground shadow-sm transition-all"
                                title="Scroll to bottom"
                            >
                                <ArrowDown size={18} strokeWidth={2.5} />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Floating Input Bar */}
                <motion.div
                    layout
                    initial={false}
                    animate={{ bottom: isInitial ? "35%" : "0%" }}
                    transition={{ type: "spring", stiffness: 220, damping: 25, mass: 1 }}
                    className="absolute w-full z-20 px-4 flex justify-center pointer-events-none"
                >
                    <div className={cn(
                        "w-full max-w-3xl pb-8 relative pointer-events-auto bg-[#0a0a0a]",
                        !isInitial && "before:absolute before:inset-0 before:bg-transparent before:-z-10 before:pointer-events-none"
                    )}>
                        <div>
                            <InputBar
                                user={user}
                                onSubmit={handleSubmit}
                                isInitial={isInitial}
                                isStreaming={isStreaming}
                                onStop={handleStop}
                            />
                        </div>
                    </div>
                </motion.div>
            </div>
            <ImageViewer
                isOpen={viewerOpen}
                src={viewerImage?.src || null}
                prompt={viewerImage?.prompt}
                onClose={() => setViewerOpen(false)}
            />
        </div>
    );
}
