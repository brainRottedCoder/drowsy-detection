'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '../../components/ui/Button';

// This is the optional dedicated map page
export default function MapPage() {
  return (
    <div className="h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 p-4 flex items-center gap-4">
        <Link href="/monitor">
          <Button variant="ghost">← Back to Monitor</Button>
        </Link>
        <h1 className="font-bold text-lg">Navigation & Rest Stops</h1>
      </header>
      
      <div className="flex-1 bg-slate-100 relative flex items-center justify-center">
        <div className="text-center p-8">
          <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.553-.894L15 7m0 13V7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-700">Full Map View</h2>
          <p className="text-slate-500 mt-2">
            This page would contain the full Leaflet map integration.<br/>
            For the prototype, please use the map panel in the Monitor view.
          </p>
        </div>
      </div>
    </div>
  );
}
