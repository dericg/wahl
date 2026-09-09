import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { supportsPasskeys, performPasskey } from "./passkey";

export default function SignIn({ session, owner, client, previewMode }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordSignIn, setPasswordSignIn] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const passkeysSupported = supportsPasskeys();

  useEffect(() => () => { pending.current?.abort(); }, []);

  async function run(action, progress) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage(progress);
    try {
      const result = await action(controller.signal);
      if (!controller.signal.aborted) setMessage(result);
    } catch {
      if (!controller.signal.aborted) setMessage("Couldn’t complete that request. Please try again.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }

  function passkey(register = false) {
    if (!passkeysSupported) return;
    return run((signal) => performPasskey(client.auth, { register, owner, session, signal }),
      register ? "Adding passkey…" : "Signing in…");
  }

  function signIn(event) {
    event.preventDefault();
    return run(async () => {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) return "That email and password didn’t match.";
      setPassword("");
      return "";
    }, "Signing in…");
  }

  function updatePassword(event) {
    event.preventDefault();
    return run(async () => {
      const { error } = await client.auth.updateUser({ password });
      if (error) return "Couldn’t save your password. Please try again.";
      setPassword("");
      setChangingPassword(false);
      return "Password saved.";
    }, "Saving…");
  }

  const status = <small className="account-message" role="status">{message}</small>;
  const signOut = <button disabled={busy} className="quiet-button" type="button" onClick={() => run(async () => {
    const { error } = await client.auth.signOut();
    return error ? "Couldn’t sign out. Please try again." : "";
  }, "Signing out…")}><LogOut size={12} />{owner ? "Sign out" : "Not authorized · sign out"}</button>;

  if (!client) return <span>{previewMode ? "Local preview" : "Read-only"}</span>;
  if (session && owner) return <div className="account-controls" aria-busy={busy}>
    <button disabled={busy || !passkeysSupported} className="quiet-button" type="button" onClick={() => passkey(true)}>Add passkey</button>
    {!passkeysSupported && <small className="account-message">Passkeys need a supported browser and a secure connection.</small>}
    {changingPassword ? <form className="sign-in" onSubmit={updatePassword}><input disabled={busy} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="New password" aria-label="New password" /><button disabled={busy} type="submit">Save password</button></form> : <button disabled={busy} className="quiet-button" type="button" onClick={() => { setChangingPassword(true); setMessage(""); }}>Set password</button>}
    {signOut}{status}
  </div>;
  if (session) return <div className="account-controls">{signOut}{status}</div>;
  if (!open) return <button className="quiet-button" type="button" onClick={() => setOpen(true)}><LogIn size={12} />Owner sign in</button>;
  return <div className="sign-in password-sign-in" aria-busy={busy}>
    <button disabled={busy || !passkeysSupported} type="button" onClick={() => passkey()}>Sign in with passkey</button>
    {!passkeysSupported && <small>Passkeys aren’t available in this browser or connection. Use your password.</small>}
    <button disabled={busy} type="button" aria-expanded={passwordSignIn || !passkeysSupported} onClick={() => setPasswordSignIn((value) => !value)}>Use password</button>
    {(passwordSignIn || !passkeysSupported) && <form className="sign-in password-sign-in" onSubmit={signIn}>
      <input disabled={busy} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" aria-label="Email address" />
      <input disabled={busy} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" aria-label="Password" />
      <button disabled={busy} type="submit">Sign in with password</button>
    </form>}
    {status}
  </div>;
}
