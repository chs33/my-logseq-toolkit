import { StrictMode, type createElement, type useEffect, type useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import styles from "./styles.css?inline";

const SIDEBAR_KEY = "db-local-graph";

type HostReact = {
  createElement: typeof createElement;
  useEffect: typeof useEffect;
  useRef: typeof useRef;
};

export async function registerGraphSidebar() {
  const hostReact = logseq.Experiments.React as HostReact;
  const roots = new Set<Root>();

  function SidebarGraph() {
    const container = hostReact.useRef<HTMLDivElement>(null);

    hostReact.useEffect(() => {
      if (!container.current) return;
      // Keep our React runtime and CSS separate from Logseq's host React tree.
      const shadow = container.current.shadowRoot ?? container.current.attachShadow({ mode: "open" });
      const style = container.current.ownerDocument.createElement("style");
      style.textContent = styles;
      const mount = container.current.ownerDocument.createElement("div");
      mount.id = "app";
      shadow.replaceChildren(style, mount);
      const root = createRoot(mount);
      roots.add(root);
      root.render(<StrictMode><App /></StrictMode>);
      return () => {
        if (roots.delete(root)) root.unmount();
        shadow.replaceChildren();
      };
    }, []);

    return hostReact.createElement("div", {
      ref: container,
      style: { display: "block", width: "100%", minWidth: 0, height: "clamp(440px, 75vh, 820px)" }
    });
  }

  // The stable SDK has no custom sidebar renderer; use the experimental host slot.
  await logseq.Experiments.registerSidebarRenderer(SIDEBAR_KEY, {
    title: "Local Graph",
    render: () => hostReact.createElement(SidebarGraph)
  });

  return {
    open: () => logseq.Editor.openInRightSidebar(`_sidebar.${SIDEBAR_KEY}`),
    toggle: async () => {
      const sidebarVisible = await logseq.App.getStateFromStore<boolean>("ui/sidebar-open?");
      // Read the host state so native sidebar controls and manual card closure
      // stay in sync with the shortcut. Hiding preserves the graph and other cards.
      if (sidebarVisible && roots.size > 0) {
        logseq.App.setRightSidebarVisible(false);
      } else {
        logseq.Editor.openInRightSidebar(`_sidebar.${SIDEBAR_KEY}`);
      }
    },
    dispose: () => {
      for (const root of roots) root.unmount();
      roots.clear();
    }
  };
}
