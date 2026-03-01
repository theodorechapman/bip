import React, { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import CardSwap, { Card } from './CardSwap';

gsap.registerPlugin(ScrollTrigger);

export default function Philosophy() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.from('.phil-q1', {
        y: 60,
        opacity: 0,
        duration: 1.2,
        ease: 'power4.out',
        scrollTrigger: { trigger: '.phil-q1', start: 'top 82%' },
      });
      gsap.from('.phil-q2', {
        y: 60,
        opacity: 0,
        duration: 1.2,
        ease: 'power4.out',
        delay: 0.12,
        scrollTrigger: { trigger: '.phil-q2', start: 'top 82%' },
      });
      gsap.from('.phil-body', {
        y: 30,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        delay: 0.2,
        scrollTrigger: { trigger: '.phil-body', start: 'top 85%' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="why-bip"
      ref={sectionRef}
      className="py-16 md:py-24 px-6 sm:px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5"
    >
      <div className="max-w-[960px] mx-auto">

        <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-8 flex items-center gap-3">
          <span className="w-6 h-px bg-white/15" />
          Why this layer must exist
        </p>

        {/* Q1 */}
        <div className="phil-q1 mb-12 pb-12 border-b border-white/6">
          <p className="font-mono text-sm text-white/30 tracking-[0.2em] mb-6">
            The old approach asks:
          </p>
          <p
            className="font-sans font-light leading-none tracking-normal"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 5.5rem)' }}
          >
            "Which integration<br />do we support?"
          </p>
        </div>

        {/* Q2 */}
        <div className="phil-q2 mb-14">
          <p className="font-mono text-sm text-[#05D96A]/60 tracking-[0.2em] mb-6">
            BIP asks:
          </p>
          <p
            className="font-sans font-light leading-none tracking-normal"
            style={{ fontSize: 'clamp(2.5rem, 6vw, 5.5rem)' }}
          >
            "What can't your<br />agent authenticate to?"
          </p>
        </div>

        {/* Body */}
        <div className="phil-body">
          <div className="flex flex-col lg:flex-row gap-12 lg:gap-20 items-start">

            {/* Left — text + stats */}
            <div className="flex-1 min-w-0">
              <p className="text-white/35 font-light leading-relaxed mb-10 text-lg max-w-lg">
                Auth0 and Composio handle{' '}
                <span className="text-white/55">500 known SaaS integrations</span>.
                That's the map. BIP operates off the map —{' '}
                <span className="text-[#05D96A]">any auth surface, any web presence, any flow</span>.
              </p>

              <div className="flex flex-wrap gap-4">
                {[
                  { n: '500',  label: 'Known integrations\n(covered by others)' },
                  { n: '∞',    label: 'Auth flows\nBIP can handle' },
                  { n: '3',    label: 'CLI commands to\nprovision an agent' },
                ].map((s) => (
                  <div key={s.n} className="border border-white/8 rounded-2xl px-5 py-4">
                    <p className="font-mono font-bold text-white text-2xl mb-1">{s.n}</p>
                    <p className="font-mono text-sm text-white/25 leading-snug whitespace-pre-line max-w-[120px]">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — card swap */}
            <div className="relative h-[420px] w-full lg:w-[520px] flex-shrink-0">
              <CardSwap
                width={500}
                height={320}
                cardDistance={56}
                verticalDistance={65}
                delay={4500}
                pauseOnHover={false}
                skewAmount={5}
              >
                <Card>
                  <div className="card-label">01 — consent</div>
                  <h3>Your agent gets<br />a real identity.</h3>
                  <p>Scoped permissions. Provisioned email. Session tokens. Everything a human gets, but for an agent.</p>
                  <div className="card-stat">
                    <span className="dot" style={{ background: '#05D96A' }} />
                    <span>agent_id provisioned · scope=full</span>
                  </div>
                </Card>
                <Card>
                  <div className="card-label">02 — auth</div>
                  <h3>Log in to anything.<br />No integrations.</h3>
                  <p>AgentMail receives verification emails. hCaptcha solves challenges. BIP captures the session. Any site.</p>
                  <div className="card-stat">
                    <span className="dot" style={{ background: '#00D9AA' }} />
                    <span>stripe.com · session active · 23h left</span>
                  </div>
                </Card>
                <Card>
                  <div className="card-label">03 — payments</div>
                  <h3>Pay like a human.<br />Think like a machine.</h3>
                  <p>x402 for agent-native endpoints. Checkout fill for everything else. One call, BIP picks the rail.</p>
                  <div className="card-stat">
                    <span className="dot" style={{ background: '#05D96A' }} />
                    <span>x402 · $0.50 USDC · 12ms</span>
                  </div>
                </Card>
              </CardSwap>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
