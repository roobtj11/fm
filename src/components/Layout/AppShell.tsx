import { useState, useEffect, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ExternalLink, Github, Sparkles } from 'lucide-react';
import { useGameDataContext } from '../../context/GameDataContext';
import { useProfile } from '../../context/ProfileContext';
import { StatsSummaryPanel } from '../Profile/StatsSummaryPanel';
import { cn } from '../../lib/utils';
import { formatVersion } from '../../lib/formatVersion';
import { getAnvilTexturePath } from '../../utils/ascensionUtils';

const formatVersionDate = (version: string): string => {
    const parts = version.split('_');
    if (parts.length >= 3) {
        const year = parts[0];
        const monthIndex = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);

        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const monthName = monthNames[monthIndex] || parts[1];

        let suffix = 'th';
        if (day === 1 || day === 21 || day === 31) suffix = 'st';
        else if (day === 2 || day === 22) suffix = 'nd';
        else if (day === 3 || day === 23) suffix = 'rd';

        let dateStr = `${monthName} ${day}${suffix}, ${year}`;
        if (parts.length >= 5) {
            dateStr += ` at ${parts[3]}:${parts[4]}`;
        }
        return dateStr;
    }
    return version;
};

export default function AppShell() {
    const { selectedVersion, versions, isLoadingVersions } = useGameDataContext();
    const { profile } = useProfile();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isStatsOpen, setIsStatsOpen] = useState(false);
    const [showVersionPopup, setShowVersionPopup] = useState(false);
    const [popupVersion, setPopupVersion] = useState('');

    useEffect(() => {
        if (!isLoadingVersions && versions && versions.length > 0) {
            const latest = versions[0];
            const lastSeen = localStorage.getItem('fm_last_seen_config_version');
            if (lastSeen !== latest) {
                setPopupVersion(latest);
                setShowVersionPopup(true);
            }
        }
    }, [isLoadingVersions, versions]);

    const handleClosePopup = () => {
        localStorage.setItem('fm_last_seen_config_version', popupVersion);
        setShowVersionPopup(false);
    };

    const maxAgeVisuals = useMemo(() => {
        // profile.misc.forgeLevel is 0-indexed (0 = Lvl 1 in UI)
        const uiLevel = (profile.misc.forgeLevel || 0) + 1;

        // Determine max age index based on level (Thresholds from forgeData.ts)
        let ageIdx = 0;
        if (uiLevel >= 30) ageIdx = 9;
        else if (uiLevel >= 24) ageIdx = 8;
        else if (uiLevel >= 20) ageIdx = 7;
        else if (uiLevel >= 17) ageIdx = 6;
        else if (uiLevel >= 14) ageIdx = 5;
        else if (uiLevel >= 11) ageIdx = 4;
        else if (uiLevel >= 8) ageIdx = 3;
        else if (uiLevel >= 5) ageIdx = 2;
        else if (uiLevel >= 2) ageIdx = 1;
        else ageIdx = 0;

        const visuals = [
            { id: 'primitive', name: "Primitive", anim: "primitive-animation", bg: "bg-age-primitive", texture: "PrimitiveBackground.png" },
            { id: 'medieval', name: "Medieval", anim: "medieval-animation", bg: "bg-age-medieval", texture: "MedievalBackground.png" },
            { id: 'earlymodern', name: "Early-Modern", anim: "earlymodern-animation", bg: "bg-age-earlymodern", texture: "EarlyModernBackground.png" },
            { id: 'modern', name: "Modern", anim: "modern-animation", bg: "bg-age-modern", texture: "ModernBackground.png" },
            { id: 'space', name: "Space", anim: "space-animation", bg: "bg-age-space", texture: "SpaceBackground.png" },
            { id: 'interstellar', name: "Interstellar", anim: "interstellar-animation", bg: "bg-age-interstellar", texture: "InterstellarBackground.png" },
            { id: 'multiverse', name: "Multiverse", anim: "multiverse-animation", bg: "bg-age-multiverse", texture: "MultiverseBackground.png" },
            { id: 'quantum', name: "Quantum", anim: "quantum-animation", bg: "bg-age-quantum", texture: "QuantumBackground.png" },
            { id: 'underworld', name: "Underworld", anim: "underworld-animation", bg: "bg-age-underworld", texture: "UnderworldBackground.png" },
            { id: 'divine', name: "Divine", anim: "divine-animation", bg: "bg-age-divine", texture: "DivineBackground.png" },
        ];

        return visuals[ageIdx];
    }, [profile.misc.forgeLevel]);

    useEffect(() => {
        // Track visit frequency
        const visitCount = parseInt(localStorage.getItem('fm_visit_count') || '0') + 1;
        localStorage.setItem('fm_visit_count', visitCount.toString());

        const lastToastTime = parseInt(localStorage.getItem('fm_last_toast_time') || '0');
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        const userName = profile.name || 'Forge Master';
        const messages = FRIENDLY_MESSAGES(userName, !!profile.name);

        // Show toast if frequent visitor (every 3rd session/refresh) and it's been an hour
        if (visitCount > 1 && visitCount % 3 === 0 && (now - lastToastTime) > oneHour) {
            const randomMsg = messages[Math.floor(Math.random() * messages.length)];

            setTimeout(() => {
                toast(
                    <div className="flex flex-col gap-0.5 select-none">
                        <div className="font-black text-[10px] uppercase tracking-widest text-[#FFDD00] flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#FFDD00] animate-pulse" />
                            Support the Forge
                        </div>
                        <div className="font-bold text-sm leading-tight text-white">
                            {randomMsg}
                        </div>
                        <div className="text-[9px] mt-1 font-black uppercase text-white/40 flex items-center gap-1">
                            Click to support the developer <span className="animate-bounce text-xs">☕❤️</span>
                        </div>
                    </div>,
                    {
                        icon: <div className="text-xl">🛠️</div>,
                        autoClose: 10000,
                        position: "bottom-left",
                        onClick: () => window.open('https://www.buymeacoffee.com/1vcian', '_blank'),
                        className: "!bg-bg-secondary/90 !backdrop-blur-md !text-white border border-[#FFDD00]/30 shadow-[0_8px_32px_rgba(0,0,0,0.5)] cursor-pointer hover:border-[#FFDD00]/60 transition-all font-sans rounded-2xl",
                        progressClassName: "!bg-[#FFDD00]
    useEffect(() => {
        (window as any).__triggerUpdateModal = () => {
            const latest = versions[0] || "2026_07_03_12_39";
            setPopupVersion(latest);
            setShowVersionPopup(true);
        };
        return () => {
            delete (window as any).__triggerUpdateModal;
        };
    }, [versions]);

    return (
        <div className="flex h-screen bg-bg-primary text-text-primary overflow-hidden font-sans text-left">
            {/* Hover zone to open sidebar */}
            <div
                className="fixed top-0 left-0 bottom-0 w-4 z-[45] group cursor-pointer"
                onMouseEnter={() => setIsSidebarOpen(true)}
            >
                <div className="h-full w-full group-hover:bg-accent-primary/5 transition-colors" />
            </div>

            {/* Sidebar Navigation */}
            <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

            {/* Main Content Area */}
            <div className={cn(
                "flex-1 flex flex-col h-full overflow-hidden relative transition-all duration-500 ease-in-out",
                isStatsOpen && "lg:pr-[450px]"
            )}>
                {/* Header */}
                <Header
                    onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                    onStatsToggle={() => setIsStatsOpen(!isStatsOpen)}
                />

                {/* Page Content */}
                <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar pb-20">
                    <Outlet />

                    {/* Footer */}
                    <footer className="mt-12 py-6 border-t border-border text-center text-text-muted text-sm">
                        <div className="flex flex-col gap-2 items-center justify-center">
                            <p>Forge Master Calculator &copy; {new Date().getFullYear()}</p>
                            <div className="flex items-center justify-center gap-4">
                                <a
                                    href="https://1vcian.me"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-accent-primary hover:text-accent-secondary transition-colors"
                                >
                                    Visit My Website <ExternalLink className="w-3 h-3" />
                                </a>
                                <span className="text-border">|</span>
                                <a
                                    href="https://github.com/1vcian/fm"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-text-secondary hover:text-white transition-colors"
                                >
                                    GitHub <Github className="w-3 h-3" />
                                </a>
                            </div>
                            {selectedVersion && (
                                <div className="mt-2 text-xs opacity-70">
                                    Data Version: {formatVersion(selectedVersion)}
                                </div>
                            )}
                        </div>
                    </footer>
                </main>

                {/* Stats Drawer */}
                <div
                    className={cn(
                        "fixed inset-0 bg-black/60 backdrop-blur-md z-[60] transition-opacity duration-300 lg:hidden",
                        isStatsOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                    )}
                    onClick={() => setIsStatsOpen(false)}
                />
                <div
                    className={cn(
                        "fixed top-0 right-0 bottom-0 w-full sm:w-[450px] bg-bg-primary border-l border-border z-[70] transition-transform duration-500 ease-out shadow-2xl",
                        isStatsOpen ? "translate-x-0" : "translate-x-full"
                    )}
                >
                    <div className="h-full flex flex-col overflow-hidden">
                        <StatsSummaryPanel onClose={() => setIsStatsOpen(false)} />
                    </div>
                </div>

            </div>

            <AnimatePresence>
                {showVersionPopup && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            transition={{ type: "spring", duration: 0.5 }}
                            className="bg-bg-secondary/90 border border-accent-primary/20 p-6 md:p-8 rounded-3xl max-w-md w-full shadow-2xl relative overflow-hidden backdrop-blur-xl ring-1 ring-white/10 text-center"
                        >
                            {/* Decorative background glow */}
                            <div className="absolute -right-16 -top-16 w-36 h-36 bg-accent-primary/20 rounded-full blur-2xl pointer-events-none" />
                            <div className="absolute -left-16 -bottom-16 w-36 h-36 bg-yellow-500/10 rounded-full blur-2xl pointer-events-none" />

                            <div className="flex flex-col items-center gap-4 relative z-10">
                                <div className="w-20 h-20 rounded-full bg-accent-primary/10 border border-accent-primary/30 flex items-center justify-center p-3 shadow-[0_0_20px_rgba(235,94,40,0.15)] relative">
                                    <img
                                        src={getAnvilTexturePath(profile.misc.forgeAscensionLevel || 0, selectedVersion)}
                                        alt="Forge"
                                        className="w-full h-full object-contain"
                                    />
                                </div>

                                <h2 className="text-xl md:text-2xl font-black uppercase tracking-wide text-white flex items-center gap-2">
                                    <Sparkles className="w-5 h-5 text-yellow-400 animate-pulse" />
                                    Forge Master Updated!
                                    <Sparkles className="w-5 h-5 text-yellow-400 animate-pulse" />
                                </h2>

                                <div className="w-full h-px bg-white/10 my-1" />

                                <p className="text-sm text-text-primary leading-relaxed text-center">
                                    Hear ye, Hear ye! The server hamsters have successfully forged and integrated the latest game configurations! 🐹
                                </p>

                                <p className="text-xs text-text-muted leading-relaxed bg-black/20 p-3 rounded-xl border border-white/5 font-mono w-full text-center">
                                    Updated as of:<br />
                                    <span className="text-accent-primary font-bold text-sm block mt-1">
                                        {formatVersionDate(popupVersion)}
                                    </span>
                                </p>

                                <div className="text-xs text-text-muted text-center space-y-2 mt-1">
                                    <p>
                                        As you might have noticed, updates have been a bit slower lately. I've been extremely busy in my daily life recently, so I don't have much free time to actively code and implement new features. However, I will always do my best to keep the data updated for you all!
                                    </p>
                                    <p>
                                        Special thanks to all the amazing supporters who buy me coffee and keep the furnace hot! ☕
                                    </p>
                                    <p className="font-bold text-accent-primary mt-2">
                                        Much love, Lucian ❤️
                                    </p>
                                </div>

                                <button
                                    onClick={handleClosePopup}
                                    className={cn(
                                        "mt-4 w-full py-3.5 relative overflow-hidden text-white font-black uppercase tracking-wider rounded-2xl transition-all duration-300 hover:shadow-lg active:scale-95 text-sm select-none shadow-[0_4px_20px_rgba(0,0,0,0.3)]",
                                        maxAgeVisuals.bg
                                    )}
                                >
                                    {/* The animated age-based overlay */}
                                    <div
                                        className={cn(maxAgeVisuals.anim, "absolute inset-0 opacity-40 mix-blend-overlay pointer-events-none")}
                                        style={{
                                            '--theme-url': `url(${import.meta.env.BASE_URL}Texture2D/${selectedVersion ? `${selectedVersion}/` : ''}${maxAgeVisuals.texture})`
                                        } as React.CSSProperties}
                                    >
                                        {maxAgeVisuals.id === 'quantum' && Array.from({ length: 8 }).map((_, i) => (
                                            <span key={i} />
                                        ))}
                                    </div>

                                    <span className="relative z-10 text-white font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                                        Heck yeah, let's forge!
                                    </span>
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
