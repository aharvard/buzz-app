import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import "./empty-state.css";

const prompts = [
  "Watch this thread for new messages",
  "Tell me when my PR is ready to merge",
  "Check in every morning at 9",
  "Tell me when CI fails on this PR",
  "Watch this channel for deployment failures",
  "Summarize this thread every afternoon",
  "Remind me to follow up tomorrow",
  "Tell me when someone asks for help",
  "Watch this PR for review feedback",
  "Keep an eye out for release blockers",
  "Tell me when this incident is resolved",
  "Summarize new messages each morning",
];
const tilts = [-4, 3, -2];

export function AttentionEmptyState({ name }: { name: string }) {
  const reduced = useReducedMotion();
  const paused = useRef(false);
  const [examples, setExamples] = useState({ step: 0, messages: [0, 1, 2] });
  useEffect(() => {
    if (reduced) return;
    const timer = window.setInterval(() => {
      if (document.hidden || paused.current) return;
      setExamples(({ step, messages }) => ({
        step: step + 1,
        messages: messages.map((message, slot) =>
          slot === step % 3 ? (step + 3) % prompts.length : message,
        ),
      }));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [reduced]);
  return (
    <section
      aria-label="Start watching"
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
      }}
    >
      <EmptyState
        icon={null}
        title={`Give ${name} something to keep an eye on.`}
        description={`Ask ${name} to follow a conversation, watch a pull request, or check something on a schedule. Tell ${name} what to look for and when to respond.`}
        action={
          <div className="attention-empty-preview">
            <ul
              className="attention-empty-pile"
              aria-label={`Things to ask ${name}`}
            >
              {examples.messages.map((message, index) => (
                <li key={tilts[index]} className="attention-empty-piece">
                  <div
                    className="attention-empty-theme"
                    data-accent="citrus"
                    style={{
                      transform: `rotate(${reduced ? 0 : tilts[index]}deg)`,
                    }}
                  >
                    <span
                      key={message}
                      className="attention-empty-bubble text-body-sm"
                      data-own=""
                    >
                      {prompts[message]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        }
      />
    </section>
  );
}
