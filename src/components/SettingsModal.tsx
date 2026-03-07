"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { X, Save, AlertCircle } from "lucide-react";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    userId: string | null;
}

export default function SettingsModal({ isOpen, onClose, userId }: SettingsModalProps) {
    const [isAdmin, setIsAdmin] = useState(false);
    const [llmApi, setLlmApi] = useState("");
    const [imgenApi, setImgenApi] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    useEffect(() => {
        if (!isOpen) return;

        const fetchData = async () => {
            setIsLoading(true);
            setMessage(null);

            // 1. Check if user is Admin
            if (userId) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('id', userId)
                    .single();

                if (profile?.role === 'admin') {
                    setIsAdmin(true);
                } else {
                    setIsAdmin(false);
                }
            } else {
                setIsAdmin(false);
            }

            // 2. Fetch Global Settings
            try {
                // LLM
                const { data: llmData } = await supabase
                    .from('admin_settings')
                    .select('value')
                    .eq('key', 'llm_default_api')
                    .single();

                if (llmData && llmData.value?.url) {
                    setLlmApi(llmData.value.url);
                } else {
                    setLlmApi("http://localhost:11434");
                }

                // ImgGen
                const { data: imgData } = await supabase
                    .from('admin_settings')
                    .select('value')
                    .eq('key', 'imgen_default_api')
                    .single();

                if (imgData && imgData.value?.url) {
                    setImgenApi(imgData.value.url);
                } else {
                    setImgenApi("http://127.0.0.1:8000");
                }
            } catch (err) {
                console.error("Failed to load settings from DB", err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [isOpen, userId]);

    const handleSave = async () => {
        if (!isAdmin) return;
        setIsSaving(true);
        setMessage(null);

        try {
            // Upsert LLM
            await supabase.from('admin_settings').upsert({
                key: 'llm_default_api',
                value: { url: llmApi },
                description: 'Default Ollama/OpenAI compatible LLM API Root URL'
            });

            // Upsert ImgGen
            await supabase.from('admin_settings').upsert({
                key: 'imgen_default_api',
                value: { url: imgenApi },
                description: 'Default ComfyUI / Image Gen API Root URL'
            });

            setMessage({ text: "Settings saved successfully", type: 'success' });
            setTimeout(() => {
                setMessage(null);
                onClose();
            }, 1500);
        } catch (error) {
            console.error("Save error:", error);
            setMessage({ text: "Failed to save settings", type: 'error' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center pt-10 pb-10 pointer-events-auto">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="relative w-full max-w-lg bg-[#0A0A0A] border border-white/10 p-8 rounded-2xl shadow-2xl mx-4 flex flex-col"
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <div className="mb-6">
                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                Settings
                                {isAdmin && <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/20 font-bold ml-2">ADMIN</span>}
                            </h2>
                            <p className="text-sm text-white/50 mt-1">
                                {isAdmin
                                    ? "Configure global platform integrations and API routes."
                                    : "You are in Read-Only mode. Contact an administrator to change global settings."}
                            </p>
                        </div>

                        {isLoading ? (
                            <div className="flex-1 flex items-center justify-center py-12">
                                <div className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-5">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-white/80">
                                        LLM API URL
                                    </label>
                                    <input
                                        type="text"
                                        value={llmApi}
                                        onChange={(e) => setLlmApi(e.target.value)}
                                        disabled={!isAdmin}
                                        placeholder="http://localhost:11434"
                                        className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30 transition-colors disabled:opacity-50"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-white/80">
                                        Image Generation API URL
                                    </label>
                                    <input
                                        type="text"
                                        value={imgenApi}
                                        onChange={(e) => setImgenApi(e.target.value)}
                                        disabled={!isAdmin}
                                        placeholder="http://127.0.0.1:8000"
                                        className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-white/30 transition-colors disabled:opacity-50"
                                    />
                                </div>

                                {message && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}
                                        className={`flex items-start gap-2 p-3 rounded-lg text-sm mt-2 font-medium border ${message.type === 'success' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}
                                    >
                                        <AlertCircle size={16} className="mt-0.5 shrink-0" />
                                        {message.text}
                                    </motion.div>
                                )}

                                <div className="pt-4 mt-2 border-t border-white/10 flex justify-end gap-3">
                                    <button
                                        onClick={onClose}
                                        className="px-5 py-2.5 rounded-xl text-sm font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                                    >
                                        Close
                                    </button>
                                    {isAdmin && (
                                        <button
                                            onClick={handleSave}
                                            disabled={isSaving}
                                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-white text-black hover:bg-white/90 disabled:opacity-50 transition-colors"
                                        >
                                            {isSaving ? <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Save size={16} />}
                                            {isSaving ? 'Saving...' : 'Save Configuration'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
