export type SessionState = "initializing" | "ready" | "expired" | "error";
export interface LiffClient {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(): void;
  getAccessToken(): string | null;
}
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function establishCustomerSession(liff: LiffClient, liffId: string, fetcher: FetchLike = fetch): Promise<void> {
  if (!liffId) throw new Error("LIFF configuration is unavailable");
  await liff.init({ liffId });
  if (!liff.isLoggedIn()) { liff.login(); throw new Error("LINE login redirect started"); }
  const accessToken = liff.getAccessToken();
  if (!accessToken) throw new Error("LINE access token is unavailable");
  const bootstrap = await fetcher("/api/v1/auth/line/bootstrap", { method: "POST", credentials: "same-origin" });
  if (!bootstrap.ok) throw new Error("LINE bootstrap failed");
  const value = await bootstrap.json() as { nonce?: unknown };
  if (typeof value.nonce !== "string") throw new Error("LINE bootstrap response is invalid");
  const session = await fetcher("/api/v1/auth/line/session", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessToken, nonce: value.nonce }),
  });
  if (!session.ok) throw new Error("LINE session verification failed");
}

let browserLiff: Promise<LiffClient> | null = null;
export function loadBrowserLiff(): Promise<LiffClient> {
  if (typeof window === "undefined") return Promise.reject(new Error("LIFF requires a browser"));
  const existing = (window as Window & { liff?: LiffClient }).liff;
  if (existing) return Promise.resolve(existing);
  browserLiff ??= new Promise<LiffClient>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js"; script.async = true;
    const fail = (message: string) => { script.remove(); reject(new Error(message)); };
    script.onload = () => { const loaded = (window as Window & { liff?: LiffClient }).liff; if (loaded) resolve(loaded); else fail("LIFF SDK did not initialize"); };
    script.onerror = () => fail("LIFF SDK could not be loaded");
    document.head.append(script);
  }).catch((error: unknown) => { browserLiff = null; throw error; });
  return browserLiff;
}
