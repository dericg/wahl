export function supportsPasskeys(environment = globalThis) {
  return Boolean(environment.isSecureContext && environment.PublicKeyCredential
    && typeof environment.navigator?.credentials?.get === "function"
    && typeof environment.navigator?.credentials?.create === "function");
}

// Supabase performs the challenge, credential verification, and session creation.
// A successful browser prompt alone never grants access to the wall.
export async function performPasskey(auth, { register = false, owner = false, session = null, signal } = {}) {
  if (register && (!session || !owner)) return "Owner access is required to add a passkey.";
  try {
    const { data, error } = register
      ? await auth.registerPasskey({ options: { signal } })
      : await auth.signInWithPasskey({ options: { signal } });
    if (error) throw error;
    if (!data || (!register && !data.session)) throw new Error("No verified session");
    return register ? "Passkey added. You can use it next time you sign in." : "";
  } catch {
    return register
      ? "Passkey wasn’t added. You can try again; password sign-in is still available."
      : "Passkey sign-in wasn’t completed. Try again or use your password.";
  }
}
