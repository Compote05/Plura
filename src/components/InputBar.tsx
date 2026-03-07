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
        if (!user || user.is_anonymous) return;

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

        if (docsToUpload.length > 0 && user && !user.is_anonymous) {
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
                    className="bg-sidebar/80 backdrop-blur-xl rounded-2xl relative flex flex-col group focus-within:ring-1 focus-within:ring-white/10 focus-within:bg-sidebar mx-auto w-full max-w-3xl border border-white/[0.08] shadow-sm"
                >
                    {/* Attachments Preview Area */}
                    {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-3 p-3 pb-0">
                            {attachments.map((attachment, idx) => (
                                <div key={idx} className="relative group/attachment flex items-center bg-black/20 rounded-xl overflow-hidden border border-white-[0.05] pr-2 shadow-inner">
                                    {attachment.preview ? (
                                        <div className="h-12 w-12 shrink-0 bg-black/50">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={attachment.preview} alt="preview" className="h-full w-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className="h-12 w-12 shrink-0 flex items-center justify-center bg-white/5">
                                            <FileText className="text-white/40" size={20} />
                                        </div>
                                    )}
                                    <div className="flex flex-col ml-3 mr-6 max-w-[120px]">
                                        <span className="text-xs text-white/90 truncate">{attachment.file.name}</span>
                                        {attachment.isUploading && (
                                            <span className="text-[10px] text-primary">Uploading...</span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeAttachment(attachment)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 bg-black/50 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-black/80 opacity-0 group-hover/attachment:opacity-100 transition-all"
                                    >
                                        &times;
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-end gap-1.5 w-full">
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            multiple
                            accept={isVisionSupported ? ".pdf,.docx,.pptx,.txt,.md,.csv,image/*" : ".pdf,.docx,.pptx,.txt,.md,.csv"}
                            onChange={handleFileSelect}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="ml-2 p-3 mr-1 text-white/40 hover:text-white/90 hover:bg-white/5 transition-colors shrink-0 rounded-full my-auto"
                        >
                            <Paperclip size={20} />
                        </button>

                        <textarea
                            ref={textareaRef}
                            value={value}
                            onChange={handleTextChange}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask anything..."
                            className="w-full max-h-[200px] bg-transparent outline-none border-none shadow-none focus:outline-none focus:ring-0 focus:border-transparent text-white placeholder:text-white/40 resize-none py-3.5 px-1 leading-relaxed"
                            rows={1}
                        />

                        <div className="flex items-center gap-2 p-1 shrink-0 my-auto pr-2">
                            <button
                                type="button"
                                onClick={() => setIsThinkingEnabled(!isThinkingEnabled)}
                                className={cn(
                                    "p-2.5 rounded-full transition-colors flex items-center gap-1.5",
                                    isThinkingEnabled
                                        ? "bg-white/10 text-white shadow-sm"
                                        : "text-white/40 hover:text-white/80 hover:bg-white/5"
                                )}
                                title="Toggle Reasoning (Think)"
                            >
                                <Brain size={18} strokeWidth={isThinkingEnabled ? 2.5 : 2} />
                            </button>
                            <div className="relative flex items-center text-white/40 hover:text-white/90 transition-colors">
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

                                <div className={cn(
                                    "flex items-center gap-1.5 pointer-events-none py-1 relative z-0",
                                    availableModels.length === 0 ? "opacity-50 text-red-400" : ""
                                )}>
                                    <Sparkles className="w-4 h-4 shrink-0" />
                                    <AnimatePresence>
                                        {!value && (
                                            <motion.span
                                                initial={{ opacity: 0, width: 0 }}
                                                animate={{ opacity: 1, width: "auto" }}
                                                exit={{ opacity: 0, width: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="text-sm font-medium whitespace-nowrap overflow-hidden"
                                            >
                                                {isLoadingModels ? "Loading models..." : (availableModels.length === 0 ? "No models available" : (availableModels.find(m => m.id === model)?.name || "Select Model"))}
                                            </motion.span>
                                        )}
                                    </AnimatePresence>
                                    {availableModels.length > 0 && <ChevronDown className="w-3.5 h-3.5 shrink-0" />}
                                </div>
                            </div>
                            {isStreaming ? (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (onStop) onStop();
                                    }}
                                    className="p-2.5 rounded-full flex items-center justify-center transition-all duration-200 bg-white text-black hover:bg-neutral-200 shadow-sm"
                                >
                                    <div className="w-3 h-3 rounded-[2px] bg-black" />
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!value.trim() || !model || attachments.some(a => a.isUploading)}
                                    className={cn(
                                        "p-2.5 rounded-full flex items-center justify-center transition-all duration-200",
                                        (value.trim() || (attachments.filter(a => a.file.type.startsWith('image/')).length > 0)) && model && !attachments.some(a => a.isUploading)
                                            ? "bg-white text-black hover:bg-neutral-200 shadow-sm"
                                            : "bg-white/[0.05] text-white/20 cursor-not-allowed"
                                    )}
                                >
                                    <ArrowUp size={18} strokeWidth={2.5} />
                                </button>
                            )}
                        </div>
                    </div>
                </form>
            </div>

        </motion.div>
    );
}
