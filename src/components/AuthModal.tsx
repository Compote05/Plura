"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/lib/supabase";
import { X } from "lucide-react";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-auto">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                    />

                    {/* Modal Content */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="relative w-full max-w-md bg-[#0A0A0A] border border-white/10 p-8 rounded-2xl shadow-2xl mx-4"
                    >
                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <div className="mb-8 text-center">
                            <h2 className="text-2xl font-bold text-white mb-2">Welcome to AI.HUB</h2>
                            <p className="text-sm text-white/50">
                                Sign in to sync your threads and unlock full access.
                            </p>
                        </div>

                        <div className="auth-container">
                            <Auth
                                supabaseClient={supabase}
                                appearance={{
                                    theme: ThemeSupa,
                                    variables: {
                                        default: {
                                            colors: {
                                                brand: '#ffffff',
                                                brandAccent: '#e5e5e5',
                                                brandButtonText: '#000000',
                                                defaultButtonBackground: '#1A1A1A',
                                                defaultButtonBackgroundHover: '#2A2A2A',
                                                defaultButtonBorder: '#333333',
                                                defaultButtonText: '#ffffff',
                                                dividerBackground: '#333333',
                                                inputBackground: '#1A1A1A',
                                                inputBorder: '#333333',
                                                inputBorderHover: '#555555',
                                                inputBorderFocus: '#ffffff',
                                                inputText: '#ffffff',
                                                inputPlaceholder: '#666666',
                                                messageText: '#ffffff',
                                                messageTextDanger: '#ef4444',
                                                anchorTextColor: '#a3a3a3',
                                                anchorTextHoverColor: '#ffffff',
                                            },
                                            space: {
                                                buttonPadding: '12px 16px',
                                                inputPadding: '12px 16px',
                                            },
                                            borderWidths: {
                                                buttonBorderWidth: '1px',
                                                inputBorderWidth: '1px',
                                            },
                                            radii: {
                                                borderRadiusButton: '12px',
                                                buttonBorderRadius: '12px',
                                                inputBorderRadius: '12px',
                                            },
                                        },
                                        dark: {
                                            colors: {
                                                brandButtonText: '#000000',
                                            },
                                        },
                                    },
                                    className: {
                                        container: 'w-full',
                                        button: 'transition-colors duration-200 font-medium',
                                        input: 'transition-colors duration-200 focus:ring-0',
                                    }
                                }}
                                theme="dark"
                                providers={[]} // Add 'google', 'github' etc. later if configured
                            />
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
