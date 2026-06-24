const SECRET_KEY_PATTERN =
  /apikey|api_key|token|password|secret|authorization|connection_string|bearer|credential/i;

const INLINE_SECRET_PATTERN =
  /\b(Bearer\s+[A-Za-z0-9._~+/=-]+|Basic\s+[A-Za-z0-9+/=]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;

export function redactString(value) {
  if (typeof value !== "string") return value;
  return value.replace(INLINE_SECRET_PATTERN, "<REDACTED>");
}

export function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = "<REDACTED>";
      } else {
        out[key] = redactSensitive(inner);
      }
    }
    return out;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  return value;
}

export function safeJsonForReport(value, maxLength = 900) {
  const text = JSON.stringify(redactSensitive(value));
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
