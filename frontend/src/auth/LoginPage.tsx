import { useState, type FormEvent } from "react";
import { loginErrorMessage } from "./loginErrors";
import { LOGIN_LIMITS } from "./types";
import { useAuthSession, useLogin } from "./useAuth";

/**
 * Sign-in form. On success the session query is updated and GuestOnly
 * redirects, so this page never navigates by itself.
 */
export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { signOutReason } = useAuthSession();
  const loginMutation = useLogin();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loginMutation.isPending) return;
    loginMutation.mutate(
      { username: username.trim(), password },
      { onError: () => setPassword("") }
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-600">Use your clinic staff account.</p>
      </div>

      {signOutReason === "expired" && !loginMutation.isError && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Your session has ended. Please sign in again.
        </p>
      )}
      {signOutReason === "logout-failed" && !loginMutation.isError && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          You were signed out on this computer. The server could not be reached, so your session there may stay active
          until it expires.
        </p>
      )}
      {loginMutation.isError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {loginErrorMessage(loginMutation.error)}
        </p>
      )}

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Username</span>
        <input
          name="username"
          autoComplete="username"
          autoFocus
          required
          maxLength={LOGIN_LIMITS.usernameMax}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={LOGIN_LIMITS.passwordMax}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={loginMutation.isPending || username.trim() === "" || password === ""}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loginMutation.isPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
