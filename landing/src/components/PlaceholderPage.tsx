import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from './Navbar';
import Footer from './Footer';

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="bg-[#07080A] min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-6 sm:px-8">
        <div className="text-center max-w-md">
          <h1
            className="font-sans font-light text-white mb-4"
            style={{ fontSize: 'clamp(2rem, 4vw, 3rem)' }}
          >
            {title}
          </h1>
          <p className="text-white/30 font-light text-lg mb-8">
            Coming soon.
          </p>
          <Link
            to="/"
            className="inline-block px-6 py-3 rounded-full border border-[#05D96A]/30 text-[#05D96A] font-mono text-sm hover:bg-[#05D96A]/10 transition-all duration-200"
          >
            back to home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
