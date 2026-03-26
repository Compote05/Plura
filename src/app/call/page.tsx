"use client";

import { useRouter } from "next/navigation";
import CallArea from "@/components/CallArea";
import { useAppContext } from "@/context/AppContext";

export default function CallPage() {
    const { user } = useAppContext();
    const router = useRouter();
    return <CallArea isOpen={true} onClose={() => router.push("/chat")} user={user} />;
}
