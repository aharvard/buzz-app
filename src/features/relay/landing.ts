/** The relay advertises the welcome-channel command in NIP-11 under this name. */
export const LANDING_EXTENSION = "buzz-landing-channel";
/** Relay limit for a custom welcome message, in Unicode scalar values. */
export const WELCOME_MAX_LENGTH = 4000;
/** Relay limit for a custom welcome title, in Unicode scalar values. */
export const WELCOME_TITLE_MAX_LENGTH = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The one value of a tag that appears exactly once. */
function only(tags: readonly (readonly string[])[], name: string) {
  const matches = tags.filter(([key]) => key === name);
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

/**
 * Projects the welcome-channel tags from relay-signed channel metadata. The
 * `welcome` and `welcome_title` tags count only while `landing` designates
 * the channel; a blank, invalid or repeated value falls back to the default.
 */
export function landingTags(tags: readonly (readonly string[])[]): {
  landing?: true;
  welcome?: string;
  welcomeTitle?: string;
} {
  if (!tags.some(([name]) => name === "landing")) return {};
  const welcome = only(tags, "welcome");
  const title = only(tags, "welcome_title");
  return {
    landing: true,
    ...(welcome !== undefined && !welcomeTextProblem(welcome)
      ? { welcome }
      : {}),
    ...(title !== undefined && !welcomeTitleProblem(title)
      ? { welcomeTitle: title }
      : {}),
  };
}

/** Line endings normalize to `\n`; surrounding whitespace is not sent. */
export function normalizeWelcome(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}

// Unicode White_Space, as the relay's `str::trim` sees it: unlike `trim()`
// it keeps U+FEFF, so a value of only that passes both hosts alike.
const blank = (text: string) => /^\p{White_Space}*$/u.test(text);

/** Mirrors the relay's rules for a normalized, non-default message: Markdown
 * source whose only control characters are line breaks and tabs. */
export function welcomeTextProblem(
  text: string,
): "empty" | "long" | "control" | undefined {
  if (blank(text)) return "empty";
  if ([...text].length > WELCOME_MAX_LENGTH) return "long";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(text)) return "control";
  return undefined;
}

/** Mirrors the relay's rules for a trimmed, non-default title: one line with
 * no control characters at all. */
export function welcomeTitleProblem(
  text: string,
): "empty" | "long" | "control" | undefined {
  if (blank(text)) return "empty";
  if ([...text].length > WELCOME_TITLE_MAX_LENGTH) return "long";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return "control";
  return undefined;
}

/** The command's message is either the default marker `""` or a valid text. */
export function validWelcomeCommand(text: string) {
  return text === "" || !welcomeTextProblem(text);
}

/** The command's title is either the default marker `""` or a valid title. */
export function validWelcomeTitleCommand(text: string) {
  return text === "" || !welcomeTitleProblem(text);
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
