import {
  getCaptchaProvider,
  getCaptchaSecretKey,
  isProductionLikeEnvironment,
} from "./auth-config";

type CaptchaResult =
  | { ok: true; enforced: boolean }
  | { ok: false; enforced: boolean; error: string };

type TurnstileResponse = {
  success?: boolean;
  "error-codes"?: string[];
};

/**
 * Verification must never hang a sign-up or sign-in request. A slow provider
 * fails closed with a retryable message rather than holding the connection open.
 */
const CAPTCHA_TIMEOUT_MS = 8_000;

export async function verifyCaptchaToken({
  token,
  remoteIp,
}: {
  token: string | null;
  remoteIp: string | null;
}): Promise<CaptchaResult> {
  const provider = getCaptchaProvider();

  if (provider === "disabled") {
    return { ok: true, enforced: false };
  }

  if (provider !== "turnstile") {
    return {
      ok: false,
      enforced: true,
      error: "Security verification provider is not recognized.",
    };
  }

  const secret = getCaptchaSecretKey();

  if (!secret) {
    return {
      ok: false,
      enforced: true,
      error: "Security verification is not configured.",
    };
  }

  if (!token) {
    return {
      ok: false,
      enforced: true,
      error: "Complete the security verification first.",
    };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", token);

  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }

  let response: Response;

  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: form,
        method: "POST",
        signal: AbortSignal.timeout(CAPTCHA_TIMEOUT_MS),
      },
    );
  } catch {
    return {
      ok: false,
      enforced: true,
      error: "Security verification could not be processed yet.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      enforced: true,
      error: "Security verification could not be processed yet.",
    };
  }

  const payload = (await response.json()) as TurnstileResponse;

  if (payload.success) {
    return { ok: true, enforced: true };
  }

  const isMissingInput =
    payload["error-codes"]?.includes("missing-input-response") ?? false;

  return {
    ok: false,
    enforced: true,
    error:
      isMissingInput && !isProductionLikeEnvironment()
        ? "Security verification token is empty. Disable AUTH_CAPTCHA_PROVIDER for local development."
        : "Security verification is invalid.",
  };
}
