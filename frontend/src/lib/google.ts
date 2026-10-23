/**
 * Google Identity Services, loaded on demand.
 *
 * The script is only fetched when the login page actually has a client id to
 * use, so a server without Google configured never pays for it. Only the
 * handful of GIS calls the app makes are typed — not the whole surface.
 */

interface CredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize: (options: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'continue_with' | 'signup_with';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      width?: number;
      logo_alignment?: 'left' | 'center';
    },
  ) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let loading: Promise<GoogleAccountsId> | null = null;

export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);

  loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error('Google Identity Services loaded without its API'));
    };
    script.onerror = () => {
      // Let a later attempt try again instead of caching the failure forever.
      loading = null;
      reject(new Error('Could not load Google sign-in. Check your connection or ad blocker.'));
    };
    document.head.appendChild(script);
  });

  return loading;
}
