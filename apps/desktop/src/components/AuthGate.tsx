import { useState, type FormEvent } from 'react';
import { Lock, Eye, EyeOff, Layers } from 'lucide-react';
import { useBoardStore } from '../store/useBoardStore.ts';

export function AuthGate() {
  const login = useBoardStore((s) => s.login);
  const authError = useBoardStore((s) => s.authError);

  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setSubmitting(true);
    await login(token.trim());
    setSubmitting(false);
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white">Sign in to Ariadeck</h1>
            <p className="text-xs text-slate-400">
              Enter your access token to unlock this workspace.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="ariadeck-token" className="mb-1 block text-xs font-medium text-slate-300">
              Access Token
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="ariadeck-token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
                placeholder="Paste ARIADECK_AUTH_TOKEN..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-10 text-sm text-white outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                aria-label={showToken ? 'Hide token' : 'Show token'}
                onClick={() => setShowToken((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {authError && (
            <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-xs text-rose-300">
              {authError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !token.trim()}
            className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Signing in...' : 'Unlock Workspace'}
          </button>
        </form>
      </div>
    </div>
  );
}
