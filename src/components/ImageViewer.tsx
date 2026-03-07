"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Copy, RefreshCw, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageViewerProps {
    isOpen: boolean;
    src: string | null;
    prompt?: string;
    onClose: () => void;
    onRegenerate?: () => void;
}

export default function ImageViewer({ isOpen, src, prompt, onClose, onRegenerate }: ImageViewerProps) {
    const [copied, setCopied] = useState(false);

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    // Prevent scrolling on body when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [isOpen]);

    const handleCopyPrompt = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (prompt) {
            navigator.clipboard.writeText(prompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!src) return;

        try {
            // If it's a blob/data URL or standard URL, try to fetch and force download
            const response = await fetch(src);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `generation-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error("Download failed:", error);
            // Fallback
            const link = document.createElement('a');
            link.href = src;
            link.download = `generation-${Date.now()}.png`;
            link.click();
        }
    };

    const handleRegenerate = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onRegenerate) {
            onRegenerate();
            onClose(); // Optional: close viewer on regenerate, or keep open. Let's close it so user sees the new generation in chat.
        }
    };

    return (
        <AnimatePresence>
            {isOpen && src && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/90 backdrop-blur-sm cursor-zoom-out"
                    />

                    {/* Close Button */}
                    <motion.button
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        onClick={onClose}
                        className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors z-10"
                        title="Close (Esc)"
                    >
                        <X size={20} strokeWidth={1.5} />
                    </motion.button>

                    {/* Image Container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 10 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="relative z-10 flex flex-col items-center justify-center max-w-[95vw] max-h-[95vh] pointer-events-none"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={src}
                            alt={prompt || "Generated image"}
                            className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl pointer-events-auto"
                            onClick={(e) => e.stopPropagation()}
                        />

                        {/* Actions Overlay / Bottom Bar */}
                        <div className="absolute -bottom-16 left-0 right-0 flex justify-center pointer-events-auto">
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 shadow-xl"
                            >
                                <button
                                    onClick={handleDownload}
                                    className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                    title="Download image"
                                >
                                    <Download size={18} strokeWidth={1.5} />
                                </button>

                                {prompt && (
                                    <>
                                        <div className="w-px h-4 bg-white/10 mx-1" />
                                        <button
                                            onClick={handleCopyPrompt}
                                            className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                            title="Copy prompt"
                                        >
                                            {copied ? <Check size={18} strokeWidth={1.5} /> : <Copy size={18} strokeWidth={1.5} />}
                                        </button>
                                    </>
                                )}

                                {onRegenerate && (
                                    <>
                                        <div className="w-px h-4 bg-white/10 mx-1" />
                                        <button
                                            onClick={handleRegenerate}
                                            className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                            title="Regenerate"
                                        >
                                            <RefreshCw size={18} strokeWidth={1.5} />
                                        </button>
                                    </>
                                )}
                            </motion.div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
