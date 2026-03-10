"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Paperclip, ChevronDown, Sparkles, FileText, Brain } from "lucide-react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface DatabaseDocument {
    id: string;
    filename: string;
    storage_path: string;
}

interface AttachedFile {
    file: File;
    preview?: string; // For images
    uploadedDoc?: DatabaseDocument; // If it's a document that got uploaded
    isUploading?: boolean;
}

interface InputBarProps {
    user?: User | null;
    onSubmit: (text: string, model: string, attachedDocs: DatabaseDocument[], attachedImages: string[], think: boolean) => void;
    onStop?: () => void;
    isInitial: boolean;
    isStreaming?: boolean;
}

// Removed static MODELS list as we will load dynamically

export default function InputBar({ user, onSubmit, isInitial, isStreaming, onStop }: InputBarProps) {
    const [value, setValue] = useState("");
    const [model, setModel] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<{ id: string, name: string }[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(true);
    const [isVisionSupported, setIsVisionSupported] = useState(false);
    const [isThinkingEnabled, setIsThinkingEnabled] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Attachments State
    const [attachments, setAttachments] = useState<AttachedFile[]>([]);

    // Mentions state
    const [documents, setDocuments] = useState<DatabaseDocument[]>([]);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionFilter, setMentionFilter] = useState("");
    const [attachedDocs, setAttachedDocs] = useState<DatabaseDocument[]>([]);

    useEffect(() => {
        if (!user) return;

        const fetchDocs = async () => {
            const { data } = await supabase
                .from('documents')
                .select('id, filename, storage_path')
                .eq('user_id', user.id);
            if (data) setDocuments(data);
        };
        fetchDocs();
    }, [user]);

    useEffect(() => {
        // Fetch Ollama models
        const fetchModels = async () => {
            setIsLoadingModels(true);
            try {
                // Ensure absolute URL if needed, but relative should work in Next.js
                // Add timestamp to prevent caching issues if any
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;

                const res = await fetch(`/api/ollama/tags?t=${Date.now()}`, {
                    headers: {
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.models && data.models.length > 0) {
                        interface ModelData {
                            name: string;
                        }
                        const formattedModels = data.models.map((m: ModelData) => ({
                            id: m.name,
                            name: m.name.split(':')[0]
                        }));
                        setAvailableModels(formattedModels);
                        // Try to load from localStorage first
                        const savedModel = localStorage.getItem("ai_hub_preferred_model");
                        const isValidSavedModel = formattedModels.find((m: { id: string, name: string }) => m.id === savedModel);

                        if (isValidSavedModel) {
                            setModel(savedModel);
                        } else if (!formattedModels.find((m: { id: string, name: string }) => m.id === model)) {
                            // Default to the first model if the current one isn't in the list
                            setModel(formattedModels[0].id);
                        }
                    } else {
                        setAvailableModels([]);
                        setModel(null);
                    }
                } else {
                    console.error("Tags proxy returned error:", res.status);
                    setAvailableModels([]);
                    setModel(null);
                }
            } catch (err) {
                console.error("Failed to load models list from proxy:", err);
                setAvailableModels([]);
                setModel(null);
            } finally {
                setIsLoadingModels(false);
            }
        };
        fetchModels();
    }, []);

    useEffect(() => {
        if (!model) {
            setIsVisionSupported(false);
            return;
        }

        let isMounted = true;

        const checkCapabilities = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token;

                const res = await fetch('/api/ollama/show', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({ model })
                });

                if (res.ok) {
                    const data = await res.json();

                    const hasVision =
                        data?.capabilities?.includes('vision') ||
                        data?.details?.capabilities?.includes('vision') ||
                        (data?.model_info && Object.keys(data.model_info).some(key => key.toLowerCase().includes('vision'))) ||
                        false;

                    if (isMounted) {
                        setIsVisionSupported(hasVision);
                        // Clear any attached images if vision is no longer supported
                        if (!hasVision) {
                            setAttachments(prev => prev.filter(a => !a.file.type.startsWith('image/')));
                        }
                    }
                }
            } catch (err) {
                console.error("Failed to check model capabilities:", err);
                if (isMounted) setIsVisionSupported(false);
            }
        };

        checkCapabilities();

        return () => {
            isMounted = false;
        };
    }, [model]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [value]);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setValue(val);

        // Detect @ mentions
        const words = val.split(" ");
        const lastWord = words[words.length - 1];

        if (lastWord.startsWith("@")) {
            setMentionFilter(lastWord.slice(1).toLowerCase());
            setShowMentions(true);
        } else {
            setShowMentions(false);
        }
    };

    const handleMentionSelect = (doc: DatabaseDocument) => {
        const words = value.split(" ");
        words.pop(); // remove the typing trigger
        setValue(words.join(" ") + (words.length > 0 ? " " : "") + `@${doc.filename} `);

        if (!attachedDocs.find(d => d.id === doc.id)) {
            setAttachedDocs([...attachedDocs, doc]);
        }

        setShowMentions(false);
        textareaRef.current?.focus();
    };

    const pollTaskStatus = async (taskId: string, token: string, docFile: File) => {
        const poll = async (): Promise<void> => {
            try {
                const res = await fetch(`/api/documents/upload?task_id=${taskId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return;

                const data = await res.json();

                if (data.status === 'completed' && data.document_id) {
                    if (!user) return;
                    const uploadedDoc: DatabaseDocument = {
                        id: data.document_id,
                        filename: data.filename,
                        storage_path: `${user.id}/files/${data.filename}`,
                    };

                    setAttachments(prev => prev.map(a =>
                        a.file === docFile ? { ...a, isUploading: false, uploadedDoc } : a
                    ));

                    setDocuments(prevDocs => {
                        if (!prevDocs.find(d => d.id === uploadedDoc.id)) {
                            return [...prevDocs, uploadedDoc];
                        }
                        return prevDocs;
                    });

                    setAttachedDocs(prev => {
                        if (!prev.find(d => d.id === uploadedDoc.id)) {
                            return [...prev, uploadedDoc];
                        }
                        return prev;
                    });
                } else if (data.status === 'failed') {
                    console.error("Document processing failed:", data.error);
                    setAttachments(prev => prev.map(a =>
                        a.file === docFile ? { ...a, isUploading: false } : a
                    ));
                } else {
                    // Still processing, poll again
                    setTimeout(poll, 3500);
                }
            } catch (err) {
                console.error("Error polling task status:", err);
                setAttachments(prev => prev.map(a =>
                    a.file === docFile ? { ...a, isUploading: false } : a
                ));
            }
        };

        // Start polling after a short delay
        setTimeout(poll, 1000);
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) return;

        const files = Array.from(e.target.files);
        if (fileInputRef.current) fileInputRef.current.value = "";

        const newAttachments: AttachedFile[] = [];

        for (const file of files) {
            if (file.type.startsWith('image/')) {
                if (!isVisionSupported) {
                    alert(`The model ${model} does not support vision/images.`);
                    continue;
                }
                const preview = URL.createObjectURL(file);
                newAttachments.push({ file, preview });
            } else {
                newAttachments.push({ file, isUploading: true });
            }
        }

        if (newAttachments.length === 0) return;

        setAttachments(prev => [...prev, ...newAttachments]);

        const docsToUpload = newAttachments.filter(a => !a.file.type.startsWith('image/'));

        if (docsToUpload.length > 0 && user) {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            if (!token) return;

            for (const doc of docsToUpload) {
                const formData = new FormData();
                formData.append("file", doc.file);

                try {
                    const res = await fetch('/api/documents/upload', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}` },
                        body: formData
                    });

                    if (res.ok) {
                        const data = await res.json();
                        if (data.task_id) {
                            // Start polling for completion
                            pollTaskStatus(data.task_id, token, doc.file);
                        }
                    } else {
                        console.error("Failed to upload document");
                        setAttachments(prev => prev.map(a =>
                            a.file === doc.file ? { ...a, isUploading: false } : a
                        ));
                    }
                } catch (err) {
                    console.error("Error uploading document:", err);
                    setAttachments(prev => prev.map(a =>
                        a.file === doc.file ? { ...a, isUploading: false } : a
                    ));
                }
            }
        } else if (docsToUpload.length > 0) {
            alert("You must be logged in to upload documents.");
            setAttachments(prev => prev.filter(a => !docsToUpload.includes(a)));
        }
    };

    const removeAttachment = (attachmentToRemove: AttachedFile) => {
        if (attachmentToRemove.preview) {
            URL.revokeObjectURL(attachmentToRemove.preview);
        }
        setAttachments(prev => prev.filter(a => a !== attachmentToRemove));

        if (attachmentToRemove.uploadedDoc) {
            setAttachedDocs(prev => prev.filter(d => d.id !== attachmentToRemove.uploadedDoc?.id));
        }
    };

    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const result = reader.result as string;
                // Remove the data:image/jpeg;base64, prefix for Ollama
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = error => reject(error);
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Block submit if documents are still uploading or if AI is currently streaming a response
        if (isStreaming || attachments.some(a => a.isUploading)) return;

        if (value.trim() && model) {
            // Process images
            const images = attachments.filter(a => a.file.type.startsWith('image/'));
            const base64Images: string[] = [];

            for (const img of images) {
                try {
                    const base64 = await fileToBase64(img.file);
                    base64Images.push(base64);
                } catch (e) {
                    console.error("Failed to process image:", e);
                }
            }

            onSubmit(value, model, attachedDocs, base64Images, isThinkingEnabled);
            setValue("");
            setAttachedDocs([]);
            setAttachments([]);
            if (textareaRef.current) {
                textareaRef.current.style.height = "auto";
            }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    };

    return (
        <motion.div
            layout
            initial={false}
            transition={{ type: "spring", bounce: 0, duration: 0.6 }}
            className={cn(
                "w-full max-w-3xl mx-auto",
                isInitial ? "mt-[2vh]" : "mt-0"
            )}
        >
            <div className="relative w-full shadow-lg">
                <AnimatePresence>
                    {showMentions && documents.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute bottom-full mb-3 left-0 w-64 bg-[#1E1E1E] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
                        >
                            <div className="px-3 py-2 border-b border-white/5 bg-white/[0.02]">
                                <span className="text-xs font-semibold tracking-wider text-white/40 uppercase">Select Document</span>
                            </div>
                            <div className="max-h-48 overflow-y-auto p-1">
                                {documents
                                    .filter(d => d.filename.toLowerCase().includes(mentionFilter))
                                    .map(doc => (
                                        <button
                                            key={doc.id}
                                            type="button"
                                            onClick={() => handleMentionSelect(doc)}
                                            className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors mb-0.5"
                                        >
                                            <FileText size={14} className="text-white/40 shrink-0" />
                                            <span className="text-sm text-white/90 truncate">{doc.filename}</span>
                                        </button>
                                    ))}
                                {documents.filter(d => d.filename.toLowerCase().includes(mentionFilter)).length === 0 && (
                                    <div className="px-3 py-4 text-center text-sm text-white/40">
                                        No documents found
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <form
                    onSubmit={handleSubmit}
                    className="bg-card border border-border rounded-xl flex flex-col p-2 gap-1 focus-within:border-foreground/15 transition-colors mx-auto w-full max-w-3xl"
                >
                    {/* Attachments */}
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-2 pt-1">
                            {attachments.map((attachment, idx) => (
                                <div key={idx} className="relative group/attachment flex items-center bg-black/20 rounded-lg overflow-hidden border border-white/5 pr-2">
                                    {attachment.preview ? (
                                        <div className="h-10 w-10 shrink-0 bg-black/50">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={attachment.preview} alt="preview" className="h-full w-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-white/5">
                                            <FileText className="text-white/40" size={16} />
                                        </div>
                                    )}
                                    <div className="flex flex-col ml-2 mr-5 max-w-[100px]">
                                        <span className="text-xs text-white/90 truncate">{attachment.file.name}</span>
                                        {attachment.isUploading && <span className="text-[10px] text-primary">Uploading...</span>}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeAttachment(attachment)}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 bg-black/50 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-black/80 opacity-0 group-hover/attachment:opacity-100 transition-all text-xs"
                                    >
                                        &times;
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Textarea */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        multiple
                        accept={isVisionSupported ? ".pdf,.docx,.pptx,.txt,.md,.csv,image/*" : ".pdf,.docx,.pptx,.txt,.md,.csv"}
                        onChange={handleFileSelect}
                    />
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={handleTextChange}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask anything..."
                        className="w-full max-h-[200px] bg-transparent outline-none border-none shadow-none focus:outline-none focus:ring-0 text-foreground placeholder:text-foreground/30 resize-none pt-1.5 pb-0.5 px-2 leading-relaxed text-sm"
                        rows={1}
                    />

                    {/* Controls row */}
                    <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-foreground/35 hover:text-foreground/65 hover:bg-accent transition-colors"
                                title="Attach file"
                            >
                                <Paperclip size={12} />
                            </button>

                            <button
                                type="button"
                                onClick={() => setIsThinkingEnabled(!isThinkingEnabled)}
                                className={cn(
                                    "flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-colors",
                                    isThinkingEnabled
                                        ? "text-foreground/70 bg-accent"
                                        : "text-foreground/35 hover:text-foreground/65 hover:bg-accent"
                                )}
                                title="Toggle Reasoning"
                            >
                                <Brain size={12} strokeWidth={isThinkingEnabled ? 2.2 : 1.8} />
                                <span>Think</span>
                            </button>

                            <div className="relative flex items-center text-foreground/35 hover:text-foreground/65 transition-colors rounded-lg px-2 py-1 cursor-pointer hover:bg-accent">
                                <select
                                    value={model || ""}
                                    onChange={(e) => {
                                        const newModel = e.target.value;
                                        setModel(newModel);
                                        localStorage.setItem("ai_hub_preferred_model", newModel);
                                    }}
                                    disabled={availableModels.length === 0}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                                >
                                    {availableModels.length === 0 ? (
                                        <option value="" disabled>No models found</option>
                                    ) : (
                                        availableModels.map((m) => (
                                            <option key={m.id} value={m.id} className="bg-sidebar text-sidebar-foreground">
                                                {m.name}
                                            </option>
                                        ))
                                    )}
                                </select>
                                <div className={cn("flex items-center gap-1.5 pointer-events-none text-xs", availableModels.length === 0 ? "opacity-50 text-red-400" : "")}>
                                    <Sparkles size={12} />
                                    <span className="max-w-[120px] truncate">
                                        {isLoadingModels ? "Loading..." : (availableModels.length === 0 ? "No models" : (availableModels.find(m => m.id === model)?.name || "Select"))}
                                    </span>
                                    {availableModels.length > 0 && <ChevronDown size={10} className="opacity-50" />}
                                </div>
                            </div>
                        </div>

                        {isStreaming ? (
                            <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); if (onStop) onStop(); }}
                                className="p-1.5 rounded-lg flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 transition-colors"
                            >
                                <div className="w-2.5 h-2.5 rounded-[2px] bg-background" />
                            </button>
                        ) : (
                            <button
                                type="submit"
                                disabled={!value.trim() || !model || attachments.some(a => a.isUploading)}
                                className={cn(
                                    "p-1.5 rounded-lg flex items-center justify-center transition-colors",
                                    (value.trim() || attachments.filter(a => a.file.type.startsWith('image/')).length > 0) && model && !attachments.some(a => a.isUploading)
                                        ? "bg-foreground text-background hover:bg-foreground/90"
                                        : "bg-foreground/6 text-foreground/20 cursor-not-allowed"
                                )}
                            >
                                <ArrowUp size={14} strokeWidth={2.5} />
                            </button>
                        )}
                    </div>
                </form>
            </div>

        </motion.div>
    );
}
