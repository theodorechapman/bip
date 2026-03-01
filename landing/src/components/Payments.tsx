import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/* ─── x402 flow visualizer ───────────────────────────────────────────────── */
function X402Flow() {
  const [step, setStep] = useState(1);

  const steps = [
    { from: 'Agent',   to: 'Endpoint',  msg: 'GET /api/resource',           col: '#FFFFFF', opacity: 0.4 },
    { from: 'Endpoint', to: 'Agent',   msg: '402 Payment Required',          col: '#05D96A', opacity: 0.9 },
    { from: 'Agent',   to: 'BIP',      msg: 'intent_create --rail x402',     col: '#00D9AA', opacity: 0.9 },
    { from: 'BIP',     to: 'Endpoint', msg: 'Payment-Payload: $0.50 USDC',   col: '#05D96A', opacity: 0.9 },
    { from: 'Endpoint', to: 'Agent',   msg: '200 OK · resource returned',    col: '#FFFFFF', opacity: 0.55 },
  ];

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const id = setInterval(() => {
      setStep(p => (p + 1) % (steps.length + 2));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const activeSteps = steps.slice(0, Math.min(step, steps.length));

  return (
    <div className="bg-[#040506] border border-white/5 rounded-2xl p-5 font-mono text-[13px]">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-1.5 h-1.5 rounded-full bg-[#05D96A] animate-pulse-slow" />
        <span className="text-[#05D96A]/50 tracking-[0.2em] text-sm">x402 flow · live</span>
      </div>
      <div className="space-y-2 min-h-[120px]">
        {activeSteps.map((s, i) => (
          <div key={i} className="flex items-center gap-2" style={{ opacity: s.opacity, color: s.col }}>
            <span className="w-16 text-right text-xs text-white/25 flex-shrink-0">{s.from}</span>
            <span className="text-white/15">to</span>
            <span className="w-16 text-xs text-white/25 flex-shrink-0">{s.to}</span>
            <span className="text-white/10 flex-shrink-0">│</span>
            <span className="truncate">{s.msg}</span>
          </div>
        ))}
        {step > steps.length && (
          <div className="pt-2 border-t border-white/5">
            <span className="text-[#05D96A]/60">done · no form, no human, no checkout</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Checkout fill visualizer ───────────────────────────────────────────── */
function CheckoutFlow() {
  const fields = [
    { label: 'Card Number', value: '4111 1111 1111 1111', col: '#00D9AA' },
    { label: 'CVV',         value: '···',                 col: '#00D9AA' },
    { label: 'Expiry',      value: '12/27',               col: '#00D9AA' },
    { label: 'Billing Zip', value: '94105',               col: '#00D9AA' },
  ];

  const [filled, setFilled] = useState(1);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const id = setInterval(() => {
      setFilled(p => (p >= fields.length ? 0 : p + 1));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="bg-[#040506] border border-white/5 rounded-2xl p-5 font-mono text-[13px]">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-1.5 h-1.5 rounded-full bg-[#00D9AA] animate-pulse-slow" />
        <span className="text-[#00D9AA]/50 tracking-[0.2em] text-sm">Checkout fill · Browser Use</span>
      </div>
      <div className="space-y-2.5">
        {fields.map((f, i) => (
          <div key={f.label} className="flex items-center gap-3">
            <span className="text-white/20 w-20 flex-shrink-0">{f.label}</span>
            <div className="flex-1 bg-white/4 rounded px-2.5 py-1.5 border border-white/5 relative overflow-hidden">
              <span
                className="transition-all duration-500"
                style={{
                  color: i < filled ? f.col : 'transparent',
                  opacity: i < filled ? 0.7 : 0,
                }}
              >
                {f.value}
              </span>
              {i === filled - 1 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#00D9AA]/40 text-[8px]">
                  ← filled
                </span>
              )}
            </div>
          </div>
        ))}
        {filled >= fields.length && (
          <div className="pt-2 border-t border-white/5">
            <span className="text-[#00D9AA]/60">done · order placed · real Visa · real money</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Era timeline ───────────────────────────────────────────────────────── */
const ERAS = [
  {
    year: '2026',
    label: 'Now',
    title: 'Checkout form filling',
    desc: 'Websites are built for humans. Browser Use fills card fields like a human would. A checkout form is just more fields. Real Visa, real transaction.',
    tag: 'Prepaid Visa · Browser Use',
    col: '#00D9AA',
    active: true,
  },
  {
    year: '2026–27',
    label: 'Emerging',
    title: 'x402 agent-native payments',
    desc: 'HTTP 402 becomes the agent payment primitive. Agent hits an endpoint, gets 402, BIP pays in-protocol. No form, no human flow. Machine-to-machine.',
    tag: 'x402 · USDC · A2A',
    col: '#05D96A',
    active: true,
  },
  {
    year: '2027+',
    label: 'Incoming',
    title: 'Agent payment endpoints everywhere',
    desc: 'Every website ships an agent-native payment endpoint alongside their human checkout. Visa TAP, Mastercard Agent Pay, on-chain settlement. BIP speaks all of them. Same agent call, BIP picks the right rail.',
    tag: 'Visa TAP · on-chain · native',
    col: '#FFFFFF',
    active: false,
  },
];

export default function Payments() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      gsap.from('.pay-header', {
        y: 40,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.pay-header', start: 'top 82%' },
      });
      gsap.from('.pay-cell', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.pay-flows', start: 'top 80%' },
      });
      gsap.from('.era-card', {
        x: -20,
        opacity: 0,
        duration: 0.7,
        stagger: 0.12,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.era-list', start: 'top 80%' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="payments"
      ref={sectionRef}
      className="py-16 md:py-24 px-6 sm:px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5"
    >
      <div className="max-w-[1100px] mx-auto">

        {/* Header */}
        <div className="pay-header mb-8">
          <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-3">Payments</p>
          <h2
            className="font-sans font-light leading-none tracking-normal mb-3"
            style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}
          >
            The web wasn't built for agents.
            <br />
            <span className="text-white/25">BIP pays anyway.</span>
          </h2>
          <p className="text-white/30 font-light max-w-lg leading-relaxed text-lg">
            Two payment modes. One for the legacy web — checkout form filling. One for the new web — x402 machine-to-machine. BIP picks the right one automatically.
          </p>
        </div>

        {/* Two flow visualizers */}
        <div className="pay-flows grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="pay-cell">
            <p className="font-mono text-sm text-white/30 tracking-[0.2em] mb-4">
              Mode 1 — x402 (Agent to Agent)
            </p>
            <X402Flow />
            <p className="text-white/25 text-base font-light mt-4 leading-relaxed">
              Agent hits an endpoint. Server responds 402. BIP pays in the HTTP layer. Resource returned.{' '}
              <span className="text-[#05D96A]/70">No form. No human. No checkout page.</span>{' '}
              The future of A2A payments.
            </p>
          </div>
          <div className="pay-cell">
            <p className="font-mono text-sm text-white/30 tracking-[0.2em] mb-4">
              Mode 2 — Checkout fill (Agent to Web)
            </p>
            <CheckoutFlow />
            <p className="text-white/25 text-base font-light mt-4 leading-relaxed">
              Browser Use locates the checkout form. BIP fills card number, CVV, expiry, zip.{' '}
              <span className="text-[#00D9AA]/70">A checkout form is just more fields.</span>{' '}
              Works on any site that accepts Visa. No integration required.
            </p>
          </div>
        </div>

        {/* Era timeline */}
        <div>
          <p className="font-mono text-sm text-white/30 tracking-[0.3em] mb-8">
            The three eras of agent payments
          </p>
          <div className="era-list space-y-4">
            {ERAS.map((era, i) => (
              <div
                key={era.year}
                className={`era-card border rounded-2xl px-6 py-5 transition-colors duration-300 ${
                  era.active ? 'border-white/10 bg-white/[0.02]' : 'border-white/5 bg-transparent'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start gap-4">
                  <div className="flex-shrink-0 w-24">
                    <p className="font-mono text-sm text-white/30 tracking-[0.15em]">{era.year}</p>
                    <p
                      className="font-mono text-sm tracking-[0.15em] mt-0.5"
                      style={{ color: era.col, opacity: era.active ? 0.7 : 0.3 }}
                    >
                      {era.label}
                    </p>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-sans font-light text-white text-lg"
                        style={{ opacity: era.active ? 1 : 0.3 }}
                      >
                        {era.title}
                      </h3>
                      <span
                        className="font-mono text-sm px-2.5 py-1 rounded-full border"
                        style={{
                          color: era.col,
                          borderColor: era.col + '30',
                          background: era.col + '10',
                          opacity: era.active ? 0.8 : 0.3,
                        }}
                      >
                        {era.tag}
                      </span>
                    </div>
                    <p className="text-white/30 text-base font-light leading-relaxed max-w-2xl"
                      style={{ opacity: era.active ? 1 : 0.5 }}
                    >
                      {era.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="font-mono text-sm text-white/15 mt-8 max-w-xl leading-relaxed">
            BIP's payments layer is an abstraction. Today it swaps between prepaid Visa and x402. Tomorrow it speaks Visa TAP, on-chain settlement, agent-native endpoints. The agent just calls{' '}
            <span className="text-white/30">bip intent_create</span>. BIP figures out the rail.
          </p>
        </div>

      </div>
    </section>
  );
}
