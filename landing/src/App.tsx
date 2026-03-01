import React, { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import TrustBar from './components/TrustBar';
import Features from './components/Features';
import Philosophy from './components/Philosophy';
import CodeBlock from './components/CodeBlock';
import Payments from './components/Payments';
import Waitlist from './components/Waitlist';
import Footer from './components/Footer';

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  useEffect(() => {
    ScrollTrigger.refresh();
  }, []);

  return (
    <div className="bg-[#07080A] overflow-x-hidden relative">
      <main className="relative z-10">
        <Navbar />
        <Hero />
        <TrustBar />
        <Features />
        <Philosophy />
        <Payments />
        <CodeBlock />
        <Waitlist />
        <Footer />
      </main>
    </div>
  );
}
