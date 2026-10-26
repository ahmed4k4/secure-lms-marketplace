import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth-redirects";

const supportedOtpTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change"]);

export async function GET(request: Request, context: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await context.params;
  const locale = rawLocale === "en" ? "en" : "ar";
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const otpType = rawType && supportedOtpTypes.has(rawType as EmailOtpType) ? rawType as EmailOtpType : null;
  const rawNextPath = url.searchParams.get("next");
  const nextPath = safeNextPath(rawNextPath, locale);
  const flow = (url.searchParams.get("flow") ?? "").toLowerCase();
  const errorCode = (url.searchParams.get("error_code") ?? "").toLowerCase();
  const errorDescription = (url.searchParams.get("error_description") ?? "").toLowerCase();
  const recoveryFlow = flow === "recovery" || otpType === "recovery" || nextPath.includes("/reset-password") || errorDescription.includes("recovery");
  const inviteFlow = flow === "invite" || otpType === "invite";
  const successPath = rawNextPath ? nextPath : recoveryFlow ? `/${locale}/reset-password` : inviteFlow ? `/${locale}/setup-account?flow=invite` : `/${locale}/dashboard`;

  if (errorCode || errorDescription) return callbackFailure(url.origin, locale, recoveryFlow, errorCode);

  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(successPath, url.origin));
    console.error("auth_callback_exchange_failed", JSON.stringify({ code: error.code ?? "unknown", status: error.status ?? 0 }));
    return callbackFailure(url.origin, locale, recoveryFlow, error.code ?? "");
  }

  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
    if (!error) {
      const destination = (inviteFlow && (!rawNextPath || nextPath === `/${locale}/dashboard`))
        ? `/${locale}/setup-account?flow=invite`
        : successPath;
      return NextResponse.redirect(new URL(destination, url.origin));
    }
    console.error("auth_callback_otp_failed", JSON.stringify({ code: error.code ?? "unknown", type: otpType }));
    return callbackFailure(url.origin, locale, recoveryFlow, error.code ?? "");
  }

  return callbackFailure(url.origin, locale, recoveryFlow, errorCode);
}

function callbackFailure(origin: string, locale: string, recovery: boolean, errorCode: string) {
  if (recovery) {
    const target = new URL(`/${locale}/forgot-password`, origin);
    target.searchParams.set("error", /expired|otp_expired|invalid_token/.test(errorCode) ? "expired" : "link");
    return NextResponse.redirect(target);
  }
  const target = new URL(`/${locale}/sign-in`, origin);
  target.searchParams.set("account", /expired|otp_expired/.test(errorCode) ? "invite_expired" : "invite_failed");
  return NextResponse.redirect(target);
}
