"use client";

import DocumentsArea from "@/components/DocumentsArea";
import { useAppContext } from "@/context/AppContext";

export default function LibraryPage() {
    const { user } = useAppContext();
    return <DocumentsArea user={user} />;
}
