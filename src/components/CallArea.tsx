"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const WS_API_URL =
    typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WS_API_URL ?? "ws://localhost:8100")
        : "ws://localhost:8100";

type CallStatus = "connecting" | "listening" | "processing" | "speaking" | "error";

interface CallAreaProps {
    isOpen: boolean;
    onClose: () => void;
    user: User | null;
}

async function pollForAudio(promptId: string, token: string): Promise<string> {
    while (true) {
        await new Promise((r) => setTimeout(r, 800));
        const res = await fetch(`/api/tts/status?prompt_id=${promptId}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("TTS status error");
        const data = await res.json();
        if (data.status === "done" && data.audioUrl) return data.audioUrl;
        if (data.status === "error") throw new Error("TTS generation failed");
    }
}

export default function CallArea({ isOpen, onClose, user }: CallAreaProps) {
    const [status, setStatus] = useState<CallStatus>("connecting");
    const [errorMsg, setErrorMsg] = useState("");

    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
    const isSpeakingRef = useRef(false); // true while TTS audio plays → mute mic
    const statusRef = useRef<CallStatus>("connecting");

    useEffect(() => { statusRef.current = status; }, [status]);

    const stopRecording = useCallback(() => {
        workletNodeRef.current?.disconnect();
        workletNodeRef.current = null;
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        wsRef.current?.close();
        wsRef.current = null;
    }, []);

    // Full pipeline: text → Ollama → TTS → play
    const runPipeline = useCallback(async (transcript: string) => {
        const model = localStorage.getItem("ai_hub_preferred_model");
        if (!model) return;

        setStatus("processing");

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";

        // ── 1. Ollama ──────────────────────────────────────────────────────────
        let responseText = "";
        abortRef.current = new AbortController();

        try {
            const res = await fetch("/api/ollama/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                signal: abortRef.current.signal,
                body: JSON.stringify({
                    model,
                    // keep_alive: 0 tells Ollama to unload the model immediately after
                    // responding, freeing VRAM for the TTS model.
                    keep_alive: 0,
                    think: false,
                    messages: [
                        {
                            role: "system",
                            content:
                                "You are a voice assistant. Keep answers short and conversational — 1 to 3 sentences maximum. No markdown, no bullet points. Speak naturally.",
                        },
                        { role: "user", content: transcript },
                    ],
                    stream: true,
                }),
            });

            if (!res.ok) throw new Error("Ollama error");

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    for (const line of decoder.decode(value, { stream: true }).split("\n").filter(Boolean)) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message?.content) responseText += parsed.message.content;
                        } catch { }
                    }
                }
            }
        } catch (e: unknown) {
            if (e instanceof Error && e.name === "AbortError") return;
            if (statusRef.current !== "error") setStatus("listening");
            return;
        }

        if (!responseText.trim()) {
            setStatus("listening");
            return;
        }

        // ── 2. Submit TTS ──────────────────────────────────────────────────────
        let audioUrl = "";
        try {
            const ttsRes = await fetch("/api/tts/call", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ text: responseText }),
            });
            if (!ttsRes.ok) throw new Error("TTS submit error");
            const { prompt_id } = await ttsRes.json();
            audioUrl = await pollForAudio(prompt_id, token);
        } catch {
            // TTS failed — skip audio, go back to listening
            setStatus("listening");
            return;
        }

        // ── 3. Play audio ──────────────────────────────────────────────────────
        setStatus("speaking");
        isSpeakingRef.current = true;

        await new Promise<void>((resolve) => {
            const audio = new Audio(audioUrl);
            audioPlayerRef.current = audio;
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
            audio.play().catch(() => resolve());
        });

        isSpeakingRef.current = false;
        audioPlayerRef.current = null;

        if (statusRef.current !== "error" && wsRef.current?.readyState === WebSocket.OPEN) {
            setStatus("listening");
        }
    }, []);

    const startCall = useCallback(async () => {
        setStatus("connecting");
        setErrorMsg("");

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) { setErrorMsg("Sign in required."); return; }

        const ws = new WebSocket(`${WS_API_URL}/ws/stt?token=${token}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => setStatus("listening");

        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data as string);
                if (data.type === "error") {
                    setErrorMsg(data.message ?? "STT unavailable.");
                    stopRecording();
                    return;
                }
                // Ignore transcript if already processing/speaking
                if (data.type === "transcript" && data.text && statusRef.current === "listening") {
                    runPipeline(data.text);
                }
            } catch { }
        };

        ws.onerror = () => setErrorMsg("Connection failed.");
        ws.onclose = () => {
            if (statusRef.current !== "connecting" && statusRef.current !== "error") {
                setStatus("idle" as CallStatus);
            }
        };

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            setErrorMsg("Microphone access denied.");
            ws.close();
            return;
        }
        streamRef.current = stream;

        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;

        await audioCtx.audioWorklet.addModule("/worklets/audio-processor.js");
        const workletNode = new AudioWorkletNode(audioCtx, "audio-chunk-processor");
        workletNodeRef.current = workletNode;

        workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
            // Don't send audio while TTS is playing (avoid echo / duplicate triggers)
            if (isSpeakingRef.current) return;
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(e.data.buffer);
            }
        };

        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
    }, [runPipeline, stopRecording]);

    const handleClose = useCallback(() => {
        stopRecording();
        abortRef.current?.abort();
        audioPlayerRef.current?.pause();
        audioPlayerRef.current = null;
        isSpeakingRef.current = false;
        onClose();
    }, [stopRecording, onClose]);

    useEffect(() => {
        if (isOpen) {
            startCall();
        } else {
            stopRecording();
            abortRef.current?.abort();
            audioPlayerRef.current?.pause();
            isSpeakingRef.current = false;
        }
    }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    const isListening = status === "listening";
    const isSpeaking = status === "speaking";
    const isProcessing = status === "processing";

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0a]"
                >
                    {/* Blob — fixed-size container, only internal properties animate */}
                    <div className="w-64 h-64 flex items-center justify-center">
                        <div className="relative w-64 h-64 flex items-center justify-center">
                            {/* Glow */}
                            <motion.div
                                className="absolute rounded-full"
                                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)" }}
                                animate={(isListening || isSpeaking) ? {
                                    width: [220, 260, 220],
                                    height: [220, 260, 220],
                                } : { width: 180, height: 180 }}
                                transition={{ duration: isSpeaking ? 1.2 : 3, repeat: Infinity, ease: "easeInOut" }}
                            />

                            {/* Blob */}
                            <motion.div
                                className="w-32 h-32 bg-white"
                                animate={isListening ? {
                                    borderRadius: [
                                        "60% 40% 55% 45% / 50% 60% 40% 55%",
                                        "45% 55% 40% 60% / 60% 40% 55% 45%",
                                        "55% 45% 60% 40% / 45% 55% 50% 50%",
                                        "40% 60% 45% 55% / 55% 45% 60% 40%",
                                        "60% 40% 55% 45% / 50% 60% 40% 55%",
                                    ],
                                    scale: [1, 1.05, 0.97, 1.03, 1],
                                } : isSpeaking ? {
                                    borderRadius: [
                                        "50% 50% 45% 55% / 55% 45% 55% 45%",
                                        "55% 45% 55% 45% / 45% 55% 45% 55%",
                                        "45% 55% 50% 50% / 50% 50% 55% 45%",
                                        "50% 50% 55% 45% / 55% 45% 50% 50%",
                                        "50% 50% 45% 55% / 55% 45% 55% 45%",
                                    ],
                                    scale: [1, 1.08, 0.95, 1.06, 1],
                                } : isProcessing ? {
                                    borderRadius: ["50%", "45% 55% 50% 50% / 50% 45% 55% 50%", "50%"],
                                    scale: [0.6, 0.65, 0.6],
                                    opacity: [0.5, 0.7, 0.5],
                                } : {
                                    borderRadius: "50%",
                                    scale: 0.5,
                                    opacity: 0.12,
                                }}
                                transition={{
                                    duration: isSpeaking ? 1.4 : isListening ? 2.5 : 1.5,
                                    repeat: Infinity,
                                    ease: "easeInOut",
                                }}
                            />
                        </div>
                    </div>

                    {/* Status */}
                    <div className="h-8 flex items-center justify-center">
                        <AnimatePresence mode="wait">
                            <motion.p
                                key={status}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.2 }}
                                className="text-white/30 text-xs tracking-widest uppercase"
                            >
                                {status === "connecting" && "Connecting..."}
                                {status === "listening" && "Listening"}
                                {status === "processing" && "Thinking..."}
                                {status === "speaking" && "Speaking"}
                                {status === "error" && (errorMsg || "Error")}
                            </motion.p>
                        </AnimatePresence>
                    </div>

                    {/* End call — always fixed, never affected by blob */}
                    <div className="absolute bottom-16 left-1/2 -translate-x-1/2">
                        <button
                            onClick={handleClose}
                            className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-400 transition-colors flex items-center justify-center text-white shadow-xl"
                        >
                            <X size={22} />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
