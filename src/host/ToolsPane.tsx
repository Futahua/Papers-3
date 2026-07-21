import React from 'react';

/**
 * Tools — a permanent, global destination for reusable machine capabilities.
 *
 * The exact Tool contract is still undecided, so this screen states that
 * honestly rather than fabricating a registry, marketplace or Backpack-scoped
 * permission system. Tools belong to the machine, not to any one Backpack.
 */
export function ToolsPane(): React.JSX.Element {
  return (
    <div className="pane">
      <div className="pane-inner">
        <div className="pane-head">
          <p className="eyebrow">Basic</p>
          <h1>Tools</h1>
          <p>
            Reusable capabilities available across your whole machine — installed programs,
            shortcuts, scripts, automation helpers, mounted locations and utilities. Tools are
            shared: several Backpacks may use the same Tool, and a Tool can be enabled independently
            of any Backpack.
          </p>
        </div>

        <div className="tools-empty">
          <span className="mark" aria-hidden="true">⚙</span>
          <div>
            <p className="eyebrow">Nothing to configure yet</p>
            <h3>The Tool contract is still open.</h3>
            <p>
              Papers keeps Tools as a permanent destination so the definition never gets lost, but it
              does not yet invent how Tools are discovered, enabled or permissioned. That will be
              shaped through real use rather than guessed now.
            </p>
            <p>
              For today, Hermes can already use its own installed file, terminal, browser,
              computer-use and coding tools under ordinary Windows permissions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
