'use client';

import Link from 'next/link';

import { Button } from '../components/ui/Button';
import { SignInPanel } from '../components/SignInPanel/SignInPanel';
import { UserSwitcher } from '../components/UserSwitcher/UserSwitcher';
import { useAppContext } from '../context/AppContext';

export default function Home() {
  const { currentUser, isUserReady, signOut } = useAppContext();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center max-w-4xl mx-auto">
      <div className="mb-8 p-4 bg-blue-50 rounded-full">
        <svg className="w-16 h-16 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      </div>

      <h1 className="text-4xl md:text-6xl font-bold text-slate-900 mb-6 tracking-tight">
        Drowsy Detector
      </h1>

      <p className="text-xl text-slate-600 mb-10 max-w-2xl leading-relaxed">
        Stay safe on the road with real-time drowsiness detection.
        Our AI monitors your alertness and alerts you when it&apos;s time to take a break.
      </p>

      {!isUserReady ? (
        <p className="text-slate-500 text-sm">Loading profile…</p>
      ) : !currentUser ? (
        <SignInPanel />
      ) : (
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-slate-600">
              Signed in as <span className="font-semibold text-slate-900">{currentUser.displayName}</span>
            </p>
            <UserSwitcher />
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full">
            <Link href="/monitor" className="w-full">
              <Button size="lg" className="w-full shadow-blue-200 shadow-lg">
                Start Monitoring
              </Button>
            </Link>
            <Link href="/settings" className="w-full">
              <Button variant="secondary" size="lg" className="w-full">
                Settings
              </Button>
            </Link>
          </div>

          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      )}

      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
        <div className="p-6 bg-white rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-semibold text-lg mb-2">Private & Secure</h3>
          <p className="text-slate-500 text-sm">All processing happens locally in your browser. No video is ever uploaded to the cloud.</p>
        </div>
        <div className="p-6 bg-white rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-semibold text-lg mb-2">Real-time Alerts</h3>
          <p className="text-slate-500 text-sm">Instant audio and visual warnings when signs of drowsiness or micro-sleeps are detected.</p>
        </div>
        <div className="p-6 bg-white rounded-xl shadow-sm border border-slate-100">
          <h3 className="font-semibold text-lg mb-2">Personal profiles</h3>
          <p className="text-slate-500 text-sm">Each name keeps its own settings and face calibration on this device.</p>
        </div>
      </div>

      <footer className="mt-20 text-slate-400 text-sm">
        <p>© 2025 Drowsy Detector. Use responsibly. Not a replacement for sleep.</p>
      </footer>
    </div>
  );
}
