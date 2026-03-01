import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const FLOWS = [
  {
    id: 'consent',
    label: 'consent grant',
    from: 'Human',
    to: 'BIP',
    desc: 'Human scopes what the agent can do — auth, captcha, session, payments. BIP enforces it.',
    color: '#05D96A',
  },
  {
    id: 'email',
    label: 'email auth',
    from: 'BIP',
    to: 'Website',
    desc: 'AgentMail provisions a real inbox. Verification emails are received and acted on autonomously.',
    color: '#00D9AA',
  },
  {
    id: 'captcha',
    label: 'captcha solve',
    from: 'BIP',
    to: 'Website',
    desc: 'hCaptcha challenges routed through BIP and resolved. Token returned in milliseconds.',
    color: '#00D9AA',
  },
  {
    id: 'session',
    label: 'session token',
    from: 'Website',
    to: 'BIP',
    desc: 'Session cookies and JWTs captured, stored, and rotated. Agent stays logged in indefinitely.',
    color: '#05D96A',
  },
  {
    id: 'x402',
    label: 'x402 payment',
    from: 'Agent',
    to: 'Endpoint',
    desc: 'Agent hits an endpoint. Server responds 402. BIP pays in-protocol. No form, no human.',
    color: '#05D96A',
  },
  {
    id: 'checkout',
    label: 'checkout pay',
    from: 'BIP',
    to: 'Website',
    desc: 'Browser Use fills checkout fields. Card number, CVV, expiry, zip. Visa processes it.',
    color: '#00D9AA',
  },
];

function FlowDot({ active, color }: { active: boolean; color: string }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full transition-all duration-500"
      style={{
        background: active ? color : 'rgba(255,255,255,0.12)',
        boxShadow: active ? `0 0 8px ${color}80` : 'none',
      }}
    />
  );
}

export default function Protocol() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeFlow, setActiveFlow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveFlow(prev => (prev + 1) % FLOWS.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.diagram-reveal', {
        y: 40,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.diagram-reveal', start: 'top 78%' },
      });
      gsap.from('.flow-item', {
        x: -20,
        opacity: 0,
        duration: 0.7,
        stagger: 0.1,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.flow-list', start: 'top 80%' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const active = FLOWS[activeFlow];

  return (
    <section
      id="protocol"
      ref={sectionRef}
      className="py-16 md:py-24 px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5"
    >
      <div className="max-w-[1100px] mx-auto">

        <div className="mb-8">
          <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-3">How it works</p>
          <h2
            className="font-sans font-light leading-none tracking-normal mb-3"
            style={{ fontSize: 'clamp(2.5rem, 5vw, 4rem)' }}
          >
            Auth and payments.
            <br />
            <span className="text-white/25">One runtime.</span>
          </h2>
          <p className="text-white/30 font-light max-w-lg leading-relaxed text-lg">
            Your agent calls BIP. BIP handles consent, email verification, captcha, sessions, and payments — then returns control. No integrations required.
          </p>
        </div>

        {/* 3-panel diagram */}
        <div className="diagram-reveal mb-8">
          <div className="border border-white/6 rounded-3xl overflow-hidden bg-white/[0.02]">
            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/6">

              {/* Agent */}
              <div className="p-8">
                <p className="font-mono text-sm text-white/40 tracking-[0.2em] mb-6">Agent</p>
                <div className="space-y-3">
                  {['request consent', 'trigger login', 'call tool', 'read session', 'pay checkout', 'pay x402'].map((cmd) => (
                    <div key={cmd} className="flex items-center gap-2.5">
                      <span className="font-mono text-sm text-white/30">$</span>
                      <span className="font-mono text-sm text-white/50">bip {cmd}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-8 pt-6 border-t border-white/6">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#05D96A] animate-pulse-slow" />
                    <span className="font-mono text-sm text-[#05D96A]/70">agent_id=my-agent</span>
                  </div>
                </div>
              </div>

              {/* BIP — center */}
              <div className="p-8 bg-white/[0.015]">
                <p className="font-mono text-sm text-white/40 tracking-[0.2em] mb-6">BIP Runtime</p>
                <div className="space-y-3">
                  {[
                    { label: 'Quota Enforcement', col: '#05D96A' },
                    { label: 'AgentMail Inbox', col: '#00D9AA' },
                    { label: 'hCaptcha Solver', col: '#00D9AA' },
                    { label: 'Session Store', col: '#05D96A' },
                    { label: 'x402 Payments', col: '#05D96A' },
                    { label: 'Checkout Fill', col: '#00D9AA' },
                  ].map(({ label, col }) => (
                    <div key={label} className="flex items-center gap-2.5">
                      <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: col }} />
                      <span className="font-mono text-sm text-white/40">{label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-8 pt-6 border-t border-white/6">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00D9AA] animate-pulse-slow" />
                    <span className="font-mono text-sm text-white/35">Convex · real-time</span>
                  </div>
                </div>
              </div>

              {/* Website */}
              <div className="p-8">
                <p className="font-mono text-sm text-white/40 tracking-[0.2em] mb-6">Website</p>
                <div className="space-y-3">
                  {['stripe.com', 'github.com', 'shopify.com', 'any-site.com'].map((site) => (
                    <div key={site} className="flex items-center gap-2.5">
                      <span className="w-1 h-1 rounded-full bg-white/15 flex-shrink-0" />
                      <span className="font-mono text-sm text-white/40">{site}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-8 pt-6 border-t border-white/6">
                  <span className="font-mono text-sm text-white/30">any web surface</span>
                </div>
              </div>

            </div>

            {/* Flow animation bar */}
            <div className="border-t border-white/6 px-6 py-5 flex flex-wrap items-center gap-4">
              <span className="font-mono text-sm text-white/30 tracking-[0.3em] w-24 flex-shrink-0">Active flow</span>
              <div className="flex items-center gap-2 flex-1">
                {FLOWS.map((f, i) => (
                  <React.Fragment key={f.id}>
                    <FlowDot active={i === activeFlow} color={f.color} />
                    {i < FLOWS.length - 1 && <div className="flex-1 h-px bg-white/6" />}
                  </React.Fragment>
                ))}
              </div>
              <div
                className="font-mono text-sm tracking-[0.2em] transition-all duration-500"
                style={{ color: active.color }}
              >
                {active.label}
              </div>
            </div>
          </div>
        </div>

        {/* Flow details grid */}
        <div className="flow-list grid grid-cols-1 md:grid-cols-2 gap-4">
          {FLOWS.map((flow, i) => (
            <div
              key={flow.id}
              className={`flow-item border rounded-2xl px-6 py-5 cursor-default transition-all duration-400 ${
                activeFlow === i ? 'border-white/15 bg-white/[0.03]' : 'border-white/5 bg-transparent'
              }`}
              onMouseEnter={() => setActiveFlow(i)}
            >
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="font-mono text-sm tracking-[0.2em] px-2.5 py-1 rounded-full"
                  style={{
                    color: flow.color,
                    background: flow.color + '15',
                    border: `1px solid ${flow.color}25`,
                  }}
                >
                  {flow.from} → {flow.to}
                </span>
              </div>
              <p className="font-mono text-sm text-white/35 tracking-[0.15em] mb-2">{flow.label}</p>
              <p className="text-white/40 text-base leading-relaxed font-light">{flow.desc}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
