import React, { useEffect, useState } from 'react';
import { getNearestRestStops, POI } from '../../services/maps';
import { Button } from '../ui/Button';

// We'll use a simple placeholder map for the prototype if Leaflet is too heavy to setup in one go,
// but let's try to make a nice UI that *looks* like a map panel first.

interface MapPanelProps {
  isDrowsy: boolean;
}

export const MapPanel: React.FC<MapPanelProps> = ({ isDrowsy }) => {
  const [restStops, setRestStops] = useState<POI[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Mock location
    getNearestRestStops(40.7128, -74.0060).then(stops => {
      setRestStops(stops);
      setLoading(false);
    });
  }, []);

  return (
    <div className="bg-white rounded-2xl shadow-lg overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="font-semibold text-slate-700 flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.553-.894L15 7m0 13V7" />
          </svg>
          Navigation
        </h3>
        <span className="text-xs font-mono text-slate-500">GPS ACTIVE</span>
      </div>
      
      <div className="flex-1 bg-slate-100 relative">
        {/* Mock Map Visualization */}
        <div className="absolute inset-0 opacity-50 bg-[url('https://assets.codepen.io/6093409/map-placeholder.png')] bg-cover bg-center" />
        
        {/* Route Line Mock */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <path d="M 50 300 Q 150 150 300 50" stroke="#3b82f6" strokeWidth="4" fill="none" strokeDasharray="8 4" />
          <circle cx="50" cy="300" r="6" fill="#3b82f6" />
          <circle cx="300" cy="50" r="6" fill="#ef4444" />
        </svg>

        {/* Rest Stop Suggestions Overlay */}
        {isDrowsy && (
          <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur rounded-xl p-4 shadow-lg border-l-4 border-amber-500 animate-in slide-in-from-bottom-4">
            <h4 className="font-bold text-slate-800 mb-1">Rest Stop Suggested</h4>
            <p className="text-sm text-slate-600 mb-3">Nearest stop is {restStops[0]?.distance || '2 miles'} away.</p>
            <Button size="sm" className="w-full">
              Navigate to Rest Stop
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
