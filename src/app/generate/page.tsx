"use client";

import ImageArea from "@/components/ImageArea";
import { useAppContext } from "@/context/AppContext";

export default function GeneratePage() {
    const { user } = useAppContext();
    return <ImageArea user={user} />;
}
