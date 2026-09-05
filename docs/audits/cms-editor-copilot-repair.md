# CMS estate editor and AI latency repair — 2026-09-06

## Production evidence

- `hoi-wan-hin` has `facilities = null` and no draft/published CMS revisions. The full editor loads the live payload. Evaluating its actual facilities display expression reproduced `Cannot read properties of null (reading 'join')`.
- Latest AI proposal at 2026-09-05T18:11:09Z failed with `OPENCODE_GO_TIMEOUT`, latency 60003 ms. Prior successful rows used `deepseek-v4-flash`; older malformed-proposal errors also exist and are not claimed resolved by this patch.
- DeepSeek documents default high-effort thinking and the OpenAI-compatible `thinking: {type: "disabled"}` option: https://api-docs.deepseek.com/guides/thinking_mode/

## Changes

- Render missing estate facilities as an empty textarea without changing the authoritative payload or draft history.
- For DeepSeek V4 editorial generation, disable default thinking and bound output to 8192 tokens. Other model families do not receive the DeepSeek-specific option.
- All provider retries share a 30-second deadline. Body-read timeout remains a timeout instead of a malformed-response error.
- Show Chinese messages for the actual provider error codes and state the generation deadline in loading text.

## Verification

- New regression tests failed on the previous implementation (null facilities, default thinking, independent retry deadlines), then passed after fixes.
- CMS suite: 48 passed.
- Content-copilot suite: Node and Bun tests passed; Bun 24 passed.
- TypeScript check passed.
- Real-provider fixture probe attempted with Vercel CLI `env run` using only public estate facts and injected no-write persistence. The CLI returned empty AI environment values, so no provider generation occurred. No new production secrets were written to disk.
- No authenticated browser session was available. Do not treat an HTTP 200 admin shell as editor or AI acceptance.

Actual production generation speed and successful proposal validation remain to be observed with a staff session. The 30-second limit is a provider-request deadline, not a promise that DB/context loading or optional web research completes in that interval.

- Final checks: CMS 48/48, AI Node 67/67 and Bun 24/24; typecheck, scoped ESLint and production build passed. Independent code review approved with no important findings.
