import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { Button } from "../../shared/design-system/ui/Button";
import "./empty-state.css";

const prompts = [
  "Watch this thread for new messages",
  "Tell me when my PR is ready to merge",
  "Check in every morning at 9",
];
const tilts = [-4, 3, -2];

export function AttentionEmptyState({
  name,
  disabled = false,
  onChoose,
}: {
  name: string;
  disabled?: boolean;
  onChoose(text: string): Promise<void>;
}) {
  const reduced = useReducedMotion();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function choose(text: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await onChoose(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }
  const dragged = useRef(false);
  return (
    <section aria-label="Start watching">
      <EmptyState
        icon={null}
        title={`Give ${name} something to keep an eye on.`}
        description={`Ask ${name} to follow a conversation, watch a pull request, or check something on a schedule. Tell ${name} what to look for and when to respond.`}
        action={
          <div className="attention-empty-preview">
            <motion.ul
              className="attention-empty-pile"
              aria-label={`Things to ask ${name}`}
              initial={false}
              animate="visible"
            >
              {prompts.map((text, index) => (
                <motion.li
                  key={text}
                  className="attention-empty-piece"
                  variants={{
                    hidden: { opacity: 0, y: -36, rotate: 0 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      rotate: reduced ? 0 : (tilts[index % tilts.length] ?? 0),
                      transition: {
                        type: "spring",
                        duration: 0.5,
                        bounce: 0.2,
                        delay: reduced ? 0 : (index % 8) * 0.035,
                      },
                    },
                  }}
                  transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
                  drag={!reduced && !disabled && !pending}
                  dragConstraints={{
                    top: -24,
                    bottom: 24,
                    left: -24,
                    right: 24,
                  }}
                  dragSnapToOrigin
                  dragElastic={0.15}
                  dragTransition={{ bounceStiffness: 100, bounceDamping: 10 }}
                  onDragStart={() => {
                    dragged.current = true;
                  }}
                  whileDrag={{ scale: 1.03, rotate: 0, zIndex: 5 }}
                >
                  <div className="attention-empty-theme" data-accent="citrus">
                    <Button
                      variant="plain"
                      size="inline"
                      disabled={disabled || pending}
                      onPointerDown={() => {
                        dragged.current = false;
                      }}
                      onClick={(event) => {
                        if (event.detail > 0 && dragged.current) {
                          event.preventDefault();
                          return;
                        }
                        void choose(text);
                      }}
                    >
                      <span
                        className="attention-empty-bubble text-body-sm"
                        data-own=""
                      >
                        {text}
                      </span>
                    </Button>
                  </div>
                </motion.li>
              ))}
            </motion.ul>
            {error && (
              <p role="alert" className="text-body-sm text-danger">
                {error}
              </p>
            )}
          </div>
        }
      />
    </section>
  );
}
