/** The creator's protected, machine-local "As you Go" Backpack. */
export const AS_YOU_GO_BACKPACK_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';

/** The renderer sees only the prepared action identity and label, never its path. */
export interface AsYouGoAction {
  id: string;
  label: string;
}

/**
 * The four actions the creator already prepared for this one local Backpack.
 * This is a closed contract, not a schema for other Backpacks.
 */
export const AS_YOU_GO_ACTIONS: readonly AsYouGoAction[] = [
  { id: 'button-a3ea849d-dfc7-486f-b6d8-5b2c12d89246', label: 'CLIPS' },
  { id: 'button-7b551853-0471-4e3e-9cc1-421338db3469', label: 'SLOPTOP MODE' },
  { id: 'button-26dbe75c-e79b-4a9e-a232-74c1dadd1bbc', label: 'slop_engine' },
  { id: 'button-2929b1b4-6054-4b4a-a71f-b1bd5b1ff358', label: 'usb' },
];
