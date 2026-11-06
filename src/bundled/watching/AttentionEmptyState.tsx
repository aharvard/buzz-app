import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import "./empty-state.css";

const prompts = [
  "Watch this thread for new messages",
  "Tell me when my PR is ready to merge",
  "Check in every morning at 9",
];
const tilts = [-4, 3, -2];

export function AttentionEmptyState({ name }: { name: string }) {
  const reduced = useReducedMotion();
  const container = useRef<HTMLElement>(null);
  return (
    <section ref={container} aria-label="Start watching">
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
              {prompts.map((text, index) => (
                <motion.li
                  key={text}
                  className="attention-empty-piece"
                  drag
                  dragConstraints={container}
                  dragMomentum={!reduced}
                  dragElastic={reduced ? 0 : 0.15}
                  dragTransition={{ bounceStiffness: 100, bounceDamping: 10 }}
                  whileDrag={{ zIndex: 2 }}
                >
                  <div
                    className="attention-empty-theme"
                    data-accent="citrus"
                    style={{
                      transform: `rotate(${reduced ? 0 : tilts[index]}deg)`,
                    }}
                  >
                    <span
                      className="attention-empty-bubble text-body-sm"
                      data-own=""
                    >
                      {text}
                    </span>
                  </div>
                </motion.li>
              ))}
            </ul>
          </div>
        }
      />
    </section>
  );
}
