'use client';

import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { useAppContext } from '../../context/AppContext';

export const SignInPanel: React.FC = () => {
  const { signIn, users, switchUser, deleteUser } = useAppContext();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    const result = signIn(name);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName('');
  };

  return (
    <div className="w-full max-w-md mx-auto text-left">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-1">Sign in</h2>
        <p className="text-sm text-slate-500 mb-4">
          Enter your name to load or create a local profile. Settings and face calibration are saved per name on this device.
        </p>

        <form onSubmit={handleContinue} className="space-y-3">
          <label className="block text-sm font-medium text-slate-700" htmlFor="profile-name">
            Name
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={e => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder="e.g. Shubh"
            autoComplete="username"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={32}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full" size="lg">
            Continue
          </Button>
        </form>

        {users.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Existing profiles
            </p>
            <ul className="space-y-2">
              {users.map(user => (
                <li
                  key={user.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <button
                    type="button"
                    className="text-left text-sm font-medium text-slate-800 hover:text-blue-600 flex-1"
                    onClick={() => switchUser(user.id)}
                  >
                    {user.displayName}
                    {user.calibration.isCalibrated && (
                      <span className="ml-2 text-xs font-normal text-emerald-600">calibrated</span>
                    )}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => {
                      if (confirm(`Delete profile “${user.displayName}”? This cannot be undone.`)) {
                        deleteUser(user.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
