'use client';

import React from 'react';
import Link from 'next/link';
import { useAppContext } from '../../context/AppContext';
import { Button } from '../../components/ui/Button';

export default function SettingsPage() {
  const { settings, updateSettings, calibration, resetCalibration } = useAppContext();

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/monitor">
            <Button variant="ghost" size="sm">← Back</Button>
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        </div>

        <div className="space-y-6">
          {/* Sensitivity Section */}
          <section className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h2 className="text-xl font-semibold mb-4">Detection Sensitivity</h2>
            <div className="space-y-4">
              <div>
                <label className="flex justify-between text-sm font-medium text-slate-700 mb-2">
                  <span>Sensitivity Level</span>
                  <span>{Math.round(settings.sensitivity * 100)}%</span>
                </label>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.1"
                  value={settings.sensitivity}
                  onChange={(e) => updateSettings({ sensitivity: parseFloat(e.target.value) })}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Higher sensitivity means the alarm will trigger more easily.
                </p>
              </div>
            </div>
          </section>

          {/* Calibration Section */}
          <section className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h2 className="text-xl font-semibold mb-4">Calibration</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-900">Current Threshold</p>
                <p className="text-sm text-slate-500">EAR: {calibration.threshold.toFixed(3)}</p>
              </div>
              <Button variant="outline" onClick={resetCalibration}>
                Reset Calibration
              </Button>
            </div>
          </section>

          {/* Privacy Section */}
          <section className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h2 className="text-xl font-semibold mb-4">Privacy & Data</h2>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-medium text-slate-900">Telemetry</p>
                <p className="text-sm text-slate-500">Share anonymous usage statistics to help improve the model.</p>
              </div>
              <div className="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in">
                <input 
                  type="checkbox" 
                  name="toggle" 
                  id="toggle" 
                  checked={settings.telemetryEnabled}
                  onChange={(e) => updateSettings({ telemetryEnabled: e.target.checked })}
                  className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer"
                />
                <label 
                  htmlFor="toggle" 
                  className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer ${settings.telemetryEnabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                ></label>
              </div>
            </div>
            <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
              <p>
                <strong>Note:</strong> Video frames are processed entirely in your browser and are never sent to any server. 
                Only anonymous performance metrics (if enabled) are collected.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
