import React from 'react';

/**
 * Entering an empty Backpack.
 *
 * Until something has genuinely been created under a Backpack's name, Enter
 * shows this exact warning and nothing else. Papers does not pretend an empty
 * page is a working Backpack, and dismissing returns to the existing shell.
 * The message text is contractual (implementation plan, acceptance 5).
 */
export function EmptyBackpackWarning(props: {
  backpackName: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="warning-scrim" role="dialog" aria-modal="true">
      <div className="warning-card">
        <span className="mark" aria-hidden="true">▤</span>
        <p className="eyebrow">Empty Backpack</p>
        <p className="warning-message">
          Nothing here yet. Create something under “{props.backpackName}”.
        </p>
        <div className="actions">
          <button className="primary" autoFocus onClick={props.onDismiss}>
            Back to Papers
          </button>
        </div>
      </div>
    </div>
  );
}
