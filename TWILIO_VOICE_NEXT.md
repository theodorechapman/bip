# twilio voice next (drop-in)

## what to add
- `POST /api/tools/voice_call_status`
- env:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_NUMBER`
  - `VOICE_TARGET_ALLOWLIST`

## behavior
- takes `{to, message, traceId?, runId?}`
- validates `to` against allowlist
- creates Twilio call using TwiML `Say` for status updates
- logs callSid into trace events

## fast path
1) implement endpoint in `convex/http.ts`
2) helper in `convex/voice.ts`
3) add minimal e2e mock for twilio rest call
4) expose in `skill.md` as optional operator feature
