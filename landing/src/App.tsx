import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import TrustBar from './components/TrustBar';
import Features from './components/Features';
import Philosophy from './components/Philosophy';
import MediaSection from './components/MediaSection';
import Payments from './components/Payments';
import Waitlist from './components/Waitlist';
import Footer from './components/Footer';
import PlaceholderPage from './components/PlaceholderPage';
import DocsPage from './pages/DocsPage';

gsap.registerPlugin(ScrollTrigger);

function HomePage() {
  useEffect(() => {
    ScrollTrigger.refresh();
  }, []);

  return (
    <div className="bg-[#07080A] overflow-x-hidden relative">
      <a href="#hero" className="skip-link">
        skip to content
      </a>
      <main className="relative z-10">
        <Navbar />
        <Hero />
        <TrustBar />
        <Features />
        <Philosophy />
        <Payments />
        <MediaSection />
        <Waitlist />
        <Footer />
      </main>
    </div>
  );
}

const PLACEHOLDER_ROUTES = [
  { path: '/about', title: 'About' },
  { path: '/blog', title: 'Blog' },
  { path: '/careers', title: 'Careers' },
  { path: '/privacy', title: 'Privacy Policy' },
  { path: '/terms', title: 'Terms of Service' },
  { path: '/security', title: 'Security' },
];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/docs/api" element={<DocsPage />} />
        <Route path="/docs/cli" element={<DocsPage />} />
        {PLACEHOLDER_ROUTES.map(({ path, title }) => (
          <Route
            key={path}
            path={path}
            element={<PlaceholderPage title={title} />}
          />
        ))}
      </Routes>
    </BrowserRouter>
  );
}
