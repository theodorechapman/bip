import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import ShaderCanvas from './ShaderCanvas';

export default function Hero() {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.from('.hero-line', {
        y: 32,
        opacity: 0,
        duration: 1.2,
        stagger: 0.15,
        ease: 'power3.out',
        delay: 0.3,
      });
    }, contentRef);
    return () => ctx.revert();
  }, []);

  return (
    <section id="hero" className="relative h-[100dvh] overflow-hidden bg-[#07080A]">
      {/* Shader background */}
      <div className="absolute inset-0">
        <ShaderCanvas className="w-full h-full" />
        {/* Dark base tint — kills brightness without hiding the shader */}
        <div className="absolute inset-0 bg-[#07080A]/55" />
        {/* Radial vignette — darkens edges, keeps center visible */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 80% 70% at 50% 50%, transparent 20%, rgba(7,8,10,0.65) 100%)' }}
        />
        {/* Bottom fade — pulls to bg color */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080A] via-[#07080A]/30 to-transparent" />
        {/* Top fade — keeps nav area readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#07080A]/60 via-transparent to-transparent" />
      </div>

      {/* Centered content */}
      <div ref={contentRef} className="relative z-10 h-full flex flex-col items-center justify-center px-6 sm:px-8 text-center">

        {/* Status indicator */}
        <p className="hero-line font-pixel text-sm text-white/40 tracking-[0.3em] mb-12 flex items-center gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#05D96A] animate-pulse-slow inline-block" />
          live
        </p>

        {/* Category statement — enormous, quiet */}
        <h1 className="hero-line max-w-4xl mb-8" style={{ lineHeight: 1.0 }}>
          <span
            className="block font-pixel text-white tracking-tight"
            style={{ fontSize: 'clamp(3.2rem, 7.5vw, 7rem)' }}
          >
            Identity, auth, and payments
          </span>
          <span
            className="block font-pixel text-white/30 tracking-tight"
            style={{ fontSize: 'clamp(3.2rem, 7.5vw, 7rem)' }}
          >
            infrastructure for agents.
          </span>
        </h1>

        {/* One-liner */}
        <p className="hero-line font-sans text-white/45 font-light max-w-lg mb-12 leading-relaxed text-xl">
          Real email. Real auth. Real sessions. x402 payments. Zero humans.
        </p>

        {/* 2 CTAs only */}
        <div className="hero-line flex items-center gap-4">
          <a
            href="#waitlist"
            className="btn-magnetic btn-slide px-7 py-3 bg-white text-[#07080A] rounded-full font-sans font-light text-sm tracking-wide"
          >
            Start provisioning
          </a>
          <a
            href="#payments"
            className="btn-magnetic px-7 py-3 border border-white/15 text-white/55 rounded-full font-sans font-light text-sm hover:border-white/30 hover:text-white/75 transition-all duration-300"
          >
            How it works
          </a>
        </div>

      </div>

      {/* Scroll hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/20">
        <span className="font-pixel text-xs tracking-[0.3em]">Scroll</span>
        <div className="w-px h-8 bg-gradient-to-b from-white/20 to-transparent" />
      </div>
    </section>
  );
}
