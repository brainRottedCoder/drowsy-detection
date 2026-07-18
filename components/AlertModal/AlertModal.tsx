import React, { useEffect } from 'react';
import { Button } from '../ui/Button';
import { Howl } from 'howler';

interface AlertModalProps {
  isOpen: boolean;
  onAcknowledge: () => void;
  isMicrosleep?: boolean;
}

export const AlertModal: React.FC<AlertModalProps> = ({ isOpen, onAcknowledge, isMicrosleep }) => {
  useEffect(() => {
    let sound: Howl | null = null;

    if (isOpen) {
      // Create a beep sound using base64 to avoid external file dependency issues in preview
      // This is a simple generated sine wave beep
      sound = new Howl({
        src: ['data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAP//OEAAAAAAAABIAAAAAAAAASAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMD//////////////////////////////////////////////////////////////////wAAAP//OEAAAAAAAABIAAAAAAAAASAAAAAAAAAAAAAAA'], // Placeholder, in real app use real file
        loop: true,
        volume: 1.0,
        html5: true
      });
      
      // For the prototype, we'll use the Web Audio API oscillator if Howler fails or for a better beep
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = 800;
      
      // Pulsing alarm
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.setValueAtTime(0, now + 0.2);
      gain.gain.setValueAtTime(0.5, now + 0.4);
      gain.gain.setValueAtTime(0, now + 0.6);
      
      osc.start();
      
      // Cleanup function to stop sound
      return () => {
        osc.stop();
        ctx.close();
        if (sound) sound.unload();
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-900/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full mx-4 text-center shadow-2xl border-4 border-red-500">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        
        <h2 className="text-3xl font-bold text-slate-900 mb-2">
          {isMicrosleep ? 'MICROSLEEP DETECTED' : 'DROWSINESS DETECTED'}
        </h2>
        <p className="text-slate-600 mb-8 text-lg">
          {isMicrosleep
            ? 'Your eyes were closed too long. Please pull over safely.'
            : 'Signs of fatigue are building up. Please pull over and take a break.'}
        </p>
        
        <Button 
          onClick={onAcknowledge}
          variant="danger"
          size="lg"
          className="w-full py-4 text-xl shadow-red-200 shadow-xl"
        >
          I AM AWAKE
        </Button>
      </div>
    </div>
  );
};
