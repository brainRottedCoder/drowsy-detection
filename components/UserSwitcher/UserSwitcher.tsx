'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui/Button';
import { useAppContext } from '../../context/AppContext';

interface UserSwitcherProps {
  variant?: 'light' | 'dark';
}

export const UserSwitcher: React.FC<UserSwitcherProps> = ({ variant = 'light' }) => {
  const { currentUser, users, switchUser, signOut, deleteUser } = useAppContext();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (!currentUser) return null;

  const chipClass =
    variant === 'dark'
      ? 'bg-slate-800 text-slate-100 border-slate-700 hover:bg-slate-700'
      : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50';

  const menuClass =
    variant === 'dark'
      ? 'bg-slate-800 border-slate-700 text-slate-100'
      : 'bg-white border-slate-200 text-slate-800';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${chipClass}`}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {currentUser.displayName.charAt(0).toUpperCase()}
        </span>
        {currentUser.displayName}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div
            className={`absolute right-0 z-50 mt-2 w-56 rounded-xl border shadow-lg p-2 ${menuClass}`}
          >
            <p className="px-2 py-1 text-xs uppercase tracking-wide opacity-60">Switch user</p>
            <ul className="max-h-48 overflow-auto mb-2">
              {users.map(user => (
                <li key={user.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-blue-50 hover:text-blue-700 ${
                      user.id === currentUser.id ? 'font-semibold' : ''
                    } ${variant === 'dark' ? 'hover:bg-slate-700 hover:text-white' : ''}`}
                    onClick={() => {
                      switchUser(user.id);
                      setOpen(false);
                    }}
                  >
                    {user.displayName}
                    {user.id === currentUser.id ? ' ✓' : ''}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-slate-200/40 pt-2 space-y-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false);
                  signOut();
                  router.push('/');
                }}
              >
                Sign out
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-red-600"
                onClick={() => {
                  if (confirm(`Delete profile “${currentUser.displayName}”?`)) {
                    deleteUser(currentUser.id);
                    setOpen(false);
                    router.push('/');
                  }
                }}
              >
                Delete this profile
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
