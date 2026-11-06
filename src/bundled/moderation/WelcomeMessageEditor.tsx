import {
  memo,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { WelcomeMessage } from "../../features/communities/WelcomeCard";
import { ComposerFormattingTools } from "../../features/messages/ComposerFormattingTools";
import { ComposerLinkDialog } from "../../features/messages/ComposerLinkDialog";
import {
  composerMarkdownContext,
  markdownRanges,
  readComposerSnapshot,
  type SourceRange,
} from "../../features/messages/composer-document";
import type {
  ComposerFormat,
  ComposerInputElement,
  ComposerLinkEdit,
} from "../../features/messages/composer-dom";
import { composerMarkdown } from "../../features/messages/composer-markdown";
import {
  EditableInput,
  type EditorDecoration,
} from "../../features/messages/EditableInput";
import {
  mentionDraft,
  type MentionDraft,
} from "../../features/messages/mention-draft";
import { messageLinkParts } from "../../features/messages/message-link-parts";
import { profileKey } from "../../features/profiles/target";
import { WELCOME_MAX_LENGTH } from "../../features/relay/landing";
import { scanMarkdown } from "../../features/relay/message-content";
import type { RelaySession } from "../../features/relay/session";
import { Field } from "../../shared/design-system/ui/Field";
import { InputGroup } from "../../shared/design-system/ui/InputGroup";
import styles from "./WelcomeMessageEditor.module.css";

const noOpen = () => false;
/** Chip artwork whose props hold across keystrokes, so typing prose does not
 * re-render every link in the message. */
const LinkToken = memo(WelcomeMessage);

/**
 * Identity, channel, message and web links outside code: the spans the editor
 * shows as chips, as the composer does. This is deliberately narrower than
 * `RichComposerInput`'s `decorationsFor`: plain `#name` and `@Name`
 * references and `:shortcode:` emoji are not chips. The preview and card
 * render through `MessageMarkdown`, so they may show a reference that stays
 * plain text here.
 */
function linkRanges(text: string, rich: readonly SourceRange[]) {
  const blocked = [...rich, ...markdownRanges(text).literal];
  const ranges: SourceRange[] = [];
  const add = (start: number, end: number) => {
    if (
      ![...blocked, ...ranges].some(
        (range) => start < range.end && end > range.start,
      )
    )
      ranges.push({ start, end });
  };
  for (const link of scanMarkdown(text).links) {
    const start = link.position?.start.offset;
    const end = link.position?.end.offset;
    if (
      link.url &&
      profileKey(link.url) &&
      start !== undefined &&
      end !== undefined
    )
      add(start, end);
  }
  messageLinkParts(text, undefined, add);
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * The welcome message in the composer's editor, with its formatting toolbar,
 * shortcuts and link dialog. The value is Markdown source, as the relay stores
 * it: formatting applied here is written as the composer sends it, and
 * published Markdown opens as its source and is sent back unchanged. There
 * are no recipients, so identity links only name people.
 */
export function WelcomeMessageEditor({
  ref,
  label,
  description,
  error,
  value,
  onChange,
  disabled,
  session,
  scope,
  channelId,
}: {
  ref: RefObject<ComposerInputElement | null>;
  label: string;
  description: ReactNode;
  error?: string | undefined;
  /** Markdown source. */
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  session: RelaySession;
  scope: string;
  /** Scopes the names identity chips show to this channel's members. */
  channelId: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => mentionDraft(value));
  // The Markdown the editor shows, to tell its own changes from new values.
  const shown = useRef(value);
  const [formats, setFormats] = useState<readonly ComposerFormat[]>([]);
  const [linkEdit, setLinkEdit] = useState<ComposerLinkEdit | null>(null);
  const [pasteTooLong, setPasteTooLong] = useState(false);
  const links = useRef<{ text: string; ranges: readonly SourceRange[] }>(
    undefined,
  );
  // A value from elsewhere (the published text, Cancel, Restore defaults)
  // replaces the document; undo starts again from it.
  useLayoutEffect(() => {
    if (value === shown.current) return;
    const next = mentionDraft(value);
    shown.current = value;
    ref.current?.reset(next);
    setDraft(next);
    setPasteTooLong(false);
  }, [value, ref]);
  const decorationsFor = (next: MentionDraft): EditorDecoration[] => {
    const doc = readComposerSnapshot(next.document);
    const context = doc
      ? composerMarkdownContext(doc)
      : { text: next.text, protected: [] };
    if (links.current?.text !== context.text)
      links.current = {
        text: context.text,
        ranges: linkRanges(context.text, context.protected),
      };
    return links.current.ranges.map(({ start, end }) => ({
      start,
      end,
      editAsText: true,
      content: (
        <LinkToken
          message={next.text.slice(start, end)}
          session={session}
          scope={scope}
          channelId={channelId}
          onOpenLink={noOpen}
          interactive={false}
        />
      ),
    }));
  };
  const problem =
    error ??
    (pasteTooLong
      ? "This paste would make the message too long. Shorten the text and try again."
      : undefined);
  return (
    <>
      <Field
        label={<span id={`${id}-label`}>{label}</span>}
        nativeLabel={false}
        description={<span id={`${id}-description`}>{description}</span>}
        error={problem && <span id={`${id}-error`}>{problem}</span>}
      >
        <InputGroup>
          <div className={`${styles.frame} text-body`}>
            <EditableInput
              ref={ref}
              draft={draft}
              value={draft.text}
              disabled={disabled}
              placeholder="Write a welcome message"
              aria-labelledby={`${id}-label`}
              aria-describedby={problem ? `${id}-error` : `${id}-description`}
              aria-invalid={!!problem || undefined}
              // The editor counts UTF-16 units and the relay counts characters,
              // at most two units each: this never refuses a message the relay
              // accepts, and the field's own check reports the real limit.
              maxLength={2 * WELCOME_MAX_LENGTH}
              decorationsFor={decorationsFor}
              onDraftChange={(next) => {
                setDraft(next);
                setPasteTooLong(false);
                const markdown = composerMarkdown(next);
                if (markdown === shown.current) return;
                shown.current = markdown;
                onChange(markdown);
              }}
              onFormatsChange={setFormats}
              onEditLink={setLinkEdit}
              onPasteTooLong={() => setPasteTooLong(true)}
            />
            <ComposerFormattingTools
              disabled={disabled}
              activeFormats={formats}
              toggleFormat={(format) => ref.current?.toggleFormat(format)}
              editLink={() => {
                const edit = ref.current?.editLink();
                if (edit) setLinkEdit(edit);
              }}
            >
              {null}
            </ComposerFormattingTools>
          </div>
        </InputGroup>
      </Field>
      {linkEdit && (
        <ComposerLinkDialog
          edit={linkEdit}
          input={ref}
          disabled={disabled}
          close={() => setLinkEdit(null)}
        />
      )}
    </>
  );
}
