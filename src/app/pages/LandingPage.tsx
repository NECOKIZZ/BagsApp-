import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router";
import { TrendingUp, Zap, Eye, Shield, ArrowRight, Terminal, Activity } from "lucide-react";

/* ─── Canvas Particle + Wave Background ─── */
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const particlesRef = useRef<Array<{
    x: number; y: number; vx: number; vy: number; radius: number; alpha: number;
  }>>([]);
  const wavesRef = useRef<Array<{
    y: number; amp: number; freq: number; speed: number; offset: number; alpha: number;
  }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Particles
    const PARTICLES = 150;
    const particles = particlesRef.current;
    particles.length = 0;
    for (let i = 0; i < PARTICLES; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        radius: Math.random() * 1.8 + 0.8,
        alpha: Math.random() * 0.4 + 0.15,
      });
    }

    // Flowing wave lines
    const waves = wavesRef.current;
    waves.length = 0;
    for (let i = 0; i < 12; i++) {
      waves.push({
        y: Math.random() * canvas.height,
        amp: Math.random() * 30 + 15,
        freq: Math.random() * 0.003 + 0.002,
        speed: Math.random() * 0.4 + 0.2,
        offset: Math.random() * Math.PI * 2,
        alpha: Math.random() * 0.06 + 0.03,
      });
    }

    const handleMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouse);

    let time = 0;
    let animId: number;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { x: mx, y: my } = mouseRef.current;
      const W = canvas.width;
      const H = canvas.height;

      // Draw flowing wave lines first (behind particles)
      for (let w = 0; w < waves.length; w++) {
        const wave = waves[w];
        wave.y += wave.speed * 0.3;
        if (wave.y > H + 50) wave.y = -50;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = wave.y + Math.sin(x * wave.freq + time * 0.01 + wave.offset) * wave.amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(0,212,255,${wave.alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 150 && dist > 0) {
          const force = (150 - dist) / 150;
          p.vx += (dx / dist) * force * 0.4;
          p.vy += (dy / dist) * force * 0.4;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy *= 0.985;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,255,163,${p.alpha})`;
        ctx.fill();
      }

      // Connections — capped distance for perf with 150 particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = dx * dx + dy * dy;
          if (d < 10000) {
            const dist = Math.sqrt(d);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(0,255,163,${0.06 * (1 - dist / 100)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      time++;
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouse);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}

/* ─── 3D Logo Card ─── */
function Logo3D() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [rotate, setRotate] = useState({ x: 0, y: 0 });

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setRotate({ x: y * -25, y: x * 25 });
  }, []);

  const onLeave = useCallback(() => setRotate({ x: 0, y: 0 }), []);

  return (
    <div
      ref={cardRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ perspective: 800 }}
      className="relative w-32 h-32 sm:w-40 sm:h-40 cursor-pointer"
    >
      <div
        className="w-full h-full flex items-center justify-center"
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
          transition: "transform 0.15s ease-out",
        }}
      >
        {/* Glow backing */}
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            background: "radial-gradient(circle, rgba(0,255,163,0.15) 0%, transparent 70%)",
            transform: "translateZ(-20px)",
          }}
        />
        {/* Card surface */}
        <div
          className="relative w-full h-full rounded-2xl flex items-center justify-center border border-[rgba(0,255,163,0.25)] overflow-hidden group/card"
          style={{
            background: "linear-gradient(135deg, rgba(0,255,163,0.08) 0%, rgba(11,15,23,0.9) 50%, rgba(0,212,255,0.05) 100%)",
            boxShadow: "0 0 40px rgba(0,255,163,0.1), inset 0 0 40px rgba(0,255,163,0.03)",
            transform: "translateZ(0)",
          }}
        >
          {/* Shimmer overlay */}
          <div
            className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{
              background: "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 55%, transparent 70%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.2s ease-in-out",
            }}
          />
          {/* Actual Delphi Logo */}
          <img
            src="/Delphi.svg"
            alt="Delphi"
            className="w-20 h-20 sm:w-24 sm:h-24 object-contain"
            style={{ transform: "translateZ(30px)", filter: "drop-shadow(0 0 12px rgba(0,255,163,0.3))" }}
          />
        </div>
        {/* Reflection */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.04) 45%, transparent 50%)",
            transform: "translateZ(1px)",
          }}
        />
      </div>
    </div>
  );
}

/* ─── Animated Counter ─── */
function useCountUp(target: number, duration = 2000) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setVal(Math.floor(eased * target));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, duration]);

  return { val, ref };
}

function StatItem({ value, suffix = "", prefix = "", label }: { value: number; suffix?: string; prefix?: string; label: string }) {
  const { val, ref } = useCountUp(value);
  return (
    <div ref={ref} className="text-center px-6">
      <div className="font-[Clash_Display] text-3xl sm:text-4xl font-medium text-white" style={{ letterSpacing: '0.03em', wordSpacing: '0.05em' }}>
        {prefix}{val.toLocaleString()}{suffix}
      </div>
      <div className="font-[JetBrains_Mono] text-xs sm:text-sm text-[#8b92a8] uppercase tracking-[0.2em] mt-2">
        {label}
      </div>
    </div>
  );
}

/* ─── Scroll Reveal Hook ─── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, visible };
}

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(40px)",
        transition: `opacity 0.8s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.8s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

/* ─── Sections ─── */
const FEATURES = [
  {
    icon: <Zap className="w-6 h-6" />,
    title: "SMART TREND TRACKER",
    desc: "Our AI watches top creators on X in real-time and spots the next big narrative before the crowd does.",
  },
  {
    icon: <TrendingUp className="w-6 h-6" />,
    title: "RANKED TOKEN LIST",
    desc: "Every token gets a simple 0-100 score based on market health, trading volume, liquidity, holder spread, and social buzz.",
  },
  {
    icon: <Terminal className="w-6 h-6" />,
    title: "ONE-CLICK LAUNCH",
    desc: "Launch your own token on Solana in under a minute. No coding needed — just name it, fund it, and go live.",
  },
  {
    icon: <Eye className="w-6 h-6" />,
    title: "LIVE MARKET CHECK",
    desc: "See real-time market cap, volume, liquidity, and how many people hold each token. Know what you are buying into.",
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "RUG PULL GUARD",
    desc: "We automatically check if a few wallets hold most of the supply or if the team has no socials. Red flags lower the score.",
  },
  {
    icon: <Activity className="w-6 h-6" />,
    title: "STAGE-BASED SCORING",
    desc: "New tokens, graduating tokens, and mature tokens are scored differently. Fair scoring no matter where a coin is in its journey.",
  },
];

const STEPS = [
  { num: "01", title: "TRACK", desc: "Connect your wallet. DELPHI watches top creators on X and uses AI to spot what is trending right now." },
  { num: "02", title: "SCORE", desc: "Our engine matches trends to real tokens and gives each one a clear 0-100 score so you know what is worth watching." },
  { num: "03", title: "LAUNCH", desc: "See a hot trend with no token yet? Launch one in seconds on Solana with a built-in price curve that grows as people buy." },
  { num: "04", title: "TRADE", desc: "Buy, sell, and track your tokens all in one place. Prices and scores refresh automatically in real-time." },
];

const POWERED_BY = [
  { name: "Bags", logo: "/platforms/bags.svg" },
  { name: "Jupiter", logo: "/platforms/jupiter.svg" },
  { name: "Helius", logo: "/platforms/helius.svg" },
  { name: "Solana", logo: "/platforms/solana.svg" },
  { name: "Claude", logo: "/platforms/claude.svg" },
  { name: "Gemini", logo: "/platforms/gemini.svg" },
  { name: "X API", logo: "/platforms/x.svg" },
];

function PoweredByMarquee() {
  const all = [...POWERED_BY, ...POWERED_BY];
  return (
    <section className="relative z-10 py-24 sm:py-32 overflow-hidden">
      <div className="max-w-[1280px] mx-auto px-6 mb-12 sm:mb-16">
        <Reveal className="text-center">
          <span className="font-[JetBrains_Mono] text-xs sm:text-sm text-[#00FFA3] uppercase tracking-[0.25em] block mb-6">
            // Powered By
          </span>
          <h2 className="font-[Clash_Display] text-[clamp(24px,3.5vw,44px)] font-medium text-white leading-tight" style={{ letterSpacing: '0.03em', wordSpacing: '0.08em' }}>
            The <span className="text-[#00FFA3]">Stack</span> Behind <span style={{ fontFamily: "'Press Start 2P', monospace" }}><span className="text-white">DEL</span><span className="text-[#00FFA3]">PHI</span></span>
          </h2>
        </Reveal>
      </div>

      {/* Fade masks */}
      <div
        className="relative"
        style={{
          maskImage: "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 10%, black 90%, transparent 100%)",
        }}
      >
        <div
          className="flex gap-6 w-max"
          style={{ animation: "marquee 30s linear infinite" }}
        >
          {all.map((item, i) => (
            <div
              key={i}
              className="flex-shrink-0 w-44 sm:w-52 h-28 sm:h-32 bg-[#0B0F17] border border-[#1a1f2e] rounded-sm flex items-center justify-center hover:border-[rgba(0,255,163,0.3)] hover:bg-[#0d1320] transition-all cursor-default"
            >
              <img src={item.logo} alt={item.name} className="h-16 sm:h-20 object-contain opacity-90" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative bg-[#05070B] text-white overflow-x-hidden">
      <ParticleCanvas />

      {/* Subtle grid overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-[1]"
        style={{
          backgroundImage: `linear-gradient(rgba(26,31,46,0.25) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(26,31,46,0.25) 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
        }}
      />

      {/* Scanline */}
      <div
        className="fixed top-0 left-0 right-0 h-[2px] pointer-events-none z-[50]"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(0,255,163,0.12), transparent)",
          animation: "scanline 8s linear infinite",
        }}
      />

      {/* ─── NAV ─── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
          scrolled ? "bg-[rgba(5,7,11,0.85)] backdrop-blur-xl border-b border-[rgba(26,31,46,0.6)]" : "bg-transparent"
        }`}
      >
        <div className="max-w-[1280px] mx-auto flex items-center justify-between px-6 sm:px-10 h-[72px]">
          <div className="flex items-center gap-3">
            <span
              className="text-xs sm:text-sm tracking-[0.15em]"
              style={{ fontFamily: "'Press Start 2P', monospace", textShadow: "0 0 12px rgba(0,255,163,0.5)" }}
            >
              <span className="text-white">DEL</span><span className="text-[#00FFA3]">PHI</span>
            </span>
          </div>
          <div className="flex items-center gap-6 sm:gap-8">
            <a href="#features" className="hidden sm:block font-[JetBrains_Mono] text-xs text-[#8b92a8] uppercase tracking-[0.15em] hover:text-[#00FFA3] transition-colors">
              Features
            </a>
            <a href="#how" className="hidden sm:block font-[JetBrains_Mono] text-xs text-[#8b92a8] uppercase tracking-[0.15em] hover:text-[#00FFA3] transition-colors">
              How It Works
            </a>
            <Link
              to="/feed"
              className="font-[JetBrains_Mono] text-xs sm:text-sm font-bold text-black bg-[#00FFA3] px-5 py-2.5 sm:px-6 sm:py-3 uppercase tracking-[0.15em] hover:bg-white hover:shadow-[0_0_20px_rgba(0,255,163,0.4)] transition-all"
            >
              Enter Terminal
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16">
        <Reveal className="flex flex-col items-center text-center">
          {/* 3D Logo */}
          <div className="mb-10">
            <Logo3D />
          </div>

          {/* Eyebrow */}
          <div className="flex items-center gap-3 mb-6">
            <span className="w-6 h-[1px] bg-[#00FFA3] opacity-50" />
            <span className="font-[JetBrains_Mono] text-xs sm:text-sm text-[#00FFA3] uppercase tracking-[0.25em]">
              Real-Time Trend & Token Terminal
            </span>
            <span className="w-6 h-[1px] bg-[#00FFA3] opacity-50" />
          </div>

          {/* Title — ONLY "DELPHI" uses pixel font, PHI in green */}
          <h1
            className="text-[clamp(32px,7vw,72px)] leading-[1.1] tracking-[6px] mb-4"
            style={{ fontFamily: "'Press Start 2P', monospace", textShadow: "0 0 60px rgba(0,255,163,0.15)" }}
          >
            <span className="text-white">DEL</span>
            <span className="text-[#00FFA3]">PHI</span>
          </h1>

          {/* Tagline — Clash Display */}
          <h2
            className="font-[Clash_Display] text-[clamp(12px,2vw,24px)] font-medium text-white/90 mb-6"
            style={{ textShadow: "0 0 30px rgba(0,255,163,0.1)", letterSpacing: '0.06em', wordSpacing: '0.12em' }}
          >
            1 SOL AND A DREAM
          </h2>

          {/* Description */}
          <p className="font-[Space_Grotesk] text-base sm:text-lg text-[#8b92a8] max-w-[600px] leading-[1.8] mb-10">
            Launch tokens, track what is trending, and trade the hottest plays — all in real-time from one place.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Link
              to="/tokenize"
              className="group font-[Clash_Display] text-xs sm:text-sm font-medium text-black bg-[#00FFA3] px-8 py-4 uppercase hover:bg-white hover:shadow-[0_0_40px_rgba(0,255,163,0.5)] transition-all flex items-center gap-3"
              style={{ letterSpacing: '0.2em', wordSpacing: '0.1em' }}
            >
              Launch Token
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/feed"
              className="font-[Clash_Display] text-xs sm:text-sm font-medium text-[#00FFA3] border border-[rgba(0,255,163,0.4)] px-8 py-[15px] uppercase hover:bg-[rgba(0,255,163,0.05)] hover:border-[#00FFA3] transition-all"
              style={{ letterSpacing: '0.2em', wordSpacing: '0.1em' }}
            >
              Enter Terminal
            </Link>
          </div>
        </Reveal>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-50">
          <span className="font-[JetBrains_Mono] text-[9px] text-[#8b92a8] uppercase tracking-[0.2em]">Scroll</span>
          <div className="w-[1px] h-6 bg-gradient-to-b from-[#00FFA3] to-transparent animate-pulse" />
        </div>
      </section>

      {/* ─── STATS BAR ─── */}
      <section className="relative z-10 border-y border-[#1a1f2e] bg-[rgba(11,15,23,0.6)]">
        <div className="max-w-[1280px] mx-auto py-14 sm:py-20 px-6 grid grid-cols-2 sm:grid-cols-4 gap-8 sm:gap-4">
          <StatItem value={10} label="Creators Monitored" />
          <StatItem value={6} label="Tokens Scored" />
          <StatItem value={3} label="Platforms Integrated" />
          <StatItem value={2} label="AI Engines" />
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="relative z-10 py-32 sm:py-44 px-6">
        <div className="max-w-[1280px] mx-auto">
          <Reveal className="text-center mb-20 sm:mb-28">
            <span className="font-[JetBrains_Mono] text-xs sm:text-sm text-[#00FFA3] uppercase tracking-[0.25em] block mb-6">
              // What You Get
            </span>
            <h2 className="font-[Clash_Display] text-[clamp(28px,4vw,52px)] font-medium text-white leading-tight" style={{ letterSpacing: '0.03em', wordSpacing: '0.08em' }}>
              Everything a <span className="text-[#00FFA3]">Degen</span> Needs
            </h2>
            <p className="font-[Space_Grotesk] text-[#a8b0c0] text-base sm:text-lg max-w-[520px] mx-auto mt-5 leading-relaxed">
              Every tool wrapped in a cinematic interface built for the speed of the chain.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[2px] bg-[#1a1f2e] border border-[#1a1f2e] rounded-sm overflow-hidden">
            {FEATURES.map((f, i) => (
              <Reveal key={i} delay={i * 0.08} className="bg-[#0B0F17] p-10 sm:p-14 group hover:bg-[#0d1320] transition-colors">
                <div className="w-12 h-12 rounded-lg bg-[rgba(0,255,163,0.08)] border border-[rgba(0,255,163,0.15)] flex items-center justify-center text-[#00FFA3] mb-8 group-hover:shadow-[0_0_20px_rgba(0,255,163,0.1)] transition-shadow">
                  {f.icon}
                </div>
                <h3 className="font-[Clash_Display] text-lg sm:text-xl font-medium text-white mb-5" style={{ letterSpacing: '0.04em', wordSpacing: '0.06em' }}>
                  {f.title}
                </h3>
                <p className="font-[Space_Grotesk] text-lg sm:text-xl text-[#a8b0c0] leading-relaxed">
                  {f.desc}
                </p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section id="how" className="relative z-10 py-32 sm:py-44 px-6">
        <div className="max-w-[1280px] mx-auto">
          <Reveal className="text-center mb-20 sm:mb-28">
            <span className="font-[JetBrains_Mono] text-xs sm:text-sm text-[#00FFA3] uppercase tracking-[0.25em] block mb-6">
              // How It Works
            </span>
            <h2 className="font-[Clash_Display] text-[clamp(28px,4vw,52px)] font-medium text-white leading-tight" style={{ letterSpacing: '0.03em', wordSpacing: '0.08em' }}>
              How It <span className="text-[#00FFA3]">Works</span>
            </h2>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[2px] bg-[#1a1f2e] border border-[#1a1f2e] rounded-sm overflow-hidden">
            {STEPS.map((s, i) => (
              <Reveal key={i} delay={i * 0.1} className="bg-[#0B0F17] p-10 sm:p-14 relative group hover:bg-[#0d1320] transition-colors">
                <div className="font-[Clash_Display] text-5xl sm:text-6xl font-medium text-white/50 leading-none mb-10" style={{ letterSpacing: '0.02em' }}>
                  {s.num}
                </div>
                <h3 className="font-[Clash_Display] text-base sm:text-lg font-medium text-[#00FFA3] mb-5 uppercase" style={{ letterSpacing: '0.1em', wordSpacing: '0.05em' }}>
                  {s.title}
                </h3>
                <p className="font-[Space_Grotesk] text-base text-[#a8b0c0] leading-relaxed">
                  {s.desc}
                </p>
                {/* Arrow */}
                {i < STEPS.length - 1 && (
                  <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-[#0B0F17] border border-[#1a1f2e] items-center justify-center z-10 text-[#00FFA3] text-xs">
                    →
                  </div>
                )}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TERMINAL PREVIEW ─── */}
      <section className="relative z-10 py-32 sm:py-44 px-6">
        <div className="max-w-[1280px] mx-auto">
          <Reveal className="text-center mb-16 sm:mb-24">
            <span className="font-[JetBrains_Mono] text-xs sm:text-sm text-[#00FFA3] uppercase tracking-[0.25em] block mb-6">
              // The Terminal
            </span>
            <h2 className="font-[Clash_Display] text-[clamp(28px,4vw,52px)] font-medium text-white leading-tight" style={{ letterSpacing: '0.03em', wordSpacing: '0.08em' }}>
              Your <span className="text-[#00FFA3]">Command Center</span>
            </h2>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="border border-[#1a1f2e] rounded-sm overflow-hidden bg-[#050709]">
              {/* Terminal bar */}
              <div className="flex items-center gap-2 px-5 py-3 bg-[rgba(26,31,46,0.4)] border-b border-[#1a1f2e]">
                <div className="w-3 h-3 rounded-full bg-[#EF4444]" />
                <div className="w-3 h-3 rounded-full bg-[#F59E0B]" />
                <div className="w-3 h-3 rounded-full bg-[#00FFA3] animate-pulse" />
                <span className="font-[JetBrains_Mono] text-[10px] text-[#8b92a8] ml-3 uppercase tracking-[0.15em]">
                  delphi-terminal — live feed
                </span>
              </div>
              {/* Terminal body */}
              <div className="p-8 sm:p-12 font-[JetBrains_Mono] text-xs sm:text-sm leading-loose">
                <div className="flex gap-3">
                  <span className="text-[#00FFA3] shrink-0">➜</span>
                  <span className="text-white">~</span>
                  <span className="text-[#8b92a8]">narrative-scan --source=x --creators=ansem,murad,kaito</span>
                </div>
                <div className="text-[#00D4FF] pl-7 mt-1">Scanning 3 creator feeds...</div>
                <div className="text-[#00D4FF] pl-7">Narrative extraction: AI agents + on-chain wallets</div>
                <div className="text-[#00FFA3] pl-7">✓ 4 tokens matched on Bags</div>
                <div className="text-[#00FFA3] pl-7">✓ 2 tokens matched on Jupiter</div>
                <div className="pl-7 mt-2 text-[#8b92a8]">---</div>
                <div className="flex gap-3 mt-2">
                  <span className="text-[#00FFA3] shrink-0">➜</span>
                  <span className="text-white">~</span>
                  <span className="text-[#8b92a8]">token-score --mint 7xKXtg... --full</span>
                </div>
                <div className="pl-7 mt-1 space-y-1">
                  <div className="flex justify-between max-w-[360px]">
                    <span className="text-[#8b92a8]">Market Cap</span>
                    <span className="text-white">$2.1M</span>
                  </div>
                  <div className="flex justify-between max-w-[360px]">
                    <span className="text-[#8b92a8]">Volume 24h</span>
                    <span className="text-white">$840K</span>
                  </div>
                  <div className="flex justify-between max-w-[360px]">
                    <span className="text-[#8b92a8]">Holders</span>
                    <span className="text-white">1,247</span>
                  </div>
                  <div className="flex justify-between max-w-[360px]">
                    <span className="text-[#8b92a8]">Scratch Score</span>
                    <span className="text-[#00FFA3] font-bold">88/100 — HOT</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-4">
                  <span className="text-[#00FFA3] shrink-0">➜</span>
                  <span className="text-white">~</span>
                  <span className="text-[#8b92a8]">_</span>
                  <span className="inline-block w-2 h-4 bg-[#00FFA3] animate-pulse align-middle" />
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <PoweredByMarquee />

      {/* ─── CTA ─── */}
      <section className="relative z-10 py-40 sm:py-52 px-6 text-center overflow-hidden">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(0,255,163,0.06) 0%, transparent 60%)",
            animation: "breathe 5s ease-in-out infinite",
          }}
        />
        <Reveal>
          <span className="font-[JetBrains_Mono] text-xs sm:text-sm text-[#00FFA3] uppercase tracking-[0.25em] block mb-6">
            // Start Your Journey
          </span>
          <h2 className="font-[Clash_Display] text-[clamp(28px,5vw,56px)] font-medium text-white leading-tight mb-6" style={{ letterSpacing: '0.03em', wordSpacing: '0.08em' }}>
            Ready to <span className="text-[#00FFA3]">Launch?</span>
          </h2>
          <p className="font-[Space_Grotesk] text-[#a8b0c0] text-base sm:text-lg max-w-[520px] mx-auto leading-[1.8] mb-12">
            Markets move fast. DELPHI keeps you ahead — tracking trends, scoring tokens, and spotting opportunities in real-time.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/tokenize"
              className="font-[Clash_Display] text-xs font-medium text-black bg-[#00FFA3] px-10 py-4 uppercase hover:bg-white hover:shadow-[0_0_40px_rgba(0,255,163,0.5)] transition-all"
              style={{ letterSpacing: '0.2em', wordSpacing: '0.1em' }}
            >
              Launch Token
            </Link>
            <Link
              to="/feed"
              className="font-[Clash_Display] text-xs font-medium text-[#00FFA3] border border-[rgba(0,255,163,0.4)] px-10 py-[15px] uppercase hover:bg-[rgba(0,255,163,0.05)] hover:border-[#00FFA3] transition-all"
              style={{ letterSpacing: '0.2em', wordSpacing: '0.1em' }}
            >
              Enter Terminal
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="relative z-10 border-t border-[#1a1f2e] bg-[rgba(5,7,11,0.8)] py-12 px-6">
        <div className="max-w-[1280px] mx-auto flex flex-col items-center gap-8">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span
              className="text-xs tracking-[0.15em]"
              style={{ fontFamily: "'Press Start 2P', monospace", textShadow: "0 0 8px rgba(0,255,163,0.4)" }}
            >
              <span className="text-white">DEL</span><span className="text-[#00FFA3]">PHI</span>
            </span>
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-8">
            <Link to="/feed" className="font-[JetBrains_Mono] text-xs text-[#8b92a8] uppercase tracking-[0.15em] hover:text-[#00FFA3] transition-colors">
              Feed
            </Link>
            <Link to="/profile" className="font-[JetBrains_Mono] text-xs text-[#8b92a8] uppercase tracking-[0.15em] hover:text-[#00FFA3] transition-colors">
              Portfolio
            </Link>
            <a href="#features" className="font-[JetBrains_Mono] text-xs text-[#8b92a8] uppercase tracking-[0.15em] hover:text-[#00FFA3] transition-colors">
              Features
            </a>
          </div>

          {/* Social links */}
          <div className="flex items-center gap-5">
            <a
              href="https://x.com/delphi"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-full border border-[#1a1f2e] flex items-center justify-center text-[#8b92a8] hover:text-[#00FFA3] hover:border-[rgba(0,255,163,0.3)] hover:bg-[rgba(0,255,163,0.05)] transition-all"
              aria-label="X (Twitter)"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a
              href="https://instagram.com/delphi"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-full border border-[#1a1f2e] flex items-center justify-center text-[#8b92a8] hover:text-[#00FFA3] hover:border-[rgba(0,255,163,0.3)] hover:bg-[rgba(0,255,163,0.05)] transition-all"
              aria-label="Instagram"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
            </a>
            <a
              href="https://github.com/delphi"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-full border border-[#1a1f2e] flex items-center justify-center text-[#8b92a8] hover:text-[#00FFA3] hover:border-[rgba(0,255,163,0.3)] hover:bg-[rgba(0,255,163,0.05)] transition-all"
              aria-label="GitHub"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.308.678.92.678 1.852 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z"/></svg>
            </a>
          </div>

          <span className="font-[JetBrains_Mono] text-[10px] text-[rgba(139,146,168,0.4)] tracking-[0.1em]">
            BUILT ON SOLANA
          </span>
        </div>
      </footer>

      {/* Global keyframe for scanline */}
      <style>{`
        @keyframes scanline {
          0% { top: -10%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 110%; opacity: 0; }
        }
        @keyframes breathe {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.15); }
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
