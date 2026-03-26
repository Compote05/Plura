"use client";

import { useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const WS_API_URL =
    typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WS_API_URL ?? "ws://localhost:8100")
        : "ws://localhost:8100";

interface UseVoiceInputOptions {
    onTranscript: (text: string) => void;
    onError?: (err: string) => void;
}

export function useVoiceInput({ onTranscript, onError }: UseVoiceInputOptions) {
    const [isListening, setIsListening] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const stop = useCallback(() => {
        processorRef.current?.disconnect();
        processorRef.current = null;
        audioCtxRef.current?.close();
        audioCtxRef.current = null;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        wsRef.current?.close();
        wsRef.current = null;
        setIsListening(false);
    }, []);

    const start = useCallback(async () => {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
            onError?.("Not authenticated");
            return;
        }

        const ws = new WebSocket(`${WS_API_URL}/ws/stt?token=${token}`);
        ws.binaryType = "arraybuffer";

        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data as string);
                if (data.type === "transcript" && data.text) {
                    onTranscript(data.text);
                }
            } catch {
                // ignore malformed message
            }
        };

        ws.onerror = () => {
            onError?.("WebSocket connection error");
            stop();
        };

        ws.onclose = () => setIsListening(false);

        wsRef.current = ws;

        let stream: MediaStream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
            onError?.("Microphone access denied");
            ws.close();
            return;
        }
        streamRef.current = stream;

        // 16kHz matches Silero VAD sample rate — no resampling needed on the server
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(stream);
        // 512 samples = exact chunk size expected by Silero VAD
        const processor = audioCtx.createScriptProcessor(512, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
            if (wsRef.current?.readyState !== WebSocket.OPEN) return;
            const pcm = e.inputBuffer.getChannelData(0);
            wsRef.current.send(pcm.buffer);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);

        setIsListening(true);
    }, [onTranscript, onError, stop]);

    const toggle = useCallback(() => {
        if (isListening) stop();
        else start();
    }, [isListening, start, stop]);

    return { isListening, toggle, stop };
}
