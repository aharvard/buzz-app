// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CommunityReader } from "./service";
import {
  CommunityWelcomeCard,
  DEFAULT_WELCOME_MESSAGE,
  WelcomeCard,
} from "./WelcomeCard";

afterEach(cleanup);

it("titles the welcome with the community and shows the default message", () => {
  render(<WelcomeCard communityName="Primary" />);
  const card = screen.getByRole("region", { name: "Welcome to Primary" });
  expect(card).toHaveTextContent(DEFAULT_WELCOME_MESSAGE);
});

it("shows a custom message as plain text", () => {
  render(<WelcomeCard communityName="Primary" message={"**Hi** <b>all</b>"} />);
  const card = screen.getByRole("region", { name: "Welcome to Primary" });
  expect(card).toHaveTextContent("**Hi** <b>all</b>");
  expect(card.querySelector("b, strong")).toBeNull();
});

it("names the community the viewer saved, falling back to a plain title", () => {
  const communities = {
    snapshot: () => ({
      memberships: [{ id: "https://primary.example", name: "Primary" }],
    }),
    subscribe: () => () => {},
  } as unknown as CommunityReader;
  const scope = `https://primary.example:${"0".repeat(64)}`;
  const { rerender } = render(
    <CommunityWelcomeCard communities={communities} scope={scope} />,
  );
  expect(
    screen.getByRole("region", { name: "Welcome to Primary" }),
  ).toBeVisible();
  rerender(<CommunityWelcomeCard scope="undefined:undefined" />);
  expect(screen.getByRole("region", { name: "Welcome" })).toBeVisible();
});
