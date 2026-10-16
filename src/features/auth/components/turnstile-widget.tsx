"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      remove?: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

export function TurnstileWidget({
  inputId = "captchaToken",
  inputName = "captchaToken",
}: {
  inputId?: string;
  inputName?: string;
}) {
  const siteKey = process.env.NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY?.trim();
  const [scriptError, setScriptError] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  const clearToken = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const renderWidget = useCallback(() => {
    const host = hostRef.current;
    const turnstile = window.turnstile;

    if (!siteKey || !host || !turnstile || widgetIdRef.current) {
      return;
    }

    widgetIdRef.current = turnstile.render(host, {
      sitekey: siteKey,
      callback: (nextToken) => {
        if (inputRef.current) {
          inputRef.current.value = nextToken;
        }
        setScriptError(false);
      },
      "expired-callback": clearToken,
      "error-callback": clearToken,
    });
  }, [clearToken, siteKey]);

  useEffect(() => {
    return () => {
      const widgetId = widgetIdRef.current;

      if (widgetId) {
        window.turnstile?.remove?.(widgetId);
        widgetIdRef.current = null;
      }
    };
  }, []);

  if (!siteKey) {
    return <input id={inputId} name={inputName} type="hidden" defaultValue="" />;
  }

  return (
    <div className="space-y-2">
      <Script
        id="cloudflare-turnstile-script"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={renderWidget}
        onError={() => {
          setScriptError(true);
          clearToken();
        }}
      />
      <input ref={inputRef} id={inputId} name={inputName} type="hidden" />
      <div ref={hostRef} />
      {scriptError ? (
        <p className="text-xs leading-5 text-red-700">
          Security verification could not be loaded yet. Check your connection and reload the page.
        </p>
      ) : null}
    </div>
  );
}
