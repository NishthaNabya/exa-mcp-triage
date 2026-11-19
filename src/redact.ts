// Removes secrets from anything the lab stores or prints.

const SECRET_HEADERS = new Set(["x-api-key", "authorization", "cookie", "set-cookie"]);
// Object fields whose value is a secret by name, e.g. { exaApiKey: "...", token: "..." }.
const SECRET_FIELD = /^(x-api-key|authorization|cookie|set-cookie|.*api[-_]?key|.*token|.*secret|password|passwd)$/i;
const KEY_PARAM = /([?&](?:exaApiKey|api_key|apiKey|key|token)=)[^&\s"']+/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g;

/** Values of real secrets in this process, so they can be removed wherever they appear. */
function liveSecrets(): string[] {
  return [process.env.EXA_API_KEY].filter((v): v is string => typeof v === "string" && v.length >= 8);
}

export function redactText(text: string): string {
  let out = text.replace(KEY_PARAM, "$1[redacted]").replace(BEARER, "$1[redacted]");
  for (const secret of liveSecrets()) out = out.split(secret).join("[redacted]");
  return out;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, SECRET_HEADERS.has(k.toLowerCase()) ? "[redacted]" : redactText(v)]),
  );
}

/** Redacts every string inside a JSON-like value. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_FIELD.test(k) && typeof v === "string" ? "[redacted]" : redactDeep(v)]),
    ) as T;
  }
  return value;
}
