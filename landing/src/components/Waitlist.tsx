import React, { useState, useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ASCIIText from './ASCIIText';

gsap.registerPlugin(ScrollTrigger);

export default function Waitlist() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
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
    // client-side demo — swap for a real mutation when ready
    await new Promise(r => setTimeout(r, 700));
    setLoading(false);
    setSubmitted(true);
  };

  return (
    <section
      id="waitlist"
      ref={sectionRef}
      className="py-16 md:py-24 px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5"
    >
      <div className="waitlist-content max-w-[600px] mx-auto text-center">

        <div className="pointer-events-none relative h-[26vh] md:h-[30vh] mb-6">
          <ASCIIText
            text="bip"
            asciiFontSize={10}
            textFontSize={260}
            textColor="#fdf9f3"
            planeBaseHeight={10}
            enableWaves={true}
          />
        </div>

        <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-5">
          Early Access
        </p>

        <h2
          className="font-sans font-light leading-none tracking-normal mb-6"
          style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)' }}
        >
          {submitted ? "You're in." : 'Join the waitlist.'}
        </h2>

        <p className="text-white/30 font-light mb-12 leading-relaxed text-lg max-w-sm mx-auto">
          {submitted
            ? "We'll reach out when your agent slot is ready."
            : 'BIP is invite-only. Be first to provision your agent.'}
        </p>

        {!submitted ? (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto"
          >
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="agent@yourdomain.com"
              required
              className="flex-1 px-5 py-3 rounded-full bg-white/[0.04] border border-white/10 font-mono text-sm text-white placeholder:text-white/20 outline-none focus:border-white/25 focus:bg-white/[0.06] transition-all duration-200"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 rounded-full bg-white text-[#07080A] font-sans font-bold text-sm tracking-wide disabled:opacity-50 transition-opacity duration-200 whitespace-nowrap"
            >
              {loading ? 'Sending...' : 'Get access'}
            </button>
          </form>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <span className="w-2 h-2 rounded-full bg-[#05D96A] animate-pulse-slow" />
            <span className="font-mono text-[#05D96A] text-sm tracking-[0.25em]">
              Request received · Slot reserved
            </span>
          </div>
        )}

        {/* Social proof — quiet */}
        {!submitted && (
          <p className="font-mono text-xs text-white/25 tracking-[0.15em] mt-8">
            No spam. Access granted in order.
          </p>
        )}

      </div>
    </section>
  );
}
