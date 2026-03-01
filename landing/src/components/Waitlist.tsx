import React, { useState, useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ASCIIText from './ASCIIText';

gsap.registerPlugin(ScrollTrigger);

export default function Waitlist() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.from('.waitlist-content', {
        y: 40,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.waitlist-content', start: 'top 78%' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('https://wonderful-goose-918.convex.site/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        setError('Something went wrong. Please try again.');
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      id="waitlist"
      ref={sectionRef}
      className="pt-20 pb-24 md:pt-28 md:pb-28 px-6 sm:px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5"
    >
      <div className="waitlist-content max-w-[1100px] mx-auto">
        <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-6 md:p-10">
          <div className="pointer-events-none absolute -top-24 right-[-4rem] h-56 w-56 rounded-full bg-[#05D96A]/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-[-3rem] h-52 w-52 rounded-full bg-[#00D9AA]/10 blur-3xl" />

          <div className="relative grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-8 md:gap-10 items-start">
            <div>
              <p className="font-mono text-sm text-white/40 tracking-[0.3em] mb-4">
                Early Access
              </p>
              <h2
                className="font-sans font-light leading-none tracking-normal mb-4"
                style={{ fontSize: 'clamp(2.2rem, 5vw, 4.1rem)' }}
              >
                {submitted ? "You're in." : 'Join the waitlist.'}
              </h2>
              <p className="text-white/35 font-light mb-6 leading-relaxed text-lg max-w-[38ch]">
                {submitted
                  ? "We'll reach out when your agent slot is ready."
                  : 'Limited cohorts. Start with real identity, stable sessions, and agent-native payments from day one.'}
              </p>

              <div className="pointer-events-none relative h-[150px] sm:h-[180px] md:h-[220px] max-w-[520px] mb-6" aria-hidden="true">
                <ASCIIText
                  text="bip"
                  asciiFontSize={8}
                  textFontSize={300}
                  textColor="#fdf9f3"
                  planeBaseHeight={12}
                  enableWaves={!reducedMotion}
                />
              </div>

              <div className="flex flex-wrap gap-2.5">
                {['real agent identity', 'session continuity', 'x402 + checkout'].map((pill) => (
                  <span
                    key={pill}
                    className="font-mono text-xs tracking-[0.14em] text-white/45 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03]"
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#040506]/85 p-5 md:p-6">
              {!submitted ? (
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-3"
                >
                  <label htmlFor="waitlist-email" className="sr-only">
                    Email address
                  </label>
                  <input
                    type="email"
                    id="waitlist-email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    name="email"
                    placeholder="agent@yourdomain.com"
                    required
                    aria-describedby="waitlist-description"
                    className="w-full px-5 py-3 rounded-full bg-white/[0.04] border border-white/10 font-mono text-sm text-white placeholder:text-white/20 outline-none focus:border-white/25 focus:bg-white/[0.06] transition-all duration-200"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-6 py-3 rounded-full bg-white text-[#07080A] font-sans font-bold text-sm tracking-wide disabled:opacity-50 transition-opacity duration-200"
                  >
                    {loading ? 'Sending...' : 'Get access'}
                  </button>
                  {error && (
                    <p className="font-mono text-xs text-red-400/80 tracking-[0.12em] text-center mt-2">
                      {error}
                    </p>
                  )}
                  <p id="waitlist-description" className="font-mono text-xs text-white/25 tracking-[0.12em] text-center mt-2">
                    No spam. Access granted in order.
                  </p>
                </form>
              ) : (
                <div className="py-7" role="status" aria-live="polite">
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <span className="w-2 h-2 rounded-full bg-[#05D96A] animate-pulse-slow" />
                    <span className="font-mono text-[#05D96A] text-sm tracking-[0.2em]">
                      Request received
                    </span>
                  </div>
                  <p className="text-white/40 text-center font-light">
                    Slot reserved. We will email you before the next cohort opens.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
