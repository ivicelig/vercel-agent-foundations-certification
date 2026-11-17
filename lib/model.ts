/**
 * The model both agents use. A plain "provider/model" string routes through
 * Vercel AI Gateway, so no provider SDK or provider API key is needed; the
 * Gateway credential (AI_GATEWAY_API_KEY, or the OIDC token on Vercel) stays
 * on the server and never reaches the browser.
 *
 * The id was checked against the Gateway's public model list. Sonnet-class
 * models support tool use, which both agents rely on.
 */
export const AGENT_MODEL = "openai/gpt-5-mini";
