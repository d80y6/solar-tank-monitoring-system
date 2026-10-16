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

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: form,
    },
  );

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
