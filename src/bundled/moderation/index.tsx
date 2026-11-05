import type { PluginModule } from "../../plugins/api";
import { CommunityAdmin } from "./CommunityAdmin";
import { canManageMembership } from "./membership";
import { createWelcomeSupport } from "./welcome";
import { WelcomeSettings } from "./WelcomeSettings";

export const inject = ["relay", "settingsCards", "adminAccess"];
export const apply: PluginModule["apply"] = (ctx) => {
  const relay = ctx.relay;
  const membership = ctx.adminAccess.membership;
  const manageable = () => {
    const connection = relay.snapshot();
    const state = membership.snapshot();
    if (canManageMembership(state)) return true;
    if (
      connection.status === "error" ||
      connection.status === "disconnected" ||
      state.error
    )
      return "error";
    if (
      state.status === "idle" ||
      state.status === "loading" ||
      state.refreshing
    )
      return "pending";
    return false;
  };
  // Registered in every build. The card hides unsupported member changes
  // itself, so a Settings section, history entry or in-app locator naming it
  // still opens the roster and invite controls in native builds.
  ctx.settingsCards.register({
    id: "membership",
    title: "Membership",
    section: "administration",
    visibility: {
      snapshot: manageable,
      subscribe: membership.subscribe,
      ensure: membership.ensure,
    },
    component: ({ active, community }) => (
      <CommunityAdmin
        relay={relay}
        membership={membership}
        {...(community ? { communityName: community.name } : {})}
        active={active}
      />
    ),
  });
  // Owners and admins choose the welcome channel on relays that support it.
  const support = createWelcomeSupport(relay);
  ctx.effect(() => () => support.dispose());
  ctx.settingsCards.register({
    id: "welcome",
    title: "Welcome",
    section: "administration",
    visibility: {
      snapshot: () => {
        const access = manageable();
        if (access !== true) return access;
        const state = support.snapshot();
        if (state.status === "ready") return !!state.supported;
        return state.status === "error" ? "error" : "pending";
      },
      subscribe(listener) {
        const offMembership = membership.subscribe(listener);
        const offSupport = support.subscribe(listener);
        return () => {
          offMembership();
          offSupport();
        };
      },
      ensure() {
        const releaseMembership = membership.ensure();
        const releaseSupport = support.ensure();
        return () => {
          releaseMembership();
          releaseSupport();
        };
      },
    },
    component: ({ active, community }) => (
      <WelcomeSettings
        relay={relay}
        communityName={community?.name}
        active={active}
      />
    ),
  });
};
