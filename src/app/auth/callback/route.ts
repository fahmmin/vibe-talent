import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// Only allow same-origin relative paths. Rejects:
//   - missing/empty leading slash ("dashboard", ".evil.com")
//   - protocol-relative URLs ("//evil.com")
//   - backslash tricks browsers may normalize to "/" ("/\evil.com")
//   - embedded schemes
//   - any ASCII control chars (U+0000–U+001F, U+007F) including CR/LF — blocks
//     header-injection shapes like "/dashboard\r\nLocation: https://evil.com"
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;
export function sanitizeNext(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (CONTROL_CHARS.test(raw)) return "/dashboard";
  if (!raw.startsWith("/")) return "/dashboard";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  if (raw.includes("\\")) return "/dashboard";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNext(searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();

    // Build the redirect response first so cookies can be forwarded onto it
    const redirectTo = `${origin}${next}`;
    const forwardedResponse = NextResponse.redirect(redirectTo);

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
              forwardedResponse.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Pull avatar from OAuth provider if user doesn't have one
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const oauthAvatar =
          user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          null;

        // Find the GitHub identity in the user's linked identities.
        // This handles both initial GitHub OAuth signup AND linkIdentity
        // flows where a Google/email user links their GitHub account later.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const githubIdentity = user.identities?.find((i: any) => i.provider === "github");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ghData = (githubIdentity?.identity_data ?? {}) as any;
        const githubUsername =
          ghData.user_name ||
          ghData.preferred_username ||
          user.user_metadata?.user_name ||
          user.user_metadata?.preferred_username ||
          null;
        // GitHub's stable numeric ID lands in identity_data.sub (OIDC-style
        // subject identifier — string-encoded). We coerce here once because
        // github-sync uses this on every run to tell a legitimate rename
        // apart from a handle reclaim; a missing or stale value silently
        // disables that guard. provider_id on the row itself isn't exposed
        // through Supabase's JS SDK so we don't depend on it.
        const rawGithubId = ghData.sub ?? ghData.provider_id ?? null;
        const parsedGithubId =
          rawGithubId != null && /^\d+$/.test(String(rawGithubId))
            ? Number(rawGithubId)
            : null;
        const githubId = parsedGithubId !== null && Number.isFinite(parsedGithubId)
          ? parsedGithubId
          : null;

        // Use service role client for DB operations to bypass RLS
        const adminSb = createAdminClient();

        const { data: profile } = await adminSb
          .from("users")
          .select("username, avatar_url, github_username, github_id, display_name, bio")
          .eq("id", user.id)
          .single();

        // Detect Twitter identity for auto-fill
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const twitterIdentity = user.identities?.find((i: any) => i.provider === "twitter");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const twitterData = (twitterIdentity?.identity_data ?? {}) as any;
        const twitterHandle = twitterData.user_name || twitterData.preferred_username || null;
        const twitterName = twitterData.full_name || twitterData.name || null;
        const twitterBio = twitterData.description || null;

        // Detect LinkedIn OIDC identity for auto-fill
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const linkedinIdentity = user.identities?.find((i: any) => i.provider === "linkedin_oidc");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const linkedinData = (linkedinIdentity?.identity_data ?? {}) as any;
        const linkedinName = linkedinData.full_name || linkedinData.name || null;

        // UPDATE-only: we can't INSERT here because users.username is NOT NULL
        // and we don't have one yet. Brand-new GitHub OAuth signups land on
        // profile-setup, whose step 1 upsert is responsible for creating the
        // row with github_username already set (from user.identities). This
        // branch only fires for returning users whose row already exists —
        // e.g. avatar refresh or Google→GitHub linkIdentity recovery.
        const autoFills: string[] = [];
        if (profile) {
          const updates: Record<string, string | number> = {};

          // Always sync avatar from OAuth provider on login
          if (oauthAvatar) {
            updates.avatar_url = oauthAvatar;
          }

          if (githubUsername) {
            updates.github_username = githubUsername;
          }
          // Backfill github_id once. Don't overwrite — a row with github_id
          // already set has been canonicalized and the unique partial index
          // would reject a conflicting value anyway.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (githubId !== null && (profile as any).github_id == null) {
            updates.github_id = githubId;
          }

          // Auto-fill display_name and bio from Twitter/X if currently empty.
          // Only fills on explicit linkIdentity (redirect to /settings), so
          // users who intentionally cleared their name won't have it restored
          // on regular logins.
          if (!profile.display_name) {
            const socialName = twitterName || linkedinName;
            if (socialName) {
              updates.display_name = socialName;
              autoFills.push("display name");
            }
          }
          if (!profile.bio && twitterBio) {
            updates.bio = twitterBio;
            autoFills.push("bio");
          }

          if (Object.keys(updates).length > 0) {
            await adminSb
              .from("users")
              .update(updates)
              .eq("id", user.id);
          }
        }

        // Auto-populate verified social links:
        // - GitHub handle (existing behaviour)
        // - Twitter handle when linking X account
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const socialLinkUpdates: Record<string, string> = {};
        if (githubUsername) socialLinkUpdates.github = githubUsername;
        if (twitterHandle) socialLinkUpdates.twitter = twitterHandle;
        if (Object.keys(socialLinkUpdates).length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (adminSb.from("social_links") as any).upsert(
            { user_id: user.id, ...socialLinkUpdates },
            { onConflict: "user_id" }
          );
        }

        // If fields were auto-filled and the user is heading back to /settings,
        // append ?autofilled= so the page can show the confirmation banner.
        if (autoFills.length > 0 && next.startsWith("/settings")) {
          const param = encodeURIComponent(autoFills.join(","));
          const separator = next.includes("?") ? "&" : "?";
          const autofillUrl = `${origin}${next}${separator}autofilled=${param}`;
          const autofillResponse = NextResponse.redirect(autofillUrl);
          forwardedResponse.cookies.getAll().forEach((c) => {
            autofillResponse.cookies.set(c);
          });
          // Skip the generic return below and return early with the richer URL
          if (!profile?.username) {
            // new user — still send to profile-setup (shouldn't normally happen
            // on a linkIdentity flow, but guard anyway)
          } else {
            return autofillResponse;
          }
        }

        // Send first-time users (email confirm or OAuth) to profile setup
        // unless the caller explicitly asked for a specific destination
        const hasExplicitNext = searchParams.get("next") !== null;
        if (!profile?.username && !hasExplicitNext) {
          const setupResponse = NextResponse.redirect(`${origin}/auth/profile-setup`);
          forwardedResponse.cookies.getAll().forEach((c) => {
            setupResponse.cookies.set(c);
          });
          return setupResponse;
        }
      }

      return forwardedResponse;
    }
  }

  // Pass through the specific Supabase error if available
  const errorCode = searchParams.get("error_code");
  const errorDescription = searchParams.get("error_description");
  const loginUrl = new URL("/auth/login", origin);
  if (errorCode) {
    loginUrl.searchParams.set("error_code", errorCode);
    loginUrl.searchParams.set("error_description", errorDescription || "Authentication failed");
  } else {
    loginUrl.searchParams.set("error_code", "auth_failed");
    loginUrl.searchParams.set("error_description", "Authentication failed. Please try again.");
  }
  return NextResponse.redirect(loginUrl.toString());
}
