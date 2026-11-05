/** The relay advertises the welcome-channel command in NIP-11 under this name. */
export const LANDING_EXTENSION = "buzz-landing-channel";
/** Relay limit for a custom welcome message, in Unicode scalar values. */
export const WELCOME_MAX_LENGTH = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Projects the welcome-channel tags from relay-signed channel metadata. A
 * `welcome` tag counts only while `landing` designates the channel; a blank or
 * repeated message falls back to the default copy.
 */
export function landingTags(tags: readonly (readonly string[])[]): {
  landing?: true;
  welcome?: string;
} {
  if (!tags.some(([name]) => name === "landing")) return {};
  const welcome = tags.filter(([name]) => name === "welcome");
  const text = welcome.length === 1 ? welcome[0]?.[1] : undefined;
  return text !== undefined && !welcomeTextProblem(text)
    ? { landing: true, welcome: text }
    : { landing: true };
}

/** Line endings normalize to `\n`; surrounding whitespace is not sent. */
export function normalizeWelcome(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}

/** Mirrors the relay's message rules for a normalized, non-default message. */
export function welcomeTextProblem(
  text: string,
): "empty" | "long" | "control" | undefined {
  // Unicode White_Space, as the relay's `str::trim` sees it: unlike `trim()`
  // it keeps U+FEFF, so a message of only that passes both hosts alike.
  if (/^\p{White_Space}*$/u.test(text)) return "empty";
  if ([...text].length > WELCOME_MAX_LENGTH) return "long";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text)) return "control";
  return undefined;
}

/** The command's message is either the default marker `""` or a valid text. */
export function validWelcomeCommand(text: string) {
  return text === "" || !welcomeTextProblem(text);
}

/** Relay support and its currently designated channel, from NIP-11. */
export function landingInfo(info: unknown): {
  landingChannels: boolean;
  landingChannel?: string;
} {
  const record =
    info && typeof info === "object"
      ? (info as Record<string, unknown>)
      : undefined;
  const extensions = record?.supported_extensions;
  const supported =
    Array.isArray(extensions) && extensions.includes(LANDING_EXTENSION);
  const channel = record?.landing_channel;
  return supported && typeof channel === "string" && UUID.test(channel)
    ? { landingChannels: true, landingChannel: channel }
    : { landingChannels: supported };
}
