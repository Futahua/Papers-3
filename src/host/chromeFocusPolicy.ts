/** Shell controls remain mouse operable without competing with hosted Tab input. */
export function installChromeFocusPolicy(root: Document): () => void {
  const update = (): void => {
    root.querySelectorAll<HTMLElement>('button, [role="button"], [role="tab"]').forEach((element) => {
      if (element.tabIndex !== -1) element.tabIndex = -1;
    });
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex', 'role'] });
  return () => observer.disconnect();
}
