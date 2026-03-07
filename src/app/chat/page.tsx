"use client";

import ChatArea from "@/components/ChatArea";
import { useAppContext } from "@/context/AppContext";

export default function ChatPage() {
    const { user, activeThreadId, setActiveThreadId, setRenamedThread, setIsAuthModalOpen } = useAppContext();

    return (
        <ChatArea
            user={user}
            activeThreadId={activeThreadId}
            onThreadCreated={setActiveThreadId}
            onThreadGeneratedTitle={setRenamedThread}
            openAuthModal={() => setIsAuthModalOpen(true)}
        />
    );
}
