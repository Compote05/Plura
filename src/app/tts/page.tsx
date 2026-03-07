"use client";

import TTSArea from "@/components/TTSArea";
import { useAppContext } from "@/context/AppContext";

export default function TTSPage() {
    const { user } = useAppContext();
    return <TTSArea user={user} />;
}
