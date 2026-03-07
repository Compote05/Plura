"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Copy, RefreshCw, Check, Play, Pause, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioViewerProps {
    isOpen: boolean;
    src: string | null;
    prompt?: string;
    onClose: () => void;
    onRegenerate?: () => void;
}

export default function AudioViewer({ isOpen, src, prompt, onClose, onRegenerate }: AudioViewerProps) {
    const [copied, setCopied] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Play/pause based on prop
    useEffect(() => {
        if (isOpen && src && audioRef.current) {
            // Auto-play when opened
            audioRef.current.play().catch(console.error);
        } else if (!isOpen && audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setIsPlaying(false);
        }
    }, [isOpen, src]);

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
            // Fallback
            const link = document.createElement('a');
            link.href = src;
            link.download = `audio-${Date.now()}`;
            link.click();
        }
    };

    const handleRegenerate = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onRegenerate) {
            onRegenerate();
            onClose();
        }
    };

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

    const toggleMute = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (audioRef.current) {
            audioRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const handleEnd = () => {
        setIsPlaying(false);
        setProgress(0);
        if (audioRef.current) {
            audioRef.current.currentTime = 0;
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
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

                    {/* Audio Container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 10 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="relative z-10 flex flex-col items-center justify-center w-full max-w-2xl px-6 pointer-events-none"
                    >
                        {/* Native Audio (Hidden) */}
                        <audio
                            ref={audioRef}
                            src={src}
                            onPlay={() => setIsPlaying(true)}
                            onPause={() => setIsPlaying(false)}
                            onTimeUpdate={handleTimeUpdate}
                            onLoadedMetadata={handleLoadedMetadata}
                            onEnded={handleEnd}
                            className="hidden"
                        />

                        {/* Player UI */}
                        <div
                            className="w-full bg-[#111111] border border-white/10 p-6 rounded-3xl shadow-2xl pointer-events-auto flex flex-col gap-6"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Prompt/Title Display */}
                            <div className="text-center">
                                <h3 className="text-white/90 text-sm font-medium leading-relaxed max-w-lg mx-auto line-clamp-3">
                                    "{prompt || 'Generated Audio'}"
                                </h3>
                            </div>

                            {/* Waveform / Progress visualization */}
                            <div className="w-full flex items-center gap-4">
                                <span className="text-xs text-white/40 min-w-[36px] font-mono">
                                    {audioRef.current ? formatTime(audioRef.current.currentTime) : '0:00'}
                                </span>

                                <div
                                    className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden cursor-pointer relative group"
                                    onClick={(e) => {
                                        if (!audioRef.current || duration === 0) return;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        const x = e.clientX - rect.left;
                                        const percentage = x / rect.width;
                                        audioRef.current.currentTime = percentage * duration;
                                    }}
                                >
                                    <div
                                        className="h-full bg-emerald-500 rounded-full transition-all duration-100 ease-linear"
                                        style={{ width: `${progress}%` }}
                                    />
                                    {/* Hover indicator (optional) */}
                                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>

                                <span className="text-xs text-white/40 min-w-[36px] font-mono whitespace-nowrap">
                                    {formatTime(duration)}
                                </span>
                            </div>

                            {/* Main Controls */}
                            <div className="flex items-center justify-center gap-6">
                                <button
                                    onClick={toggleMute}
                                    className="p-3 text-white/50 hover:text-white hover:bg-white/5 rounded-full transition-colors"
                                >
                                    {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                                </button>

                                <button
                                    onClick={togglePlay}
                                    className="w-14 h-14 flex items-center justify-center bg-white text-black hover:bg-neutral-200 hover:scale-105 active:scale-95 rounded-full transition-all shadow-xl"
                                >
                                    {isPlaying ? (
                                        <Pause className="w-6 h-6 ml-0.5 fill-black" strokeWidth={0} />
                                    ) : (
                                        <Play className="w-6 h-6 ml-1.5 fill-black" strokeWidth={0} />
                                    )}
                                </button>

                                <div className="w-[44px]" /> {/* Spacer for balance */}
                            </div>
                        </div>

                        {/* Actions Bottom Bar */}
                        <div className="absolute -bottom-20 left-0 right-0 flex justify-center pointer-events-auto">
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-md border border-white/10 shadow-xl"
                            >
                                <button
                                    onClick={handleDownload}
                                    className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                                    title="Download audio"
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
