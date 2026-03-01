import React from 'react';

export default function MediaSection() {
  return (
    <section
      id="proof"
      className="py-16 md:py-24 px-6 sm:px-8 md:px-16 lg:px-24 bg-[#07080A] border-t border-white/5"
    >
      <div className="max-w-[860px] mx-auto">
        <p className="font-mono text-sm text-white/35 tracking-[0.3em] mb-3">proof in motion</p>
        <h2 className="font-sans font-light leading-none tracking-normal mb-8" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.8rem)' }}>
          looped checkout runtime
        </h2>

        <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/35 max-w-[780px] mx-auto">
          <img
            src="/media/bip-demo-loop-small.gif"
            alt="autonomous checkout demo"
            className="w-full h-auto bg-black block"
          />
        </div>
      </div>
    </section>
  );
}
