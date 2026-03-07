"use client";

import Sidebar from "@/components/Sidebar";
import AuthModal from "@/components/AuthModal";
import SettingsModal from "@/components/SettingsModal";
import { useAppContext } from "@/context/AppContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
    const { user, isAuthModalOpen, setIsAuthModalOpen, isSettingsModalOpen, setIsSettingsModalOpen } = useAppContext();

    return (
        <div className="flex h-screen w-full overflow-hidden bg-background relative">
            <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
            <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} userId={user?.id || null} />

            {/* Main Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <main className="flex-1 relative overflow-hidden">
                {children}
            </main>
        </div>
    );
}

