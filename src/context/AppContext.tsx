"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type ActiveMode = "chat" | "image_generation" | "text_to_speech";

interface AppContextType {
    user: User | null;
    activeThreadId: string | null;
    setActiveThreadId: (id: string | null) => void;
    renamedThread: { id: string; title: string } | null;
    setRenamedThread: (thread: { id: string; title: string } | null) => void;
    isAuthModalOpen: boolean;
    setIsAuthModalOpen: (isOpen: boolean) => void;
    isSettingsModalOpen: boolean;
    setIsSettingsModalOpen: (isOpen: boolean) => void;
    lastUsedMode: ActiveMode | null;
    setLastUsedMode: (mode: ActiveMode) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [renamedThread, setRenamedThread] = useState<{ id: string, title: string } | null>(null);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [lastUsedMode, setLastUsedMode] = useState<ActiveMode | null>(() => {
        if (typeof window === "undefined") return null;
        return (localStorage.getItem("lastUsedMode") as ActiveMode) || null;
    });

    const handleSetLastUsedMode = (mode: ActiveMode) => {
        setLastUsedMode(mode);
        localStorage.setItem("lastUsedMode", mode);
    };

    useEffect(() => {
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            if (session?.user) {
                setUser(session.user);
            }
        };

        initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null);
        });

        return () => subscription.unsubscribe();
    }, []);

    return (
        <AppContext.Provider value={{
            user, activeThreadId, setActiveThreadId, renamedThread, setRenamedThread,
            isAuthModalOpen, setIsAuthModalOpen, isSettingsModalOpen, setIsSettingsModalOpen,
            lastUsedMode, setLastUsedMode: handleSetLastUsedMode
        }}>
            {children}
        </AppContext.Provider>
    );
}

export function useAppContext() {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error("useAppContext must be used within an AppProvider");
    }
    return context;
}
